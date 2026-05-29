// Age gate
const ageGate = document.getElementById('age-gate');
const appEl = document.getElementById('app');
if (localStorage.getItem('weplay-age') === 'verified') {
  ageGate.style.display = 'none';
  appEl.classList.add('show');
} else {
  document.getElementById('age-yes').addEventListener('click', () => {
    localStorage.setItem('weplay-age', 'verified');
    ageGate.style.display = 'none';
    appEl.classList.add('show');
  });
  document.getElementById('age-no').addEventListener('click', () => {
    window.location.href = 'https://google.com';
  });
}

let activeSdk = null;
const API_BASE = 'https://lovense-standard-api-starter.onrender.com';
const DEMO_UID = 'test-user-001';
const ROOM_ID = 'demo-room';

const commandOutput = document.getElementById('command-output');
const pairStatus = document.getElementById('status-text');
const statusDot = document.getElementById('status-dot');

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
  msg.className = 'msg';
  msg.innerHTML = `<span class="user">${data.user || 'anon'}</span><span class="time">${new Date(data.timestamp || Date.now()).toLocaleTimeString()}</span><br>${data.message}`;
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

// Media
let queue = [];
let currentIndex = -1;
const videoPlayer = document.getElementById('video-player');
const videoContainer = document.getElementById('video-container');
const placeholder = document.getElementById('placeholder');
const queueBar = document.getElementById('queue-bar');
const mediaUrlInput = document.getElementById('media-url');
const skipBtn = document.getElementById('skip-video');
videoPlayer.onerror = (e) => {
  console.warn('Video error:', videoPlayer.error ? videoPlayer.error.message : 'unknown');
  playNext();
};

socket.on('mediaSync', (data) => {
  if (data.action === 'play' && data.url) {
    if (data.isEmbed) {
      videoPlayer.style.display = 'none';
      placeholder.style.display = 'none';
      ytPlayer.style.display = 'block';
      ytPlayer.src = data.url;
    } else {
      ytPlayer.style.display = 'none';
      loadVideo(data.url, data.currentTime || 0);
    }
    if (data.playing !== undefined && !data.playing) videoPlayer.pause();
  } else if (data.action === 'skip') {
    playNext();
  }
});

function isDirectVideoUrl(url) {
  return /\.(mp4|webm|ogg|mov|avi|mkv|flv)(\?.*)?$/i.test(url);
}

function loadVideo(url, currentTime) {
  videoPlayer.style.display = 'block';
  placeholder.style.display = 'none';
  videoPlayer.src = url;
  videoPlayer.currentTime = currentTime || 0;
  videoPlayer.play().catch(() => {});
}

function renderQueue() {
  queueBar.innerHTML = '';
  queue.forEach((item, i) => {
    const div = document.createElement('div');
    div.className = 'q-item' + (i === currentIndex ? ' active' : '');
    const label = item.length > 40 ? item.slice(0, 40) + '…' : item;
    div.innerHTML = `<span>${i === currentIndex ? '▶ ' : ''}${label}</span><button class="remove" data-index="${i}">×</button>`;
    div.querySelector('.remove').addEventListener('click', (e) => {
      e.stopPropagation();
      removeFromQueue(i);
    });
    div.addEventListener('click', () => playIndex(i));
    queueBar.appendChild(div);
  });
}

function addToQueue(url) {
  const trimmed = url.trim();
  if (!trimmed) return;
  if (!isDirectVideoUrl(trimmed)) {
    commandOutput.textContent = 'Unsupported URL. Use a direct video link (.mp4, .webm, etc.)';
    return;
  }
  queue.push(trimmed);
  renderQueue();
  mediaUrlInput.value = '';
  if (currentIndex === -1) playIndex(0);
}

function removeFromQueue(idx) {
  queue.splice(idx, 1);
  if (idx < currentIndex) currentIndex--;
  else if (idx === currentIndex) {
    currentIndex = -1;
    videoPlayer.style.display = 'none';
    placeholder.style.display = 'flex';
    skipBtn.style.display = 'none';
  }
  renderQueue();
}

function playIndex(idx) {
  if (idx < 0 || idx >= queue.length) return;
  currentIndex = idx;
  const url = queue[idx];
  loadVideo(url);
  skipBtn.style.display = 'inline-block';
  socket.emit('mediaSync', { roomId: ROOM_ID, action: 'play', url, currentTime: 0, playing: true });
  renderQueue();
}

function playNext() {
  const next = currentIndex + 1;
  if (next < queue.length) playIndex(next);
  else {
    currentIndex = -1;
    videoPlayer.style.display = 'none';
    placeholder.style.display = 'flex';
    skipBtn.style.display = 'none';
    renderQueue();
  }
}

videoPlayer.addEventListener('ended', () => {
  socket.emit('mediaSync', { roomId: ROOM_ID, action: 'skip' });
  playNext();
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
      alert('Missing authToken – backend not configured');
      return;
    }
    const sdk = new LovenseBasicSdk({
      uid: DEMO_UID,
      platform: 'WePlay',
      authToken: authData.authToken
    });
    sdk.on('ready', async () => {
      try {
        const qr = await sdk.getQrcode();
        if (qr.qrcodeUrl) {
          window.open(qr.qrcodeUrl, '_blank');
          pairStatus.textContent = 'QR opened';
        } else if (qr.qrcode) {
          pairStatus.textContent = 'QR received';
        }
        activeSdk = sdk;
        statusDot.classList.add('online');
        pairStatus.textContent = 'Paired';
      } catch (e) {
        console.error(e);
      }
    });
    sdk.on('sdkError', (e) => {
      console.error('SDK error', e);
    });
  } catch (e) {
    console.error(e);
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

chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    document.getElementById('send-chat').click();
  }
});

// Request control
document.getElementById('request-control').addEventListener('click', () => {
  socket.emit('controlRequest', { roomId: ROOM_ID, uid: DEMO_UID });
  commandOutput.textContent = 'Control request sent';
});

// Tab switching + browse init
document.querySelectorAll('[data-tab]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-tab]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.tab-content').forEach(tc => tc.classList.add('hidden'));
    const tabId = 'tab-' + btn.dataset.tab;
    document.getElementById(tabId).classList.remove('hidden');
    if (btn.dataset.tab === 'browse') loadVideos();
  });
});

// Video browser
const videoGrid = document.getElementById('video-grid');
const browseSearch = document.getElementById('browse-search');
const browseLoading = document.getElementById('browse-loading');
const ytPlayer = document.getElementById('yt-player');
let browsePage = 1;
let browseSearchTerm = '';
let loadingVideos = false;

async function loadVideos() {
  if (loadingVideos) return;
  loadingVideos = true;
  browseLoading.style.display = 'block';
  try {
    const params = new URLSearchParams({ page: browsePage, limit: 20 });
    if (browseSearchTerm) params.set('search', browseSearchTerm);
    const res = await fetch(`${API_BASE}/videos?${params}`);
    const data = await res.json();
    if (browsePage === 1) videoGrid.innerHTML = '';
    data.videos.forEach(v => {
      const div = document.createElement('div');
      div.className = 'vitem';
      const mins = Math.floor(v.duration / 60);
      const secs = v.duration % 60;
      div.innerHTML = `
        <img src="${v.thumbnail}" loading="lazy" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22320%22 height=%22180%22><rect fill=%22%231c2135%22 width=%22320%22 height=%22180%22/><text fill=%22%238b91a8%22 x=%22160%22 y=%2290%22 text-anchor=%22middle%22 font-size=%2214%22>No thumb</text></svg>'">
        <div class="vinfo">
          <div class="vtitle">${v.title}</div>
          <div class="vmeta">${mins}:${secs.toString().padStart(2, '0')} · ${(v.views / 1000).toFixed(0)}k views</div>
        </div>
      `;
      div.addEventListener('click', () => playEmbed(v.embed, v.title));
      videoGrid.appendChild(div);
    });
    browseLoading.style.display = 'none';
    loadingVideos = false;
    if (data.hasMore) browsePage++;
  } catch (e) {
    browseLoading.textContent = 'Failed to load videos';
    loadingVideos = false;
  }
}

// Infinite scroll on browse tab
document.getElementById('tab-browse').addEventListener('scroll', () => {
  const el = document.getElementById('tab-browse');
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 100) loadVideos();
});

browseSearch.addEventListener('input', () => {
  clearTimeout(browseSearch._timer);
  browseSearch._timer = setTimeout(() => {
    browseSearchTerm = browseSearch.value.trim();
    browsePage = 1;
    loadVideos();
  }, 400);
});

function playEmbed(embedHtml, title) {
  // Extract iframe src from embed HTML
  const match = embedHtml.match(/src="([^"]+)"/);
  if (match) {
    videoPlayer.style.display = 'none';
    placeholder.style.display = 'none';
    ytPlayer.style.display = 'block';
    ytPlayer.src = match[1];
    // Broadcast to room
    socket.emit('mediaSync', { roomId: ROOM_ID, action: 'play', url: match[1], playing: true, isEmbed: true });
  }
}

// Init
document.getElementById('init-sdk').addEventListener('click', initSdk);
