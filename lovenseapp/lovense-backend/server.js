// =============================================
// LOVENSE STANDARD API - Express Backend
// =============================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const http = require('http');
const fs = require('fs');
const readline = require('readline');
const path = require('path');
const db = require('./db');

const app = express();

app.use(cors());
app.use(express.json());

// =============================================
// IN-MEMORY SESSION STORE
// =============================================
const userSessions = {};

// =============================================
// Socket.IO
// =============================================
const server = http.createServer(app);
const { initSocket, connectedClients, rooms } = require('./socketHandler');
initSocket(server, userSessions);

// =============================================
// HELPER: Decrypt Lovense AES-256-CBC callback payload
// =============================================
function decryptCallbackPayload(encryptedMessage) {
  const key = Buffer.from(process.env.LOVENSE_AES_KEY, 'utf8');
  const iv = Buffer.from(process.env.LOVENSE_AES_IV, 'utf8');
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  let decrypted = decipher.update(encryptedMessage, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  return JSON.parse(decrypted);
}

// =============================================
// ROUTE: GET /ping
// =============================================
app.get('/ping', (req, res) => {
  res.send('alive');
});

// =============================================
// ROUTE: POST /callback
// =============================================
app.post('/callback', (req, res) => {
  const raw = req.body;

  let payload;
  try {
    if (raw.message) {
      payload = decryptCallbackPayload(raw.message);
    } else {
      payload = raw;
      console.warn('[callback] No encrypted message - using raw payload');
    }
  } catch (err) {
    console.error('[callback] Decryption failed:', err.message);
    return res.status(400).json({ result: 'error', message: 'Decryption failed' });
  }

  const { uid, toys, domain, httpsPort, wssPort, appType, platform, utoken } = payload;

  if (!uid) {
    return res.status(400).json({ result: 'error', message: 'Missing uid' });
  }

  // Enforce utoken validation
  const storedSession = userSessions[uid];
  if (storedSession && storedSession.utoken && storedSession.utoken !== utoken) {
    console.warn('[callback] utoken mismatch for uid:', uid);
    return res.status(403).json({ result: 'error', message: 'Unauthorized - utoken mismatch' });
  }

  const hasToys = !!(toys && toys.length > 0);

  userSessions[uid] = {
    uid,
    utoken,
    toys,
    domain,
    httpsPort,
    wssPort,
    appType,
    platform,
    hasToys,
    connectedAt: new Date().toISOString(),
  };

  // Update connectedClients toy status
  if (connectedClients[uid]) {
    connectedClients[uid].toyStatus = hasToys ? 'paired' : 'disconnected';
  }

  console.log('[callback] Session stored for uid:', uid);
  console.log('[callback] Toys connected:', hasToys ? toys.map(t => t.name).join(', ') : 'none');

  res.json({ result: 'ok' });
});

// =============================================
// ROUTE: GET /auth
// =============================================
app.get('/auth', async (req, res) => {
  const uid = req.query.uid || 'test-user-001';

  try {
    const fetch = (await import('node-fetch')).default;
    const apiRes = await fetch('https://api.lovense-api.com/api/basicApi/getToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: process.env.LOVENSE_DEV_TOKEN,
        uid,
        uname: uid
      })
    });
    const apiData = await apiRes.json();
    if (apiData.code !== 0) {
      console.error('[auth] Lovense API error', apiData);
      return res.status(502).json({ result: 'error', message: apiData.message || 'Failed to obtain auth token' });
    }
    // Return utoken for socket auth if available from session
    const session = userSessions[uid];
    res.json({
      uid,
      authToken: apiData.data.authToken,
      utoken: session ? session.utoken : null
    });
  } catch (e) {
    console.error('[auth] exception', e);
    res.status(500).json({ result: 'error', message: e.message });
  }
});

// =============================================
// ROUTE: GET /ctoken
// =============================================
const ctokenCache = {};

app.get('/ctoken', async (req, res) => {
  const uid = req.query.uid;
  if (!uid) return res.status(400).json({ error: 'Missing uid' });

  const cached = ctokenCache[uid];
  if (cached && Date.now() - cached.fetchedAt < 20 * 60 * 60 * 1000) {
    return res.json({ ctoken: cached.ctoken, affiliateLink: process.env.LOVENSE_AFFILIATE_LINK || '' });
  }

  try {
    const fetch = (await import('node-fetch')).default;

    // Step 1: ensure user is registered with Lovense (required before ctoken)
    const authRes = await fetch('https://api.lovense-api.com/api/basicApi/getToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: process.env.LOVENSE_DEV_TOKEN, uid, uname: uid })
    });
    const authData = await authRes.json();
    if (authData.code !== 0) {
      console.error('[ctoken] auth registration failed:', authData);
      return res.status(502).json({ error: 'Failed to register user' });
    }

    // Step 2: fetch ctoken
    const ctokenRes = await fetch(
      'https://api.lovense-api.com/api/media/pattern/user/ctoken?userId=' + uid,
      { headers: { dtoken: process.env.LOVENSE_DEV_TOKEN } }
    );
    const ctokenData = await ctokenRes.json();
    if (!ctokenData.data || !ctokenData.data.ctoken) {
      console.error('[ctoken] Lovense API error:', ctokenData);
      return res.status(502).json({ error: 'Failed to obtain ctoken', detail: ctokenData });
    }

    const ctoken = ctokenData.data.ctoken;
    ctokenCache[uid] = { ctoken, fetchedAt: Date.now() };
    res.json({ ctoken, affiliateLink: process.env.LOVENSE_AFFILIATE_LINK || '' });
  } catch (e) {
    console.error('[ctoken] exception:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// =============================================
// ROUTE: GET /session/:uid
// =============================================
app.get('/session/:uid', (req, res) => {
  const { uid } = req.params;
  const session = userSessions[uid];
  if (!session) {
    return res.json({ connected: false, uid });
  }
  res.json({
    connected: true,
    uid,
    toys: session.toys,
    hasToys: session.hasToys,
    platform: session.platform,
    appType: session.appType,
    connectedAt: session.connectedAt,
  });
});

// =============================================
// ROUTE: GET /status/:uid
// =============================================
app.get('/status/:uid', (req, res) => {
  const { uid } = req.params;
  const client = connectedClients[uid];
  const session = userSessions[uid];
  res.json({
    uid,
    online: client ? client.status === 'online' : false,
    toyStatus: client ? client.toyStatus : 'disconnected',
    hasSession: !!session,
    hasToys: session ? session.hasToys : false,
    socketCount: client ? client.socketIds.length : 0,
  });
});

// =============================================
// ROUTE: POST /command
// =============================================
app.post('/command', async (req, res) => {
  const { uid, command, action, timeSec, loopRunningSec, loopPauseSec, toy } = req.body;

  if (!uid || !command) {
    return res.status(400).json({ result: 'error', message: 'Missing uid or command' });
  }

  const session = userSessions[uid];
  if (!session) {
    return res.status(404).json({ result: 'error', message: 'No session found for uid' });
  }

  const commandPayload = {
    token: process.env.LOVENSE_DEV_TOKEN,
    uid,
    command,
    action,
    timeSec,
    loopRunningSec,
    loopPauseSec,
    toy,
  };

  res.json({
    result: 'ok',
    note: 'MVP stub. Uncomment fetch block to send real commands.',
    wouldSend: commandPayload
  });
});

// =============================================
// ROUTE: GET /health
// =============================================
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    sessions: Object.keys(userSessions).length,
    connectedClients: Object.keys(connectedClients).length,
    activeRooms: Object.keys(rooms).length,
    uptime: process.uptime(),
    time: new Date().toISOString(),
    aesConfigured: !!(process.env.LOVENSE_AES_KEY && process.env.LOVENSE_AES_IV),
    tokenConfigured: !!process.env.LOVENSE_DEV_TOKEN,
  });
});

// =============================================
// ROUTE: GET /videos
// =============================================
const CSV_PATH = fs.existsSync(path.join(__dirname, 'data', 'pornhub.com-db.csv'))
  ? path.join(__dirname, 'data', 'pornhub.com-db.csv')
  : path.join(__dirname, 'data', 'pornhub.com-db.sample.csv');

async function queryVideosFromCSV({ page, limit, search, sort, order, category }) {
  const searchStr = (search || '').toLowerCase();
  const catStr = (category || '').toLowerCase();
  const offset = (page - 1) * limit;
  const allResults = [];

  const rl = readline.createInterface({
    input: fs.createReadStream(CSV_PATH),
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    const cols = line.split('|');
    const title = (cols[3] || '').toLowerCase();
    const cats = (cols[5] || '').toLowerCase();
    if (searchStr && !title.includes(searchStr)) continue;
    if (catStr && !cats.includes(catStr)) continue;
    allResults.push({
      embed: cols[0] || '',
      thumbnail: (cols[1] || '').split(';')[0],
      thumbnails: (cols[1] || '').split(';').filter(Boolean),
      title: cols[3] || '',
      tags: (cols[4] || '').split(';').filter(Boolean),
      categories: cols[5] || '',
      pornstar: cols[6] || '',
      duration: parseInt(cols[7]) || 0,
      views: parseInt(cols[8]) || 0,
      rating: parseFloat(cols[9]) || 0,
    });
  }

  if (sort === 'views') allResults.sort((a, b) => order === 'asc' ? a.views - b.views : b.views - a.views);
  else if (sort === 'rating') allResults.sort((a, b) => order === 'asc' ? a.rating - b.rating : b.rating - a.rating);
  else if (sort === 'duration') allResults.sort((a, b) => order === 'asc' ? a.duration - b.duration : b.duration - a.duration);
  else if (sort === 'title') allResults.sort((a, b) => order === 'asc' ? a.title.localeCompare(b.title) : b.title.localeCompare(a.title));

  const total = allResults.length;
  return { videos: allResults.slice(offset, offset + limit), total, hasMore: offset + limit < total };
}

app.get('/videos', async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const search = req.query.search || '';
  const sort = req.query.sort || '';
  const order = req.query.order || 'desc';
  const category = req.query.category || '';

  try {
    // Try PostgreSQL first
    if (process.env.DATABASE_URL) {
      const result = await db.getVideos({ page, limit, search, sort, order, category });
      if (result && result.videos.length > 0) {
        return res.json({ ...result, source: 'postgres' });
      }
    }

    // Fallback to CSV
    const result = await queryVideosFromCSV({ page, limit, search, sort, order, category });
    res.json({ ...result, source: 'csv' });
  } catch (e) {
    console.error('[videos] error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// =============================================
// ROUTE: GET /videos/categories
// =============================================
async function queryCategoriesFromCSV() {
  const cats = new Set();
  const rl = readline.createInterface({
    input: fs.createReadStream(CSV_PATH),
    crlfDelay: Infinity
  });
  for await (const line of rl) {
    const cols = line.split('|');
    const cat = (cols[5] || '').trim();
    if (cat) cats.add(cat);
  }
  return Array.from(cats).sort();
}

app.get('/videos/categories', async (req, res) => {
  try {
    let categories;
    if (process.env.DATABASE_URL) {
      categories = await db.getCategories();
    }
    if (!categories || categories.length === 0) {
      categories = await queryCategoriesFromCSV();
    }
    res.json({ categories });
  } catch (e) {
    console.error('[categories] error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// START SERVER
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('=============================================');
  console.log(' Lovense Backend Server Running');
  console.log('=============================================');
  console.log(` Port:       ${PORT}`);
  console.log(` Endpoints:`);
  console.log(`   GET  /ping           - keep-alive`);
  console.log(`   POST /callback       - Lovense device callback`);
   console.log(`   GET  /auth           - per-user authToken`);
   console.log(`   GET  /ctoken         - per-user ctoken for Pattern sync`);
   console.log(`   GET  /session/:uid   - check session`);
  console.log(`   GET  /status/:uid    - real-time status`);
  console.log(`   POST /command        - command relay`);
  console.log(`   GET  /videos         - video library`);
  console.log(`   GET  /videos/categories - categories`);
  console.log(`   GET  /health         - health check`);
  console.log('=============================================');
});
