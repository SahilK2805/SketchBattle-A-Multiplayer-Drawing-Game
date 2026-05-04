/**
 * server.js  –  Entry point
 * Boots Express, attaches Socket.io, connects MongoDB, serves frontend.
 */

require('dotenv').config();
const path       = require('path');
const http       = require('http');
const express    = require('express');
const cors       = require('cors');
const { Server } = require('socket.io');
const connectDB  = require('./config/db');
const gameRoutes = require('./routes/gameRoutes');
const gameSocket = require('./sockets/gameSocket');

/* ------------------------------------------------------------------ */
/*  App bootstrap                                                       */
/* ------------------------------------------------------------------ */
const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout:  60000,
  pingInterval: 25000,
});

/* ------------------------------------------------------------------ */
/*  Middleware                                                          */
/* ------------------------------------------------------------------ */
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend
app.use(express.static(path.join(__dirname, '..', 'frontend')));

/* ------------------------------------------------------------------ */
/*  API routes                                                          */
/* ------------------------------------------------------------------ */
app.use('/api', gameRoutes);

// Catch-all – serve index for any non-API route
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

/* ------------------------------------------------------------------ */
/*  Socket.io                                                           */
/* ------------------------------------------------------------------ */
gameSocket(io);

/* ------------------------------------------------------------------ */
/*  Start                                                               */
/* ------------------------------------------------------------------ */
const PORT = process.env.PORT || 3000;

connectDB().then(() => {
  server.listen(PORT, () => {
    console.log(`\n🚀  Server running at http://localhost:${PORT}`);
    console.log(`📡  Socket.io ready`);
    console.log(`🗄️   MongoDB connected\n`);
  });
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑  Shutting down gracefully…');
  server.close(() => process.exit(0));
});
