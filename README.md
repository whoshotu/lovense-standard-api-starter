# Lovense Standard API Starter

MVP starter for a Lovense Standard API integration — Node/Express backend + Vite frontend.

## Project structure

```
lovenseapp/
├── lovense-backend/    ← Express server: callback, auth, command, session
└── lovense-frontend/   ← Vite frontend: SDK init, QR pairing, toy control UI
```

## Stack

| Layer | Tool |
|---|---|
| Backend | Node.js + Express |
| Frontend | Vite + plain HTML/JS |
| Hosting (backend) | Render.com |
| Hosting (frontend) | Vercel |
| SDK | Lovense Standard JS SDK (CDN) |
| Env secrets | dotenv (.env never committed) |

## Backend endpoints

| Route | Method | Purpose |
|---|---|---|
| `/ping` | GET | Keep-alive for cron-job.org (prevents Render sleep) |
| `/callback` | POST | Receives Lovense toy/device data after QR scan |
| `/auth` | GET | Returns per-user authToken for JS SDK (NOT dev token) |
| `/session/:uid` | GET | Returns current toy/device session state for a user |
| `/command` | POST | Server-side fallback command relay to Lovense API |
| `/health` | GET | Health check / uptime |

## Setup

### 1. Clone and install

```bash
git clone https://github.com/whoshotu/lovense-standard-api-starter.git
cd lovense-standard-api-starter/lovenseapp/lovense-backend
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Fill in your LOVENSE_DEV_TOKEN from developer.lovense.com
```

### 3. Run backend locally

```bash
npm start
# or for dev with auto-restart:
npm run dev
```

### 4. Run frontend

```bash
cd ../lovense-frontend
npm install
npm run dev
```

## Important Lovense rules (from official docs)

- **NEVER put the developer token in frontend code** — it stays in `.env` on the server only
- The frontend uses a per-user `authToken` via the JS SDK, which is different from the dev token
- Generate a unique `utoken` per user to validate Lovense callback payloads
- Wait for the SDK `ready` event before calling `getQrcode()` or sending commands
- Subscribe to all state events: `appStatusChange`, `toyOnlineChange`, `toyInfoChange`, `deviceInfoChange`
- Validate toy capabilities before sending commands (not all toys support rotate, pump, thrust, etc.)
- Use pattern-based commands instead of rapid single-command loops for stability

## Next steps

1. Register your app in the [Lovense Developer Dashboard](https://developer.lovense.com)
2. Set your callback URL to `https://your-app.onrender.com/callback`
3. Add your developer token to `.env`
4. Wire the real Lovense authToken flow into `/auth`
5. Wire the Standard JS SDK into the frontend and call `getQrcode()`
