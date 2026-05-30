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

// ==================== State ====================
let activeSdk = null;
let currentPattern = null;
let currentUid = '';
let currentRoom = 'community';
let isPrivateRoom = false;
let hasUtoken = false;
let queue = [];
let currentIndex = -1;
const API_BASE = 'https://lovense-standard-api-starter.onrender.com';

// ==================== DOM Refs ====================
const mainLayout = document.getElementById('main-layout');
const roomName = document.getElementById('room-name');
const roomBadge = document.getElementById('room-badge');
const createPrivateBtn = document.getElementById('create-private-btn');
const leaveRoomBtn = document.getElementById('leave-room-btn');
const overlay = document.getElementById('session-overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlaySub = document.getElementById('overlay-sub');
const overlayInvite = document.getElementById('overlay-invite');
const overlayJoin = document.getElementById('overlay-join');
const overlayError = document.getElementById('overlay-error');
const inviteCodeDisplay = document.getElementById('invite-code-display');
const roomCodeInput = document.getElementById('room-code-input');
const commandOutput = document.getElementById('command-output');
const pairStatus = document.getElementById('status-text');
const statusDot = document.getElementById('status-dot');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');

// Media
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
const controlSection = document.getElementById('control-section');
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
    if (data.toyStatus) updateToyStatus(data.toyStatus);
  });

  socket.on('connect_error', (err) => {
    console.error('[socket] error:', err.message);
  });

  socket.on('error', (data) => {
    overlayError.textContent = data.message;
  });

  socket.on('roomJoined', (data) => {
    if (data.isCommunity) {
      currentRoom = 'community';
      isPrivateRoom = false;
      enterRoom(currentRoom);
    }
  });

  socket.on('roomCreated', (data) => {
    currentRoom = data.roomId;
    isPrivateRoom = true;
    enterRoom(data.roomId);
    showInviteModal(data.roomId);
  });

  socket.on('userJoined', (data) => {
    addChatMessage('system', `${data.uid} joined`);
    if (data.totalMembers !== undefined) {
      updateRoomInfo(data.totalMembers);
    }
  });

  socket.on('userLeft', (data) => {
    addChatMessage('system', `${data.uid} left`);
    if (data.totalMembers !== undefined) {
      updateRoomInfo(data.totalMembers);
    }
  });

  socket.on('chatMessage', (data) => {
    addChatMessage(data.user, data.message, data.timestamp);
  });

  socket.on('toyPaired', (data) => {
    updateToyStatus(data.status || 'disconnected');
  });

  // ---- Queue Sync ----
  socket.on('queueUpdate', (data) => {
    queue = data.queue || [];
    currentIndex = data.currentIndex !== undefined ? data.currentIndex : -1;
    renderQueue();
    if (currentIndex === -1) {
      videoPlayer.style.display = 'none';
      ytPlayer.style.display = 'none';
      placeholder.style.display = 'flex';
    }
  });

  socket.on('queueNowPlaying', (data) => {
    if (data.index === -1 || !data.entry) {
      currentIndex = -1;
      videoPlayer.style.display = 'none';
      ytPlayer.style.display = 'none';
      placeholder.style.display = 'flex';
      playBtn.textContent = '▶';
      renderQueue();
      return;
    }
    currentIndex = data.index;
    const entry = data.entry;
    if (entry.embed) {
      playEmbed(entry.embed, entry.title);
    } else if (entry.url) {
      loadVideo(entry.url);
    }
    // Start Pattern SDK sync for direct video
    if (entry.url && isDirectVideoUrl(entry.url)) {
      const mediaId = 'media_' + (entry.title ? entry.title.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30) : String(currentIndex));
      startPatternSync(mediaId, videoPlayer.duration * 1000 || 60000, videoPlayer);
    }
    renderQueue();
  });

  // ---- Media Sync ----
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
    }
  });

  // ---- Control ----
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
    addChatMessage('system', `Control ${data.accept ? 'accepted' : 'declined'}`);
  });

  socket.on('toyCommand', (data) => {
    if (activeSdk) {
      activeSdk.sendToyCommand(data.command);
      commandOutput.textContent = `Command from ${data.from}: V${data.command.vibrate || 0} R${data.command.rotate || 0} P${data.command.pump || 0}`;
    }
  });

  socket.on('userStatus', (data) => {
    if (data.toyStatus === 'paired') {
      toyOwnerStatus.textContent = `${data.uid}'s toy is paired`;
    }
  });
}

// ==================== Room Management ====================
function enterRoom(roomId) {
  currentRoom = roomId;
  mainLayout.style.display = 'flex';
  roomName.textContent = isPrivateRoom ? roomId : 'Community';
  roomBadge.innerHTML = isPrivateRoom ? `<span>🔒</span><span class="name">${roomId}</span>` : `<span>🌐</span><span class="name">Community</span>`;
  createPrivateBtn.style.display = isPrivateRoom ? 'none' : 'inline-block';
  leaveRoomBtn.style.display = isPrivateRoom ? 'inline-block' : 'none';
  controlSection.style.display = isPrivateRoom ? 'block' : 'none';
  if (isPrivateRoom) {
    controlModeSelect.value = 'none';
  }
  loadCategories();
  loadVideos();
}

function updateRoomInfo(count) {
  if (!isPrivateRoom) {
    roomName.textContent = `Community (${count})`;
  }
}

function showOverlay(title, sub) {
  overlayTitle.textContent = title;
  overlaySub.textContent = sub;
  overlay.classList.add('show');
  overlayError.textContent = '';
}

function hideOverlay() {
  overlay.classList.remove('show');
}

function showInviteModal(code) {
  overlayInvite.style.display = 'block';
  overlayJoin.style.display = 'none';
  document.querySelector('#session-overlay .btns .close-btn').textContent = 'Close';
  inviteCodeDisplay.textContent = code;
  showOverlay('Room Created', 'Share this code with your partner');
}

// ---- Overlay Buttons ----
createPrivateBtn.addEventListener('click', () => {
  overlayInvite.style.display = 'none';
  overlayJoin.style.display = 'block';
  document.querySelector('#session-overlay .btns .close-btn').textContent = 'Cancel';
  showOverlay('Private Session', 'Create a private room or join one');
});

document.getElementById('close-overlay').addEventListener('click', hideOverlay);

document.getElementById('create-room-btn').addEventListener('click', () => {
  hideOverlay();
  socket.emit('createRoom');
});

document.getElementById('join-room-btn').addEventListener('click', () => {
  const code = roomCodeInput.value.trim();
  if (!code) { overlayError.textContent = 'Enter a code'; return; }
  hideOverlay();
  socket.emit('joinRoom', { roomId: code });
});

roomCodeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('join-room-btn').click();
});

document.getElementById('copy-invite-btn').addEventListener('click', () => {
  navigator.clipboard.writeText(inviteCodeDisplay.textContent).then(() => {
    document.getElementById('copy-invite-btn').textContent = 'Copied!';
    setTimeout(() => { document.getElementById('copy-invite-btn').textContent = 'Copy Code'; }, 2000);
  });
});

leaveRoomBtn.addEventListener('click', () => {
  socket.emit('leaveRoom', { roomId: currentRoom });
});

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
  }
});

videoPlayer.addEventListener('play', () => { playBtn.textContent = '⏸'; });
videoPlayer.addEventListener('pause', () => { playBtn.textContent = '▶'; });

volumeSlider.addEventListener('input', () => {
  videoPlayer.volume = parseFloat(volumeSlider.value);
});

videoPlayer.onerror = (e) => {
  console.warn('Video error:', videoPlayer.error ? videoPlayer.error.message : 'unknown');
  socket.emit('queueSkip', { roomId: currentRoom });
};

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
    const label = item.title ? (item.title.length > 36 ? item.title.slice(0, 36) + '…' : item.title) : 'Video';
    div.innerHTML = `<span>${i === currentIndex ? '▶ ' : ''}${label}</span>`;
    div.addEventListener('click', () => {
      socket.emit('queuePlayIndex', { roomId: currentRoom, index: i });
    });
    queueBar.appendChild(div);
  });
  if (queue.length === 0 && currentIndex === -1) {
    placeholder.style.display = 'flex';
    videoPlayer.style.display = 'none';
    ytPlayer.style.display = 'none';
  }
}

// Preload next before end
videoPlayer.addEventListener('timeupdate', () => {
  if (videoPlayer.duration && videoPlayer.currentTime >= videoPlayer.duration - 10) {
    const next = currentIndex + 1;
    if (next < queue.length && queue[next].url && isDirectVideoUrl(queue[next].url)) {
      preloadPlayer.src = queue[next].url;
    }
  }
});

// Auto-skip on end
videoPlayer.addEventListener('ended', () => {
  socket.emit('queueSkip', { roomId: currentRoom });
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
        socket.emit('queueAdd', {
          roomId: currentRoom,
          entry: { embed: v.embed, title: v.title, thumbnail: v.thumbnail, url: v.url || '' }
        });
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
    playBtn.textContent = '⏸';
  }
}

// ==================== Pattern Sync ====================
async function fetchCtoken(uid) {
  const res = await fetch(`${API_BASE}/ctoken?uid=${uid}`);
  return res.json();
}

async function startPatternSync(mediaId, durationMs, videoEl) {
  if (currentPattern) {
    currentPattern.exit();
    currentPattern = null;
  }
  try {
    const { ctoken, affiliateLink } = await fetchCtoken(currentUid);
    if (!ctoken) return;
    currentPattern = new LovensePattern();
    currentPattern.sync({
      ctoken,
      mediaId,
      duration: durationMs,
      videoEl,
      btnId: 'sync-btn-container',
      supportedApp: 3,
      supportAiSync: 1,
      affiliateLink: affiliateLink || ''
    });
  } catch (e) {
    console.warn('[pattern] sync failed:', e);
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
  if (currentRoom && isPrivateRoom) {
    socket.emit('setControlMode', { roomId: currentRoom, mode: controlModeSelect.value });
  }
});

requestCtrlBtn.addEventListener('click', () => {
  if (currentRoom) socket.emit('controlRequest', { roomId: currentRoom });
});

releaseCtrlBtn.addEventListener('click', () => {
  if (currentRoom) socket.emit('releaseControl', { roomId: currentRoom });
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

    if (authData.utoken) {
      connectSocket(currentUid, authData.utoken);
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
  commandOutput.textContent = 'Stop sent';
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
let storedUid = localStorage.getItem('weplay-uid');
if (!storedUid) {
  storedUid = 'user_' + Math.random().toString(36).substr(2, 8);
  localStorage.setItem('weplay-uid', storedUid);
}
currentUid = storedUid;

connectSocket(currentUid, null);
