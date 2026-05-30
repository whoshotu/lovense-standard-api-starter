// ==================== Age Gate ====================
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

// ==================== Constants ====================
let activeSdk = null;
let currentUid = '';
let currentRoom = '';
let hasUtoken = false;
const API_BASE = 'https://lovense-standard-api-starter.onrender.com';

// ==================== DOM Refs ====================
const sessionSetup = document.getElementById('session-setup');
const mainLayout = document.getElementById('main-layout');
const setupError = document.getElementById('setup-error');
const roomCodeInput = document.getElementById('room-code-input');
const roomInfo = document.getElementById('room-info');
const roomDisplay = document.getElementById('room-display');
const copyInvite = document.getElementById('copy-invite');
const commandOutput = document.getElementById('command-output');
const pairStatus = document.getElementById('status-text');
const statusDot = document.getElementById('status-dot');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');

// Media
let queue = [];
let currentIndex = -1;
const videoPlayer = document.getElementById('video-player');
const preloadPlayer = document.getElementById('preload-player');
const videoContainer = document.getElementById('video-container');
const placeholder = document.getElementById('placeholder');
const queueBar = document.getElementById('queue-bar');
const ytPlayer = document.getElementById('yt-player');
const playBtn = document.getElementById('play-btn');
const volumeSlider = document.getElementById('volume-slider');

// Browse
const videoGrid = document.getElementById('video-grid');
const browseSearch = document.getElementById('browse-search');
const browseLoading = document.getElementById('browse-loading');
const sortSelect = document.getElementById('sort-select');
const categorySelect = document.getElementById('category-select');

// Control
const controlModeSelect = document.getElementById('control-mode-select');
const controlStatus = document.getElementById('control-status');
const controllerDisplay = document.getElementById('controller-display');
const requestCtrlBtn = document.getElementById('request-control');
const releaseCtrlBtn = document.getElementById('release-control');
const toyOwnerStatus = document.getElementById('toy-owner-status');

let browsePage = 1;
let browseSearchTerm = '';
let loadingVideos = false;

// ==================== Socket ====================
let socket = null;

function connectSocket(uid, token) {
  if (socket && socket.connected) socket.disconnect();
  socket = io(API_BASE, {
    transports: ['websocket'],
    auth: { uid, token }
  });

  socket.on('connect', () => {
    console.log('[socket] connected as', uid);
  });

  socket.on('connected', (data) => {
    console.log('[socket] confirmed', data);
    if (data.toyStatus) {
      updateToyStatus(data.toyStatus);
    }
  });

  socket.on('connect_error', (err) => {
    console.error('[socket] error:', err.message);
  });

  socket.on('error', (data) => {
    setupError.textContent = data.message;
  });

  socket.on('roomCreated', (data) => {
    currentRoom = data.roomId;
    enterRoom(data.roomId);
  });

  socket.on('userJoined', (data) => {
    addChatMessage('system', `${data.uid} joined the room`);
  });

  socket.on('userLeft', (data) => {
    addChatMessage('system', `${data.uid} left the room`);
  });

  socket.on('chatMessage', (data) => {
    addChatMessage(data.user, data.message, data.timestamp);
  });

  socket.on('toyPaired', (data) => {
    updateToyStatus(data.status || 'disconnected');
  });

  // Media sync
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

  // Control
  socket.on('controlModeChanged', (data) => {
    controlModeSelect.value = data.mode;
    updateControlStatus(data.mode, null);
  });

  socket.on('controlStatus', (data) => {
    updateControlStatus(data.mode, data.controllerUid);
  });

  socket.on('controlRequest', (data) => {
    if (confirm(`${data.uid} wants to control your toy. Accept?`)) {
      socket.emit('controlResponse', { roomId: currentRoom, accept: true });
    } else {
      socket.emit('controlResponse', { roomId: currentRoom, accept: false });
    }
  });

  socket.on('controlResponse', (data) => {
    addChatMessage('system', `Control request ${data.accept ? 'accepted' : 'declined'} by ${data.uid}`);
  });

  socket.on('toyCommand', (data) => {
    if (activeSdk) {
      activeSdk.sendToyCommand(data.command);
      commandOutput.textContent = `Command from ${data.from}: V${data.command.vibrate || 0} R${data.command.rotate || 0} P${data.command.pump || 0}`;
    }
  });

  socket.on('userStatus', (data) => {
    if (data.toyStatus === 'paired') {
      toyOwnerStatus.textContent = `${data.uid}'s toy is paired and ready`;
    }
  });
}

// ==================== Room Setup ====================
document.getElementById('create-room').addEventListener('click', () => {
  if (!currentUid) {
    setupError.textContent = 'Please pair a toy first or set a UID';
    return;
  }
  socket.emit('createRoom');
});

document.getElementById('join-room').addEventListener('click', () => {
  const code = roomCodeInput.value.trim();
  if (!code) { setupError.textContent = 'Enter an invite code'; return; }
  if (!currentUid) { setupError.textContent = 'Please set up your identity first'; return; }
  currentRoom = code;
  socket.emit('joinRoom', { roomId: code });
});

roomCodeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('join-room').click();
});

copyInvite.addEventListener('click', () => {
  navigator.clipboard.writeText(currentRoom).then(() => {
    copyInvite.textContent = 'Copied!';
    setTimeout(() => { copyInvite.textContent = 'Copy'; }, 2000);
  });
});

function enterRoom(roomId) {
  currentRoom = roomId;
  sessionSetup.classList.add('hidden');
  mainLayout.classList.remove('hidden');
  roomInfo.style.display = 'flex';
  roomDisplay.textContent = roomId;

  // Set default control mode
  if (socket) {
    socket.emit('setControlMode', { roomId, mode: controlModeSelect.value });
  }

  // Load categories for filter
  loadCategories();
  // Initial browse load
  loadVideos();
  // Welcome message
  addChatMessage('system', `Joined room ${roomId}. Select a video from Browse to start!`);
}

// ==================== Chat ====================
function addChatMessage(user, message, timestamp) {
  const msg = document.createElement('div');
  msg.className = 'msg';
  if (user === 'system') {
    msg.style.color = 'var(--muted)';
    msg.style.fontStyle = 'italic';
    msg.textContent = message;
  } else {
    msg.innerHTML = `<span class="user">${user}</span><span class="time">${timestamp ? new Date(timestamp).toLocaleTimeString() : ''}</span><br>${message}`;
  }
  chatMessages.appendChild(msg);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

document.getElementById('send-chat').addEventListener('click', () => {
  const message = chatInput.value.trim();
  if (!message || !currentRoom) return;
  socket.emit('chatMessage', { roomId: currentRoom, message });
  chatInput.value = '';
});

chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    document.getElementById('send-chat').click();
  }
});

// ==================== Media Controls ====================
playBtn.addEventListener('click', () => {
  if (videoPlayer.style.display !== 'none' && videoPlayer.src) {
    if (videoPlayer.paused) {
      videoPlayer.play();
      playBtn.textContent = '⏸';
    } else {
      videoPlayer.pause();
      playBtn.textContent = '▶';
    }
  } else if (ytPlayer.style.display !== 'none' && ytPlayer.src) {
    // For embeds, we can't control easily, but broadcast play/pause
    socket.emit('mediaSync', { roomId: currentRoom, action: 'play', url: ytPlayer.src, playing: false });
  }
});

videoPlayer.addEventListener('play', () => { playBtn.textContent = '⏸'; });
videoPlayer.addEventListener('pause', () => { playBtn.textContent = '▶'; });

volumeSlider.addEventListener('input', () => {
  videoPlayer.volume = parseFloat(volumeSlider.value);
});

videoPlayer.onerror = (e) => {
  console.warn('Video error:', videoPlayer.error ? videoPlayer.error.message : 'unknown');
  playNext();
};

// ==================== Queue & Auto-Queue ====================
function isDirectVideoUrl(url) {
  return /\.(mp4|webm|ogg|mov|avi|mkv|flv)(\?.*)?$/i.test(url);
}

function loadVideo(url, currentTime) {
  videoPlayer.style.display = 'block';
  placeholder.style.display = 'none';
  ytPlayer.style.display = 'none';
  videoPlayer.src = url;
  videoPlayer.currentTime = currentTime || 0;
  videoPlayer.play().catch(() => {});
  playBtn.textContent = '⏸';
}

function renderQueue() {
  queueBar.innerHTML = '';
  queue.forEach((item, i) => {
    const div = document.createElement('div');
    div.className = 'q-item' + (i === currentIndex ? ' active' : '');
    const label = item.title ? (item.title.length > 40 ? item.title.slice(0, 40) + '…' : item.title) : (item.url.length > 40 ? item.url.slice(0, 40) + '…' : item.url);
    div.innerHTML = `<span>${i === currentIndex ? '▶ ' : ''}${label}</span>`;
    div.addEventListener('click', () => playIndex(i));
    queueBar.appendChild(div);
  });
}

function addToQueue(entry) {
  queue.push(entry);
  renderQueue();
  if (currentIndex === -1) playIndex(0);
}

function playIndex(idx) {
  if (idx < 0 || idx >= queue.length) return;
  currentIndex = idx;
  const entry = queue[idx];
  if (entry.embed) {
    playEmbed(entry.embed, entry.title);
  } else {
    loadVideo(entry.url);
    socket.emit('mediaSync', { roomId: currentRoom, action: 'play', url: entry.url, currentTime: 0, playing: true });
  }
  renderQueue();
  preloadNext();
}

function playNext() {
  const next = currentIndex + 1;
  if (next < queue.length) playIndex(next);
  else {
    currentIndex = -1;
    videoPlayer.style.display = 'none';
    placeholder.style.display = 'flex';
    ytPlayer.style.display = 'none';
    renderQueue();
  }
}

function preloadNext() {
  const next = currentIndex + 1;
  if (next < queue.length) {
    const entry = queue[next];
    if (entry.url && isDirectVideoUrl(entry.url)) {
      preloadPlayer.src = entry.url;
    }
  }
}

// Auto-remove on end + play next
videoPlayer.addEventListener('ended', () => {
  socket.emit('mediaSync', { roomId: currentRoom, action: 'skip' });
  // Remove finished video from queue
  queue.splice(currentIndex, 1);
  playNext();
});

// Pre-load 10 seconds before end
videoPlayer.addEventListener('timeupdate', () => {
  if (videoPlayer.duration && videoPlayer.currentTime >= videoPlayer.duration - 10) {
    preloadNext();
  }
});

// ==================== Video Browser ====================
async function loadCategories() {
  try {
    const res = await fetch(`${API_BASE}/videos/categories`);
    const data = await res.json();
    categorySelect.innerHTML = '<option value="">All Categories</option>';
    data.categories.forEach(cat => {
      const opt = document.createElement('option');
      opt.value = cat;
      opt.textContent = cat;
      categorySelect.appendChild(opt);
    });
  } catch (e) {
    console.warn('Failed to load categories:', e);
  }
}

async function loadVideos() {
  if (loadingVideos) return;
  loadingVideos = true;
  browseLoading.style.display = 'block';
  try {
    const params = new URLSearchParams({ page: browsePage, limit: 20 });
    if (browseSearchTerm) params.set('search', browseSearchTerm);
    const sort = sortSelect.value;
    if (sort) params.set('sort', sort);
    const cat = categorySelect.value;
    if (cat) params.set('category', cat);
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
      div.addEventListener('click', () => {
        addToQueue({ embed: v.embed, title: v.title, thumbnail: v.thumbnail });
      });
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

// Infinite scroll
document.getElementById('tab-browse').addEventListener('scroll', () => {
  const el = document.getElementById('tab-browse');
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 100) loadVideos();
});

// Search debounce
browseSearch.addEventListener('input', () => {
  clearTimeout(browseSearch._timer);
  browseSearch._timer = setTimeout(() => {
    browseSearchTerm = browseSearch.value.trim();
    browsePage = 1;
    loadVideos();
  }, 400);
});

// Sort / category change
sortSelect.addEventListener('change', () => { browsePage = 1; loadVideos(); });
categorySelect.addEventListener('change', () => { browsePage = 1; loadVideos(); });

// ==================== Embed Player ====================
function playEmbed(embedHtml, title) {
  const match = embedHtml.match(/src="([^"]+)"/);
  if (match) {
    videoPlayer.style.display = 'none';
    placeholder.style.display = 'none';
    ytPlayer.style.display = 'block';
    ytPlayer.src = match[1];
    socket.emit('mediaSync', { roomId: currentRoom, action: 'play', url: match[1], playing: true, isEmbed: true });
  }
}

// ==================== Control Permissions ====================
function updateControlStatus(mode, controllerUid) {
  const modeLabels = { none: 'None', granted: 'Granted', mutual: 'Mutual', master: 'Master' };
  const modeText = modeLabels[mode] || mode;
  const controller = controllerUid || (mode === 'mutual' ? 'Both' : (mode === 'master' ? 'Creator' : '—'));
  controlStatus.innerHTML = `Mode: <span class="highlight">${modeText}</span> &middot; Controller: <span class="highlight">${controller}</span>`;
  controllerDisplay.textContent = controller;
}

controlModeSelect.addEventListener('change', () => {
  if (currentRoom) {
    socket.emit('setControlMode', { roomId: currentRoom, mode: controlModeSelect.value });
  }
});

requestCtrlBtn.addEventListener('click', () => {
  if (!currentRoom) return;
  socket.emit('controlRequest', { roomId: currentRoom });
});

releaseCtrlBtn.addEventListener('click', () => {
  if (!currentRoom) return;
  socket.emit('releaseControl', { roomId: currentRoom });
});

// ==================== SDK / Toy Pairing ====================
async function initSdk() {
  try {
    const authRes = await fetch(`${API_BASE}/auth?uid=${currentUid}`);
    const authData = await authRes.json();
    if (!authData.authToken) {
      alert('Missing authToken – backend not configured');
      return;
    }
    currentUid = authData.uid;
    hasUtoken = !!authData.utoken;

    // Reconnect socket with utoken for full auth
    if (authData.utoken) {
      connectSocket(currentUid, authData.utoken);
      // Rejoin room if already in one
      if (currentRoom) {
        setTimeout(() => socket.emit('joinRoom', { roomId: currentRoom }), 500);
      }
    }

    const sdk = new LovenseBasicSdk({
      uid: currentUid,
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
        // Report toy status
        if (socket && socket.connected) {
          socket.emit('deviceStatus', { status: 'paired' });
        }
      } catch (e) {
        console.error(e);
      }
    });

    sdk.on('sdkError', (e) => {
      console.error('SDK error', e);
      if (socket && socket.connected) {
        socket.emit('deviceStatus', { status: 'disconnected' });
      }
    });
  } catch (e) {
    console.error(e);
  }
}

function updateToyStatus(status) {
  if (status === 'paired') {
    statusDot.classList.add('online');
    pairStatus.textContent = 'Paired';
  } else {
    statusDot.classList.remove('online');
    pairStatus.textContent = 'Toy disconnected';
  }
}

document.getElementById('init-sdk').addEventListener('click', initSdk);

// ==================== Toy Control ====================
document.getElementById('send-toy').addEventListener('click', () => {
  const vibrate = Number(document.getElementById('vibrate-range').value);
  const rotate = Number(document.getElementById('rotate-range').value);
  const pump = Number(document.getElementById('pump-range').value);
  document.getElementById('vibrate-value').textContent = vibrate;
  document.getElementById('rotate-value').textContent = rotate;
  document.getElementById('pump-value').textContent = pump;
  const cmd = { vibrate, rotate, pump, time: 5 };
  if (activeSdk) activeSdk.sendToyCommand(cmd);
  socket.emit('toyCommand', { roomId: currentRoom, command: cmd });
  commandOutput.textContent = `Sent: V${vibrate} R${rotate} P${pump}`;
});

document.getElementById('stop-toy').addEventListener('click', () => {
  if (activeSdk) activeSdk.sendToyCommand({ vibrate: 0, rotate: 0, pump: 0 });
  socket.emit('toyCommand', { roomId: currentRoom, command: { vibrate: 0, rotate: 0, pump: 0 } });
  commandOutput.textContent = 'Stop command sent';
});

// ==================== Tab Switching ====================
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

// ==================== Init ====================
// Generate or restore anonymous UID for non-toy users
let storedUid = localStorage.getItem('weplay-uid');
if (!storedUid) {
  storedUid = 'user_' + Math.random().toString(36).substr(2, 8);
  localStorage.setItem('weplay-uid', storedUid);
}
currentUid = storedUid;

// Connect socket immediately with just uid (no token = basic mode)
connectSocket(currentUid, null);
