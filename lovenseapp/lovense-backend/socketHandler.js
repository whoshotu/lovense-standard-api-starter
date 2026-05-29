const { Server } = require('socket.io');

function initSocket(server) {
  const io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] }
  });

  // Default namespace for group room
  io.on('connection', socket => {
    console.log('[socket] connected', socket.id);

    socket.on('joinRoom', ({ roomId }) => {
      socket.join(roomId);
      console.log(`[socket] ${socket.id} joined room ${roomId}`);
      socket.to(roomId).emit('userJoined', { uid: socket.id });
    });

    socket.on('chatMessage', ({ roomId, message, user }) => {
      io.to(roomId).emit('chatMessage', { user, message, timestamp: Date.now() });
    });

    socket.on('toyCommand', ({ roomId, command }) => {
      socket.to(roomId).emit('toyCommand', { command });
    });

    socket.on('controlRequest', ({ roomId, uid }) => {
      socket.to(roomId).emit('controlRequest', { uid });
    });

    socket.on('controlResponse', ({ roomId, uid, accept }) => {
      io.to(roomId).emit('controlResponse', { uid, accept });
    });

    socket.on('mediaSync', ({ roomId, action, url, currentTime }) => {
      socket.to(roomId).emit('mediaSync', { action, url, currentTime });
    });

    socket.on('disconnect', () => {
      console.log('[socket] disconnected', socket.id);
    });
  });
}

module.exports = { initSocket };
