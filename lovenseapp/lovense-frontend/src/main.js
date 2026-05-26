const API_BASE = 'https://lovense-standard-api-starter.onrender.com';
const DEMO_UID = 'test-user-001';

const backendDot = document.getElementById('backend-dot');
const backendStatus = document.getElementById('backend-status');
const backendOutput = document.getElementById('backend-output');
const commandOutput = document.getElementById('command-output');
const qrCode = document.getElementById('qrcode');

async function checkBackend() {
  try {
    const res = await fetch(`${API_BASE}/health`);
    const data = await res.json();
    backendDot.classList.add('ok');
    backendStatus.textContent = 'Backend online';
    backendOutput.textContent = JSON.stringify(data, null, 2);
  } catch (err) {
    backendDot.classList.remove('ok');
    backendStatus.textContent = 'Backend offline';
    backendOutput.textContent = err.message;
  }
}

async function getAuth() {
  try {
    const res = await fetch(`${API_BASE}/auth?uid=${DEMO_UID}`);
    const data = await res.json();
    backendOutput.textContent = JSON.stringify(data, null, 2);
  } catch (err) {
    backendOutput.textContent = err.message;
  }
}

async function loadSession() {
  try {
    const res = await fetch(`${API_BASE}/session/${DEMO_UID}`);
    const data = await res.json();
    qrCode.textContent = JSON.stringify(data, null, 2);
  } catch (err) {
    qrCode.textContent = err.message;
  }
}

async function initSdk() {
  try {
    // 1. Get auth data (authToken) from backend
    const authRes = await fetch(`${API_BASE}/auth?uid=${DEMO_UID}`);
    const authData = await authRes.json();
    // 2. Initialise Lovense SDK with uid and authToken
    const sdk = new LovenseBasicSdk({
      uid: DEMO_UID,
      platform: 'weplay',
      authToken: authData.authToken || '', // will be empty in MVP stub
    });
    // 3. Wait for SDK ready
    sdk.on('ready', async () => {
      try {
        const qr = await sdk.getQrcode();
        // Display QR image or data
        if (qr.qrcodeUrl) {
          qrCode.innerHTML = `<img src="${qr.qrcodeUrl}" alt="Lovense QR" style="max-width:100%;"/>`;
        } else if (qr.qrcode) {
          qrCode.textContent = qr.qrcode;
        }
      } catch (e) {
        qrCode.textContent = 'Failed to get QR: ' + e.message;
      }
    });
    // Optional: listen for errors
    sdk.on('sdkError', (e) => {
      console.error('SDK error', e);
    });
  } catch (e) {
    qrCode.textContent = 'SDK init error: ' + e.message;
  }
}

async function sendCommand(action) {
  const payload = {
    uid: DEMO_UID,
    command: 'Function',
    action,
    timeSec: action === 'Stop' ? 0 : 5,
  };

  try {
    const res = await fetch(`${API_BASE}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    commandOutput.textContent = JSON.stringify(data, null, 2);
  } catch (err) {
    commandOutput.textContent = err.message;
  }
}

document.getElementById('check-backend').addEventListener('click', checkBackend);
document.getElementById('get-auth').addEventListener('click', getAuth);
document.getElementById('load-session').addEventListener('click', loadSession);
document.getElementById('init-sdk').addEventListener('click', initSdk);

document.querySelectorAll('[data-command]').forEach(btn => {
  btn.addEventListener('click', () => sendCommand(btn.dataset.command));
});

checkBackend();
