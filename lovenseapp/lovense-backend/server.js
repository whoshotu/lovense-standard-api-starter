// =============================================
// LOVENSE STANDARD API - Express Backend
// Anthony's Lovense Integration Backend
// =============================================
// This server handles:
// 1. /ping          - keep-alive endpoint for cron-job.org (prevents Render sleep)
// 2. /callback      - receives Lovense toy/device data after user scans QR code
//                     decrypts AES-256-CBC payload using LOVENSE_AES_KEY + LOVENSE_AES_IV
// 3. /auth          - returns per-user authToken for the frontend SDK (NOT the dev token)
// 4. /command       - optional: server-side toy command relay fallback
// =============================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto'); // built-in Node.js - no install needed

const app = express();

// ---- Middleware ----
app.use(cors());
app.use(express.json());

// =============================================
// IN-MEMORY SESSION STORE
// In production, replace with a real database (Supabase, Neon, etc.)
// Stores: { uid -> { toys, domain, httpsPort, wssPort, appType, platform } }
// =============================================
const userSessions = {};

// =============================================
// HELPER: Decrypt Lovense AES-256-CBC callback payload
// Lovense encrypts the callback body before sending it to your URL
// You must decrypt it using the AES Key + IV from your developer dashboard
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
// Purpose: cron-job.org hits this every 14 min to prevent Render from sleeping
// Set up a free cron at https://cron-job.org pointing to https://your-app.onrender.com/ping
// =============================================
app.get('/ping', (req, res) => {
  console.log('[ping] keep-alive hit at', new Date().toISOString());
  res.send('alive');
});

// =============================================
// ROUTE: POST /callback
// Purpose: Lovense posts encrypted device + toy info here after user scans QR code
//
// Lovense sends: { message: '<AES-256-CBC encrypted string>' }
// We decrypt it to get: { uid, toys[], domain, httpsPort, wssPort, appType, platform, utoken }
//
// IMPORTANT SECURITY RULES (from Lovense docs):
// 1. Decrypt payload using AES Key + IV from your dashboard
// 2. Verify the uid matches a known user in your system
// 3. Validate utoken against what you stored for that user
// 4. Store the device/toy metadata for use in command routing later
// =============================================
app.post('/callback', (req, res) => {
  const raw = req.body;

  console.log('[callback] Raw Lovense payload received:', JSON.stringify(raw));

  // --- Step 1: Decrypt the payload ---
  let payload;
  try {
    if (raw.message) {
      // Encrypted callback - decrypt using AES Key + IV
      payload = decryptCallbackPayload(raw.message);
      console.log('[callback] Decrypted payload:', JSON.stringify(payload, null, 2));
    } else {
      // Fallback: unencrypted (dev/test mode or older API versions)
      payload = raw;
      console.warn('[callback] No encrypted message field - using raw payload');
    }
  } catch (err) {
    console.error('[callback] Decryption failed:', err.message);
    console.error('[callback] Check LOVENSE_AES_KEY and LOVENSE_AES_IV in your environment variables');
    return res.status(400).json({ result: 'error', message: 'Decryption failed' });
  }

  const { uid, toys, domain, httpsPort, wssPort, appType, platform, utoken } = payload;

  // --- Step 2: Basic payload validation ---
  if (!uid) {
    console.warn('[callback] Missing uid in decrypted payload');
    return res.status(400).json({ result: 'error', message: 'Missing uid' });
  }

  // --- Step 3: Validate utoken (TODO: tie to your user store) ---
  const storedSession = userSessions[uid];
  if (storedSession && storedSession.utoken && storedSession.utoken !== utoken) {
    console.warn('[callback] utoken mismatch for uid:', uid);
    // Uncomment to enforce in production:
    // return res.status(403).json({ result: 'error', message: 'Unauthorized' });
  }

  // --- Step 4: Store device state for this user ---
  userSessions[uid] = {
    uid,
    utoken,
    toys,
    domain,
    httpsPort,
    wssPort,
    appType,
    platform,
    connectedAt: new Date().toISOString(),
  };

  console.log('[callback] Session stored for uid:', uid);
  console.log('[callback] Toys connected:', toys ? toys.map(t => t.name).join(', ') : 'none');

  // Lovense expects this exact response format
  res.json({ result: 'ok' });
});

// =============================================
// ROUTE: GET /auth
// Purpose: Frontend calls this to get an authToken for the Lovense JS SDK
//
// CRITICAL: Returns authToken for SDK - NOT the dev token
// The dev token NEVER leaves this server
// =============================================
app.get('/auth', async (req, res) => {
  const uid = req.query.uid || 'test-user-001';

  console.log('[auth] Auth request for uid:', uid);

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
    console.log('[auth] Lovense API response:', JSON.stringify(apiData));
    if (apiData.code !== 0) {
      console.error('[auth] Lovense API error', apiData);
      return res.status(502).json({ result: 'error', message: apiData.message || 'Failed to obtain auth token' });
    }
    res.json({ uid, authToken: apiData.data.authToken });
  } catch (e) {
    console.error('[auth] exception', e);
    res.status(500).json({ result: 'error', message: e.message });
  }
});

// =============================================
// ROUTE: GET /session/:uid
// Purpose: Frontend checks current device/toy state for a user
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
    platform: session.platform,
    appType: session.appType,
    connectedAt: session.connectedAt,
  });
});

// =============================================
// ROUTE: POST /command
// Purpose: Server-side toy command fallback (when LAN is unavailable)
// Uses Lovense server API: https://api.lovense-api.com/api/lan/v2/command
//
// Prefer JS SDK direct commands for low latency
// Use this only as LAN fallback
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

  console.log('[command] Would send:', JSON.stringify(commandPayload));

  // TODO: Uncomment to send real commands via Lovense server API
  /*
  try {
    const fetch = (await import('node-fetch')).default;
    const response = await fetch('https://api.lovense-api.com/api/lan/v2/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(commandPayload),
    });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ result: 'error', message: err.message });
  }
  */

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
    uptime: process.uptime(),
    time: new Date().toISOString(),
    aesConfigured: !!(process.env.LOVENSE_AES_KEY && process.env.LOVENSE_AES_IV),
    tokenConfigured: !!process.env.LOVENSE_DEV_TOKEN,
  });
});

const http = require('http');
const fs = require('fs');
const readline = require('readline');
const path = require('path');

const server = http.createServer(app);
const { initSocket } = require('./socketHandler');
initSocket(server);

// Video database (CSV-backed)
const CSV_PATH = path.join(__dirname, 'data', 'pornhub.com-db.csv');
const CSV_EXISTS = fs.existsSync(CSV_PATH);

// GET /videos?page=1&limit=20&search=
app.get('/videos', async (req, res) => {
  if (!CSV_EXISTS) return res.status(404).json({ error: 'Video database not found' });

  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const search = (req.query.search || '').toLowerCase();
  const offset = (page - 1) * limit;

  try {
    const results = [];
    let matched = 0;
    let skipped = 0;

    const rl = readline.createInterface({
      input: fs.createReadStream(CSV_PATH),
      crlfDelay: Infinity
    });

    for await (const line of rl) {
      if (search) {
        const cols = line.split('|');
        const title = (cols[3] || '').toLowerCase();
        if (!title.includes(search)) continue;
      }
      if (skipped < offset) { skipped++; continue; }
      if (matched >= limit) break;

      const cols = line.split('|');
      const thumbnail = (cols[1] || '').split(';')[0];
      results.push({
        embed: cols[0] || '',
        thumbnail,
        title: cols[3] || '',
        tags: (cols[4] || '').split(';').filter(Boolean),
        categories: cols[5] || '',
        pornstar: cols[6] || '',
        duration: parseInt(cols[7]) || 0,
        views: parseInt(cols[8]) || 0,
        rating: parseFloat(cols[9]) || 0,
      });
      matched++;
    }

    res.json({ videos: results, page, limit, hasMore: matched === limit });
  } catch (e) {
    console.error('[videos] error:', e.message);
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
  console.log(`   GET  /ping           - keep-alive (cron-job.org)`);
  console.log(`   POST /callback       - Lovense device/toy callback`);
  console.log(`   GET  /auth           - per-user authToken for SDK`);
  console.log(`   GET  /session/:uid   - check user session state`);
  console.log(`   POST /command        - server-side command relay`);
  console.log(`   GET  /health         - health check`);
  console.log('=============================================');
  console.log(` Callback URL: ${process.env.PUBLIC_BACKEND_URL || 'https://your-app.onrender.com'}/callback`);
  console.log('=============================================');
});
