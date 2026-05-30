const { Server } = require('socket.io');

const connectedClients = {}; // { uid: { socketIds: [], status, toyStatus, connectedAt } }
const rooms = {};            // { roomId: { creator, members: [uid], controllerMode, controllerUid, pendingRequest, toyToyStatus } }

function initSocket(server, userSessions) {
  const io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] }
  });

  // ---- Auth middleware ----
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
    console.log(`[socket] connected ${socket.id} uid=${uid} auth=${socket.isAuthenticated}`);

    // Track client
    if (!connectedClients[uid]) {
      connectedClients[uid] = { socketIds: [], status: 'online', toyStatus: 'disconnected', connectedAt: new Date().toISOString() };
    }
    connectedClients[uid].socketIds.push(socket.id);
    connectedClients[uid].status = 'online';

    // ---- Room Management ----
    socket.on('createRoom', ({ roomId } = {}) => {
      const id = roomId || `room_${Math.random().toString(36).substr(2, 6)}`;
      rooms[id] = {
        creator: uid,
        members: [uid],
        controllerMode: 'none',
        controllerUid: null,
        pendingRequest: null,
        createdAt: new Date().toISOString()
      };
      socket.join(id);
      socket.emit('roomCreated', { roomId: id, inviteCode: id });
      console.log(`[room] ${uid} created room ${id}`);
    });

    socket.on('joinRoom', ({ roomId }) => {
      const room = rooms[roomId];
      if (!room) return socket.emit('error', { message: 'Room not found' });
      if (room.members.length >= 2) return socket.emit('error', { message: 'Room is full (max 2)' });
      if (room.members.includes(uid)) return socket.emit('error', { message: 'Already in room' });

      room.members.push(uid);
      socket.join(roomId);
      io.to(roomId).emit('userJoined', { uid, members: room.members });
      // Notify of current controller
      if (room.controllerUid) {
        socket.emit('controlStatus', { controllerUid: room.controllerUid, mode: room.controllerMode });
      }
      console.log(`[room] ${uid} joined room ${roomId}`);
    });

    socket.on('leaveRoom', ({ roomId }) => {
      handleLeave(socket, roomId);
    });

    socket.on('disconnect', () => {
      handleDisconnect(uid, socket.id, io);
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
      // Broadcast to all rooms the user is in
      for (const [roomId, room] of Object.entries(rooms)) {
        if (room.members.includes(uid)) {
          io.to(roomId).emit('userStatus', { uid, toyStatus: connectedClients[uid].toyStatus });
        }
      }
    });

    // ---- Control Permission (Multi-Mode) ----
    // Mode: none | granted | mutual | master
    socket.on('setControlMode', ({ roomId, mode }) => {
      const room = rooms[roomId];
      if (!room) return socket.emit('error', { message: 'Room not found' });
      if (room.creator !== uid) return socket.emit('error', { message: 'Only room creator can set mode' });
      if (!['none', 'granted', 'mutual', 'master'].includes(mode)) return;

      room.controllerMode = mode;
      room.controllerUid = null;
      room.pendingRequest = null;
      io.to(roomId).emit('controlModeChanged', { mode, setBy: uid });
      console.log(`[control] ${uid} set room ${roomId} mode to ${mode}`);
    });

    socket.on('controlRequest', ({ roomId }) => {
      const room = rooms[roomId];
      if (!room) return;
      if (room.controllerMode === 'none') {
        return socket.emit('error', { message: 'Control is disabled in this room' });
      }
      if (room.controllerUid === uid) {
        return socket.emit('error', { message: 'You already have control' });
      }

      if (room.controllerMode === 'mutual') {
        // In mutual mode, granting control is automatic — both can send
        room.controllerUid = 'mutual';
        io.to(roomId).emit('controlStatus', { controllerUid: 'mutual', mode: 'mutual' });
        return;
      }

      // If master mode, creator is always controller — no requests
      if (room.controllerMode === 'master') {
        room.controllerUid = room.creator;
        io.to(roomId).emit('controlStatus', { controllerUid: room.creator, mode: 'master' });
        return;
      }

      // granted mode: the toy owner can grant control to the other
      // Find the member who has a paired toy
      const toyOwner = room.members.find(m => connectedClients[m] && connectedClients[m].toyStatus === 'paired');
      if (!toyOwner) {
        return socket.emit('error', { message: 'No paired toy found in room' });
      }
      if (uid === toyOwner) {
        // You own the toy — grant control to the other
        const other = room.members.find(m => m !== uid);
        if (!other) return;
        room.controllerUid = other;
        room.pendingRequest = null;
        io.to(roomId).emit('controlStatus', { controllerUid: other, mode: 'granted' });
        return;
      }
      // Requesting control from toy owner
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
      // Validate permissions
      if (room.controllerMode === 'none') return;
      if (room.controllerMode === 'master' && uid !== room.creator) return;
      if (room.controllerMode === 'granted' && uid !== room.controllerUid) return;
      if (room.controllerMode === 'mutual') {
        // In mutual mode, forward to the other member
        const other = room.members.find(m => m !== uid);
        if (other) io.to(other).emit('toyCommand', { command, from: uid });
        return;
      }
      // Default: relay to others
      socket.to(roomId).emit('toyCommand', { command, from: uid });
    });

    // ---- Heartbeat ----
    socket.on('heartbeat', () => {
      socket.emit('heartbeatAck');
    });

    // ---- Initial status ----
    socket.emit('connected', { uid, isAuthenticated: socket.isAuthenticated });
    if (socket.isAuthenticated) {
      socket.emit('toyPaired', { status: connectedClients[uid]?.toyStatus || 'disconnected' });
    }
  });

  // Heartbeat interval
  setInterval(() => {
    for (const [uid, client] of Object.entries(connectedClients)) {
      // find stale sockets (no ack in 60s) — simplified: just check if any socket still connected
      const hasLive = client.socketIds.some(sid => {
        try { return io.sockets.sockets.has(sid); } catch { return false; }
      });
      if (!hasLive && client.status === 'online') {
        client.status = 'offline';
        console.log(`[heartbeat] ${uid} marked offline (no sockets)`);
      }
    }
  }, 30000);
}

function handleLeave(socket, roomId) {
  const room = rooms[roomId];
  if (!room) return;
  room.members = room.members.filter(m => m !== socket.uid);
  socket.leave(roomId);
  if (room.members.length === 0) {
    delete rooms[roomId];
    console.log(`[room] ${roomId} deleted (empty)`);
  } else {
    io.to(roomId).emit('userLeft', { uid: socket.uid, members: room.members });
    if (room.controllerUid === socket.uid) {
      room.controllerUid = null;
      io.to(roomId).emit('controlStatus', { controllerUid: null, mode: room.controllerMode });
    }
  }
}

function handleDisconnect(uid, socketId, io) {
  const client = connectedClients[uid];
  if (!client) return;
  client.socketIds = client.socketIds.filter(sid => sid !== socketId);
  if (client.socketIds.length === 0) {
    client.status = 'offline';
    // Notify rooms
    for (const [roomId, room] of Object.entries(rooms)) {
      if (room.members.includes(uid)) {
        room.members = room.members.filter(m => m !== uid);
        io.to(roomId).emit('userLeft', { uid, members: room.members });
        if (room.controllerUid === uid) {
          room.controllerUid = null;
          io.to(roomId).emit('controlStatus', { controllerUid: null, mode: room.controllerMode });
        }
        if (room.members.length === 0) {
          delete rooms[roomId];
          console.log(`[room] ${roomId} deleted (all disconnected)`);
        }
      }
    }
    console.log(`[socket] ${uid} fully disconnected`);
  }
}

module.exports = { initSocket, connectedClients, rooms };