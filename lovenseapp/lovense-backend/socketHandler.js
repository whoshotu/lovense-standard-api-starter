const { Server } = require('socket.io');

const connectedClients = {};
const rooms = {};

function initSocket(server, userSessions) {
  // Auto-create community room
  rooms['community'] = {
    creator: null,
    members: [],
    controllerMode: 'none',
    controllerUid: null,
    pendingRequest: null,
    queue: [],
    currentIndex: -1,
    createdAt: new Date().toISOString()
  };

  function sendQueueState(roomId) {
    const room = rooms[roomId];
    if (!room) return;
    io.to(roomId).emit('queueUpdate', { queue: room.queue, currentIndex: room.currentIndex });
  }

  const io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] }
  });

  // Auth middleware
  io.use((socket, next) => {
    const { uid, token } = socket.handshake.auth || {};
    if (!uid) return next(new Error('Missing uid'));
    const session = userSessions[uid];
    if (session && session.utoken && token !== session.utoken) {
      return next(new Error('Invalid token'));
    }
    socket.uid = uid;
    socket.isAuthenticated = !!session;
    next();
  });

  io.on('connection', socket => {
    const uid = socket.uid;
    console.log(`[socket] connected ${socket.id} uid=${uid}`);

    // Track client
    if (!connectedClients[uid]) {
      connectedClients[uid] = { socketIds: [], status: 'online', toyStatus: 'disconnected', connectedAt: new Date().toISOString() };
    }
    connectedClients[uid].socketIds.push(socket.id);
    connectedClients[uid].status = 'online';

    // Auto-join community room
    socket.join('community');
    rooms['community'].members.push(uid);
    sendQueueState('community');
    socket.emit('roomJoined', { roomId: 'community', isCommunity: true });
    console.log(`[room] ${uid} auto-joined community`);

    // ---- Room Management ----
    socket.on('createRoom', ({ roomId } = {}) => {
      const id = roomId || `room_${Math.random().toString(36).substr(2, 6)}`;
      rooms[id] = {
        creator: uid,
        members: [uid],
        controllerMode: 'none',
        controllerUid: null,
        pendingRequest: null,
        queue: [],
        currentIndex: -1,
        createdAt: new Date().toISOString()
      };
      // Leave community
      leaveCommunityRoom(socket, io);
      socket.join(id);
      socket.emit('roomCreated', { roomId: id, inviteCode: id });
      socket.emit('roomJoined', { roomId: id, isCommunity: false });
      sendQueueState(id);
      console.log(`[room] ${uid} created private room ${id}`);
    });

    socket.on('joinRoom', ({ roomId }) => {
      const room = rooms[roomId];
      if (!room) return socket.emit('error', { message: 'Room not found' });
      if (room.members.length >= 2 && roomId !== 'community') return socket.emit('error', { message: 'Private room is full (max 2)' });
      if (room.members.includes(uid)) return;

      // Leave community if joining a non-community room
      if (roomId !== 'community') {
        leaveCommunityRoom(socket, io);
      }
      room.members.push(uid);
      socket.join(roomId);
      io.to(roomId).emit('userJoined', { uid, members: room.members, totalMembers: room.members.length });
      socket.emit('roomJoined', { roomId, isCommunity: roomId === 'community' });
      sendQueueState(roomId);
      if (room.controllerUid) {
        socket.emit('controlStatus', { controllerUid: room.controllerUid, mode: room.controllerMode });
      }
      console.log(`[room] ${uid} joined room ${roomId}`);
    });

    socket.on('leaveRoom', ({ roomId }) => {
      handleLeaveRoom(socket, roomId, io);
    });

    socket.on('disconnect', () => {
      handleDisconnect(uid, socket.id, io);
    });

    // ---- Server Queue ----
    socket.on('queueAdd', ({ roomId, entry }) => {
      const room = rooms[roomId];
      if (!room) return;
      // Prevent duplicate embeds in queue
      if (entry.embed && room.queue.some(e => e.embed === entry.embed)) {
        return socket.emit('queueDuplicate', { message: 'Already in queue' });
      }
      room.queue.push(entry);
      if (room.currentIndex === -1) {
        room.currentIndex = 0;
        io.to(roomId).emit('queueNowPlaying', { index: 0, entry: room.queue[0] });
      }
      sendQueueState(roomId);
    });

    socket.on('queueRemove', ({ roomId, index }) => {
      const room = rooms[roomId];
      if (!room || index < 0 || index >= room.queue.length) return;
      room.queue.splice(index, 1);
      if (index < room.currentIndex) room.currentIndex--;
      else if (index === room.currentIndex) {
        room.currentIndex = -1;
        if (room.queue.length > 0) {
          room.currentIndex = 0;
          io.to(roomId).emit('queueNowPlaying', { index: 0, entry: room.queue[0] });
        } else {
          io.to(roomId).emit('queueNowPlaying', { index: -1, entry: null });
        }
      }
      sendQueueState(roomId);
    });

    socket.on('queuePlayIndex', ({ roomId, index }) => {
      const room = rooms[roomId];
      if (!room || index < 0 || index >= room.queue.length) return;
      room.currentIndex = index;
      io.to(roomId).emit('queueNowPlaying', { index, entry: room.queue[index] });
      sendQueueState(roomId);
    });

    socket.on('queueSkip', ({ roomId }) => {
      const room = rooms[roomId];
      if (!room) return;
      // Remove current, advance to next
      if (room.currentIndex >= 0 && room.currentIndex < room.queue.length) {
        room.queue.splice(room.currentIndex, 1);
      }
      if (room.queue.length > 0) {
        room.currentIndex = 0;
        io.to(roomId).emit('queueNowPlaying', { index: 0, entry: room.queue[0] });
      } else {
        room.currentIndex = -1;
        io.to(roomId).emit('queueNowPlaying', { index: -1, entry: null });
      }
      sendQueueState(roomId);
    });

    // ---- Chat ----
    socket.on('chatMessage', ({ roomId, message }) => {
      if (!roomId || !message) return;
      io.to(roomId).emit('chatMessage', { user: uid, message, timestamp: Date.now() });
    });

    // ---- Media Sync ----
    socket.on('mediaSync', ({ roomId, action, url, currentTime, playing, isEmbed }) => {
      socket.to(roomId).emit('mediaSync', { action, url, currentTime, playing, isEmbed });
    });

    // ---- Toy Status ----
    socket.on('deviceStatus', ({ status }) => {
      connectedClients[uid].toyStatus = status || 'disconnected';
      for (const [roomId, room] of Object.entries(rooms)) {
        if (room.members.includes(uid)) {
          io.to(roomId).emit('userStatus', { uid, toyStatus: connectedClients[uid].toyStatus });
        }
      }
    });

    // ---- Control Permission ----
    socket.on('setControlMode', ({ roomId, mode }) => {
      const room = rooms[roomId];
      if (!room) return;
      if (roomId === 'community') return socket.emit('error', { message: 'Control mode not available in community room' });
      if (room.creator !== uid) return socket.emit('error', { message: 'Only room creator can set mode' });
      if (!['none', 'granted', 'mutual', 'master'].includes(mode)) return;

      room.controllerMode = mode;
      room.controllerUid = null;
      room.pendingRequest = null;
      io.to(roomId).emit('controlModeChanged', { mode, setBy: uid });
    });

    socket.on('controlRequest', ({ roomId }) => {
      const room = rooms[roomId];
      if (!room) return;
      if (room.controllerMode === 'none') return socket.emit('error', { message: 'Control is disabled' });
      if (room.controllerUid === uid) return socket.emit('error', { message: 'You already have control' });

      if (room.controllerMode === 'mutual') {
        room.controllerUid = 'mutual';
        io.to(roomId).emit('controlStatus', { controllerUid: 'mutual', mode: 'mutual' });
        return;
      }
      if (room.controllerMode === 'master') {
        room.controllerUid = room.creator;
        io.to(roomId).emit('controlStatus', { controllerUid: room.creator, mode: 'master' });
        return;
      }
      // granted mode
      const toyOwner = room.members.find(m => connectedClients[m] && connectedClients[m].toyStatus === 'paired');
      if (!toyOwner) return socket.emit('error', { message: 'No paired toy found in room' });
      if (uid === toyOwner) {
        const other = room.members.find(m => m !== uid);
        if (!other) return;
        room.controllerUid = other;
        room.pendingRequest = null;
        io.to(roomId).emit('controlStatus', { controllerUid: other, mode: 'granted' });
        return;
      }
      room.pendingRequest = uid;
      io.to(roomId).emit('controlRequest', { uid, toyOwner });
    });

    socket.on('controlResponse', ({ roomId, accept }) => {
      const room = rooms[roomId];
      if (!room || !room.pendingRequest) return;
      if (accept) {
        room.controllerUid = room.pendingRequest;
        io.to(roomId).emit('controlStatus', { controllerUid: room.pendingRequest, mode: room.controllerMode });
      } else {
        io.to(roomId).emit('controlResponse', { uid: room.pendingRequest, accept: false });
      }
      room.pendingRequest = null;
    });

    socket.on('releaseControl', ({ roomId }) => {
      const room = rooms[roomId];
      if (!room) return;
      room.controllerUid = null;
      io.to(roomId).emit('controlStatus', { controllerUid: null, mode: room.controllerMode });
    });

    // ---- Toy Command Relay ----
    socket.on('toyCommand', ({ roomId, command }) => {
      const room = rooms[roomId];
      if (!room) return;
      if (room.controllerMode === 'none') return;
      if (roomId === 'community') return;
      if (room.controllerMode === 'master' && uid !== room.creator) return;
      if (room.controllerMode === 'granted' && uid !== room.controllerUid) return;
      if (room.controllerMode === 'mutual') {
        const other = room.members.find(m => m !== uid);
        if (other) io.to(other).emit('toyCommand', { command, from: uid });
        return;
      }
      socket.to(roomId).emit('toyCommand', { command, from: uid });
    });

    // ---- Heartbeat ----
    socket.on('heartbeat', () => socket.emit('heartbeatAck'));

    // ---- Initial status ----
    socket.emit('connected', { uid, isAuthenticated: socket.isAuthenticated });
    if (socket.isAuthenticated) {
      socket.emit('toyPaired', { status: connectedClients[uid]?.toyStatus || 'disconnected' });
    }
  });

  // Heartbeat cleanup
  setInterval(() => {
    for (const [uid, client] of Object.entries(connectedClients)) {
      const hasLive = client.socketIds.some(sid => {
        try { return io.sockets.sockets.has(sid); } catch { return false; }
      });
      if (!hasLive && client.status === 'online') {
        client.status = 'offline';
        console.log(`[heartbeat] ${uid} marked offline`);
      }
    }
  }, 30000);
}

function sendQueueState(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  // We need io reference to emit - this is a bit tricky.
  // Instead, we'll emit from the event handlers directly.
  // This helper is kept for clarity but not called directly.
}

function leaveCommunityRoom(socket, io) {
  const idx = rooms['community'].members.indexOf(socket.uid);
  if (idx !== -1) rooms['community'].members.splice(idx, 1);
  socket.leave('community');
  io.to('community').emit('userLeft', { uid: socket.uid, members: rooms['community'].members });
}

function handleLeaveRoom(socket, roomId, io) {
  const room = rooms[roomId];
  if (!room) return;
  room.members = room.members.filter(m => m !== socket.uid);
  socket.leave(roomId);
  // Join community if was in private
  if (roomId !== 'community') {
    socket.join('community');
    rooms['community'].members.push(socket.uid);
    socket.emit('roomJoined', { roomId: 'community', isCommunity: true });
    sendQueueState('community');
    io.to('community').emit('userJoined', { uid: socket.uid, members: rooms['community'].members });
  }
  io.to(roomId).emit('userLeft', { uid: socket.uid, members: room.members });
  if (room.controllerUid === socket.uid) {
    room.controllerUid = null;
    io.to(roomId).emit('controlStatus', { controllerUid: null, mode: room.controllerMode });
  }
  if (room.members.length === 0 && roomId !== 'community') {
    delete rooms[roomId];
  }
}

function handleDisconnect(uid, socketId, io) {
  const client = connectedClients[uid];
  if (!client) return;
  client.socketIds = client.socketIds.filter(sid => sid !== socketId);
  if (client.socketIds.length > 0) return;

  client.status = 'offline';
  for (const [roomId, room] of Object.entries(rooms)) {
    if (room.members.includes(uid)) {
      room.members = room.members.filter(m => m !== uid);
      io.to(roomId).emit('userLeft', { uid, members: room.members, totalMembers: room.members.length });
      if (room.controllerUid === uid) {
        room.controllerUid = null;
        io.to(roomId).emit('controlStatus', { controllerUid: null, mode: room.controllerMode });
      }
      if (room.members.length === 0 && roomId !== 'community') {
        delete rooms[roomId];
      }
    }
  }
  console.log(`[socket] ${uid} fully disconnected`);
}

module.exports = { initSocket, connectedClients, rooms };