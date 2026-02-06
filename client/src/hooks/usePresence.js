import { useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';
import { getToken } from '../api';

export default function usePresence() {
  const [onlineUsers, setOnlineUsers] = useState([]);
  const socketRef = useRef(null);

  useEffect(() => {
    const token = getToken();
    if (!token) return;

    const socket = io('/presence', {
      auth: { token },
      transports: ['websocket'],
    });

    socketRef.current = socket;

    socket.on('presence-update', (users) => {
      setOnlineUsers(users);
    });

    socket.on('connect_error', () => {
      // Silently handle connection errors
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  const updateActivity = useCallback((sessionId, sessionTitle) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('activity-update', { sessionId, sessionTitle });
    }
  }, []);

  return { onlineUsers, updateActivity };
}
