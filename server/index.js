require('dotenv').config();

const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { router: authRouter, verifyToken } = require('./auth');
const systemRoutes = require('./routes/system');
const filesRoutes = require('./routes/files');
const dockerRoutes = require('./routes/docker');
const terminalRoutes = require('./routes/terminal');
const projectsRoutes = require('./routes/projects');
const settingsRoutes = require('./routes/settings');
const { setupTerminal, initSessions } = require('./terminal');

// Ensure /root/ProjectList exists
const projectListDir = '/root/ProjectList';
if (!fs.existsSync(projectListDir)) {
  fs.mkdirSync(projectListDir, { recursive: true });
}

// Import db to trigger schema creation
require('./db');

// Clean slate for terminal sessions on startup
initSessions();

const app = express();

// --- SSL setup ---
const sslDir = path.join(__dirname, '..', 'ssl');
const sslKeyPath = path.join(sslDir, 'key.pem');
const sslCertPath = path.join(sslDir, 'cert.pem');
const hasSSL = fs.existsSync(sslKeyPath) && fs.existsSync(sslCertPath);

let server;
if (hasSSL) {
  const sslOptions = {
    key: fs.readFileSync(sslKeyPath),
    cert: fs.readFileSync(sslCertPath),
  };
  server = https.createServer(sslOptions, app);
} else {
  server = http.createServer(app);
}

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(cors());
app.use(express.json({ limit: '5mb' }));

// Auth routes (no token required)
app.use('/api/auth', authRouter);

// Protected API routes
app.use('/api/system', verifyToken, systemRoutes);
app.use('/api/files', verifyToken, filesRoutes);
app.use('/api/docker', verifyToken, dockerRoutes);
app.use('/api/terminal', verifyToken, terminalRoutes);
app.use('/api/projects', verifyToken, projectsRoutes);
app.use('/api/settings', verifyToken, settingsRoutes);

// Serve static frontend
const distPath = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(distPath));
app.get('*', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

// Setup terminal WebSocket
setupTerminal(io);

const PORT = process.env.PORT || 3000;
const SSL_PORT = process.env.SSL_PORT || 443;

if (hasSSL) {
  // Main server on HTTPS
  server.listen(SSL_PORT, '0.0.0.0', () => {
    console.log(`VPS Dashboard running on https://0.0.0.0:${SSL_PORT}`);
  });

  // HTTP redirect server
  const httpRedirect = http.createServer((req, res) => {
    const host = (req.headers.host || '').replace(/:.*$/, '');
    const target = SSL_PORT === 443
      ? `https://${host}${req.url}`
      : `https://${host}:${SSL_PORT}${req.url}`;
    res.writeHead(301, { Location: target });
    res.end();
  });
  httpRedirect.listen(PORT, '0.0.0.0', () => {
    console.log(`HTTP redirect on http://0.0.0.0:${PORT} -> https`);
  });
} else {
  // Fallback: HTTP only
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`VPS Dashboard running on http://0.0.0.0:${PORT}`);
  });
}
