// =============================================
// LOVENSE STANDARD API - Express Backend
// Anthony's Lovense Integration Backend
// =============================================
// This server handles:
// 1. /ping          - keep-alive endpoint for cron-job.org (prevents Render sleep)
// 2. /callback      - receives Lovense toy/device data after user scans QR code
// 3. /auth          - returns per-user authToken for the frontend SDK (NOT the dev token)
// 4. /command       - optional: server-side toy command relay fallback
// =============================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();

// ---- Middleware ----
app.use(cors());
app.use(express.json());

// =============================================
// IN-MEMORY SESSION STORE
// In production, replace with a real database (Supabase, Neon, etc.)
// Stores: { uid -> { toys, domain, httpsPort, wsPort, appType, platform } }
// =============================================
const userSessions = {};

// =============================================
// ROUTE: /ping
// Purpose: cron-job.org hits this every 14 min to prevent Render from sleeping
// Set up a free cron at https://cron-job.org pointing to https://your-app.onrender.com/ping
// =============================================
app.get('/ping', (req, res) => {
  console.log('[ping] keep-alive hit at', new Date().toISOString());
  res.send('alive');
});

// =============================================
// ROUTE: POST /callback
// Purpose: Lovense posts device + toy info here after user scans QR code
// Payload includes: uid, toys[], domain, httpsPort, wssPort, appType, platform, utoken
//
// IMPORTANT SECURITY RULES (from Lovense docs):
// 1. Verify the uid matches a known user in your system
// 2. Validate utoken against what you stored for that user
// 3. Store the device/toy metadata for use in command routing later
// =============================================
app.post('/callback', (req, res) => {
  const payload = req.body;

  console.log('[callback] Lovense payload received:');
  console.log(JSON.stringify(payload, null, 2));

  const { uid, toys, domain, httpsPort, wssPort, appType, platform, utoken } = payload;

  // --- Step 1: Basic payload validation ---
  if (!uid) {
    console.warn('[callback] Missing uid in payload');
    return res.status(400).json({ result: 'error', message: 'Missing uid' });
  }

  // --- Step 2: Validate utoken (TODO: tie to your user store) ---
  const storedSession = userSessions[uid];
  if (storedSession && storedSession.utoken && storedSession.utoken !== utoken) {
    console.warn('[callback] utoken mismatch for uid:', uid);
    // Uncomment to enforce in production:
    // return res.status(403).json({ result: 'error', message: 'Unauthorized' });
  }

  // --- Step 3: Store device state for this user ---
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
app.get('/auth', (req, res) => {
  const uid = req.query.uid || 'test-user-001';

  console.log('[auth] Auth request for uid:', uid);

  // TODO: In production, call Lovense API with LOVENSE_DEV_TOKEN to get real authToken
  res.json({
    uid: uid,
    // authToken: 'real_token_from_lovense_api',  // TODO: real auth flow
    message: 'MVP: wire real authToken from Lovense API here'
  });
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
  });
});

// =============================================
// START SERVER
// =============================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
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
