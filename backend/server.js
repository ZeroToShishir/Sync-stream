import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

const app = express();
app.use(cors());
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*', // In production, restrict to your frontend domain
    methods: ['GET', 'POST']
  }
});

// In-memory storage for rooms
const rooms = {};

io.on('connection', (socket) => {
  console.log('New client connected', socket.id);

  // Join a room
  socket.on('join-room', ({ roomId, userId, peerId }) => {
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.userId = userId;
    socket.data.peerId = peerId;

    // Initialize room if not exists
    if (!rooms[roomId]) {
      rooms[roomId] = {
        users: {},
        mediaUrl: null, // default
        isPlaying: false,
        currentTime: 0
      };
    }

    // Add user to room
    rooms[roomId].users[socket.id] = { userId, peerId };

    // Notify others in room
    socket.to(roomId).emit('user-joined', { userId, peerId });

    // Send current room state to the new user
    socket.emit('room-state', rooms[roomId]);

    // Send list of existing users to the new user
    const existingUsers = Object.values(rooms[roomId].users).map(u => ({ userId: u.userId, peerId: u.peerId }));
    socket.emit('existing-users', existingUsers);
  });

  // Handle media control actions
  socket.on('action', (data) => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId]) return;

    const { type, ...payload } = data;

    // Update room state based on action
    switch (type) {
      case 'play':
        rooms[roomId].isPlaying = true;
        rooms[roomId].currentTime = payload.seconds;
        break;
      case 'pause':
        rooms[roomId].isPlaying = false;
        rooms[roomId].currentTime = payload.seconds;
        break;
      case 'seek':
        rooms[roomId].currentTime = payload.seconds;
        break;
      case 'media':
        rooms[roomId].mediaUrl = payload.url;
        rooms[roomId].isPlaying = true; // auto-play new media
        rooms[roomId].currentTime = 0;
        break;
    }

    // Broadcast to everyone in the room (including sender, but sender may already have updated locally)
    io.to(roomId).emit('sync', rooms[roomId]);
  });

  // WebRTC signaling
  socket.on('signal', (data) => {
    // Forward signal to the target peer (by peerId)
    const targetSocket = findSocketByPeerId(data.targetPeerId);
    if (targetSocket) {
      targetSocket.emit('signal', {
        fromPeerId: socket.data.peerId,
        signal: data.signal
      });
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    const userId = socket.data.userId;
    if (roomId && rooms[roomId]) {
      delete rooms[roomId].users[socket.id];
      io.to(roomId).emit('user-left', userId);
      // Clean up empty rooms (optional)
      if (Object.keys(rooms[roomId].users).length === 0) {
        delete rooms[roomId];
      }
    }
    console.log('Client disconnected', socket.id);
  });
});

// Helper to find a socket by peerId
function findSocketByPeerId(peerId) {
  for (const [id, socket] of io.sockets.sockets) {
    if (socket.data.peerId === peerId) return socket;
  }
  return null;
}

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
