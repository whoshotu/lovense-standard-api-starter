let activeSdk = null;
const API_BASE = 'https://lovense-standard-api-starter.onrender.com';
const DEMO_UID = 'test-user-001';
const ROOM_ID = 'demo-room';

const commandOutput = document.getElementById('command-output');
const qrCode = document.getElementById('qrcode');
const pairStatus = document.getElementById('pair-status');

// Socket
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

// Media queue
let queue = [];
let currentIndex = -1;
const videoPlayer = document.getElementById('video-player');
// Suppress initial load errors (no source until user adds a URL)
videoPlayer.onerror = () => {};
const queueList = document.getElementById('queue-list');
const mediaUrlInput = document.getElementById('media-url');
const skipBtn = document.getElementById('skip-video');

// Listen for media sync from host
socket.on('mediaSync', (data) => {
  if (data.action === 'play' && data.url) {
    videoPlayer.src = data.url;
    videoPlayer.style.display = 'block';
    videoPlayer.currentTime = data.currentTime || 0;
    videoPlayer.play();
  } else if (data.action === 'pause') {
    videoPlayer.pause();
  } else if (data.action === 'skip') {
    playNext();
  }
});

// Broadcast media info when host plays (if we initiated it)
let amHost = true; // simple: whoever adds is host

function renderQueue() {
  queueList.innerHTML = '';
  queue.forEach((item, i) => {
    const div = document.createElement('div');
    div.className = 'queue-item';
    div.innerHTML = `
      <span class="url">${i === currentIndex ? '▶ ' : ''}${item}</span>
      <div class="btn-group">
        <button class="primary" data-index="${i}" data-action="play">Play</button>
        <button class="danger" data-index="${i}" data-action="remove">X</button>
      </div>
    `;
    div.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = Number(btn.dataset.index);
        if (btn.dataset.action === 'play') playIndex(idx);
        else removeFromQueue(idx);
      });
    });
    queueList.appendChild(div);
  });
}

function addToQueue(url) {
  const trimmed = url.trim();
  if (!trimmed) return;
  queue.push(trimmed);
  renderQueue();
  mediaUrlInput.value = '';
  // auto play if first
  if (currentIndex === -1) playIndex(0);
}

function removeFromQueue(idx) {
  queue.splice(idx, 1);
  if (idx < currentIndex) currentIndex--;
  else if (idx === currentIndex) {
    currentIndex = -1;
    videoPlayer.style.display = 'none';
  }
  renderQueue();
}

function playIndex(idx) {
  if (idx < 0 || idx >= queue.length) return;
  currentIndex = idx;
  const url = queue[idx];
  videoPlayer.src = url;
  videoPlayer.style.display = 'block';
  videoPlayer.play();
  skipBtn.style.display = 'inline-block';
  // broadcast to room
  socket.emit('mediaSync', { roomId: ROOM_ID, action: 'play', url, currentTime: 0 });
  renderQueue();
}

function playNext() {
  const next = currentIndex + 1;
  if (next < queue.length) playIndex(next);
  else {
    currentIndex = -1;
    videoPlayer.style.display = 'none';
    skipBtn.style.display = 'none';
    renderQueue();
  }
}

// When video ends, auto next
videoPlayer.addEventListener('ended', () => {
  socket.emit('mediaSync', { roomId: ROOM_ID, action: 'skip' });
  playNext();
});

videoPlayer.addEventListener('pause', () => {
  socket.emit('mediaSync', { roomId: ROOM_ID, action: 'pause' });
});

document.getElementById('add-to-queue').addEventListener('click', () => addToQueue(mediaUrlInput.value));
mediaUrlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addToQueue(mediaUrlInput.value); });
skipBtn.addEventListener('click', () => {
  socket.emit('mediaSync', { roomId: ROOM_ID, action: 'skip' });
  playNext();
});

// SDK
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
        pairStatus.textContent = 'Paired';
        pairStatus.style.color = '#22c55e';
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

// Toy control
document.getElementById('send-toy').addEventListener('click', () => {
  const vibrate = Number(document.getElementById('vibrate-range').value);
  const rotate = Number(document.getElementById('rotate-range').value);
  const pump = Number(document.getElementById('pump-range').value);
  document.getElementById('vibrate-value').textContent = vibrate;
  document.getElementById('rotate-value').textContent = rotate;
  document.getElementById('pump-value').textContent = pump;
  const cmd = { vibrate, rotate, pump, time: 5 };
  if (activeSdk) activeSdk.sendToyCommand(cmd);
  socket.emit('toyCommand', { roomId: ROOM_ID, command: cmd });
});

document.getElementById('stop-toy').addEventListener('click', () => {
  if (activeSdk) activeSdk.sendToyCommand({ vibrate: 0, rotate: 0, pump: 0 });
  socket.emit('toyCommand', { roomId: ROOM_ID, command: { vibrate: 0, rotate: 0, pump: 0 } });
});

socket.on('toyCommand', (data) => {
  if (activeSdk) activeSdk.sendToyCommand(data.command);
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
document.getElementById('init-sdk').addEventListener('click', initSdk);
