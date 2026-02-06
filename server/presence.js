const jwt = require('jsonwebtoken');

// In-memory store: Map<userId, { email, role, socketIds: Set, activeSessionId, activeSessionTitle, connectedAt }>
const onlineUsers = new Map();

function getPresenceList() {
  const list = [];
  for (const [userId, data] of onlineUsers) {
    list.push({
      userId,
      email: data.email,
      role: data.role,
      activeSessionId: data.activeSessionId,
      activeSessionTitle: data.activeSessionTitle,
      connectedAt: data.connectedAt,
    });
  }
  return list;
}

function setupPresence(io) {
  const presenceNamespace = io.of('/presence');

  // JWT auth middleware
  presenceNamespace.use((socket, next) => {
    const token = socket.handshake.auth.token || socket.handshake.query.token;
    if (!token) return next(new Error('Authentication required'));
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = decoded; // { userId, email, role }
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  presenceNamespace.on('connection', (socket) => {
    const { userId, email, role } = socket.user;

    // Register user
    if (onlineUsers.has(userId)) {
      const data = onlineUsers.get(userId);
      data.socketIds.add(socket.id);
    } else {
      onlineUsers.set(userId, {
        email,
        role,
        socketIds: new Set([socket.id]),
        activeSessionId: null,
        activeSessionTitle: null,
        connectedAt: Date.now(),
      });
    }

    // Broadcast updated presence list
    presenceNamespace.emit('presence-update', getPresenceList());

    // Activity update from client
    socket.on('activity-update', ({ sessionId, sessionTitle } = {}) => {
      const data = onlineUsers.get(userId);
      if (data) {
        data.activeSessionId = sessionId || null;
        data.activeSessionTitle = sessionTitle || null;
        presenceNamespace.emit('presence-update', getPresenceList());
      }
    });

    // Disconnect
    socket.on('disconnect', () => {
      const data = onlineUsers.get(userId);
      if (data) {
        data.socketIds.delete(socket.id);
        if (data.socketIds.size === 0) {
          onlineUsers.delete(userId);
        }
      }
      presenceNamespace.emit('presence-update', getPresenceList());
    });
  });
}

module.exports = { setupPresence, getPresenceList };
