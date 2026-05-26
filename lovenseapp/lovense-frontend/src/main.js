const API_BASE = 'http://localhost:3000';
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

function initSdkStub() {
  qrCode.innerHTML = `
    <div>
      <strong>Next wiring steps</strong><br /><br />
      1. Add Lovense Standard JS SDK script tag<br />
      2. Fetch real authToken from /auth<br />
      3. Initialize SDK with uid + authToken<br />
      4. Call getQrcode()<br />
      5. Listen: ready, appStatusChange, toyOnlineChange, toyInfoChange, deviceInfoChange
    </div>
  `;
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
document.getElementById('init-sdk').addEventListener('click', initSdkStub);

document.querySelectorAll('[data-command]').forEach(btn => {
  btn.addEventListener('click', () => sendCommand(btn.dataset.command));
});

checkBackend();
