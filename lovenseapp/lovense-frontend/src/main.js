let activeSdk = null;
const API_BASE = 'https://lovense-standard-api-starter.onrender.com';
const DEMO_UID = 'test-user-001';
const ROOM_ID = 'demo-room';

const backendDot = document.getElementById('backend-dot');
const backendStatus = document.getElementById('backend-status');
const backendOutput = document.getElementById('backend-output');
const commandOutput = document.getElementById('command-output');
const qrCode = document.getElementById('qrcode');

// Socket.io connection
const socket = io(API_BASE, { transports: ['websocket'] });
socket.connect();

// Chat
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');

socket.on('connect', () => {
  console.log('[socket] connected');
  socket.emit('joinRoom', { roomId: ROOM_ID });
});

socket.on('chatMessage', (data) => {
  const msg = document.createElement('div');
  msg.textContent = `${data.user || 'anon'}: ${data.message}`;
  msg.style.margin = '4px 0';
  chatMessages.appendChild(msg);
  chatMessages.scrollTop = chatMessages.scrollHeight;
});

socket.on('controlRequest', (data) => {
  if (confirm(`User ${data.uid} wants to control your toy. Accept?`)) {
    socket.emit('controlResponse', { roomId: ROOM_ID, uid: data.uid, accept: true });
  }
});

socket.on('controlResponse', (data) => {
  commandOutput.textContent = data.accept
    ? `Control granted to ${data.uid}`
    : `Control request declined by ${data.uid}`;
});

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
    const authRes = await fetch(`${API_BASE}/auth?uid=${DEMO_UID}`);
    const authData = await authRes.json();
    if (!authData.authToken) {
      qrCode.textContent = 'Missing authToken – backend not configured';
      return;
    }
    const sdk = new LovenseBasicSdk({
      uid: DEMO_UID,
      platform: 'weplay',
      authToken: authData.authToken
    });
    sdk.on('ready', async () => {
      try {
        const qr = await sdk.getQrcode();
        if (qr.qrcodeUrl) {
          qrCode.innerHTML = `<img src="${qr.qrcodeUrl}" alt="Lovense QR" style="max-width:100%;"/>`;
        } else if (qr.qrcode) {
          qrCode.textContent = qr.qrcode;
        }
        activeSdk = sdk;
      } catch (e) {
        qrCode.textContent = 'Failed to get QR: ' + e.message;
      }
    });
    sdk.on('sdkError', (e) => {
      console.error('SDK error', e);
    });
  } catch (e) {
    qrCode.textContent = 'SDK init error: ' + e.message;
  }
}

// Toy control (SDK + socket broadcast)
document.getElementById('send-toy').addEventListener('click', () => {
  const vibrate = Number(document.getElementById('vibrate-range').value);
  const rotate = Number(document.getElementById('rotate-range').value);
  const pump = Number(document.getElementById('pump-range').value);
  document.getElementById('vibrate-value').textContent = vibrate;
  document.getElementById('rotate-value').textContent = rotate;
  document.getElementById('pump-value').textContent = pump;
  const cmd = { vibrate, rotate, pump, time: 5 };
  if (activeSdk) {
    activeSdk.sendToyCommand(cmd);
  }
  // broadcast to room
  socket.emit('toyCommand', { roomId: ROOM_ID, command: cmd });
});

document.getElementById('stop-toy').addEventListener('click', () => {
  if (activeSdk) {
    activeSdk.sendToyCommand({ vibrate: 0, rotate: 0, pump: 0 });
  }
  socket.emit('toyCommand', { roomId: ROOM_ID, command: { vibrate: 0, rotate: 0, pump: 0 } });
});

// Listen for toy commands from others
socket.on('toyCommand', (data) => {
  if (activeSdk) {
    activeSdk.sendToyCommand(data.command);
  }
});

// Chat
document.getElementById('send-chat').addEventListener('click', () => {
  const message = chatInput.value.trim();
  if (!message) return;
  socket.emit('chatMessage', { roomId: ROOM_ID, message, user: DEMO_UID });
  chatInput.value = '';
});

// Request control
document.getElementById('request-control').addEventListener('click', () => {
  socket.emit('controlRequest', { roomId: ROOM_ID, uid: DEMO_UID });
  commandOutput.textContent = 'Control request sent';
});

// Event listeners
document.getElementById('check-backend').addEventListener('click', checkBackend);
document.getElementById('get-auth').addEventListener('click', getAuth);
document.getElementById('load-session').addEventListener('click', loadSession);
document.getElementById('init-sdk').addEventListener('click', initSdk);

checkBackend();
