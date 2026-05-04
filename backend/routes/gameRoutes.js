const express = require('express');
const router  = express.Router();
const {
  createRoom,
  getRoomInfo,
  getLeaderboard,
} = require('../controllers/gameController');

// Room management
router.post('/create-room',            createRoom);
router.get('/room/:roomCode',          getRoomInfo);
router.get('/leaderboard/:roomCode',   getLeaderboard);

// Health-check
router.get('/health', (_req, res) => res.json({ status: 'ok', ts: Date.now() }));

module.exports = router;
