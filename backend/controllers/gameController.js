const Room = require('../models/Room');

/* ------------------------------------------------------------------ */
/*  Utility                                                             */
/* ------------------------------------------------------------------ */

/** Generate a random 6-character alphanumeric room code. */
const generateRoomCode = () =>
  Math.random().toString(36).substring(2, 8).toUpperCase();

/* ------------------------------------------------------------------ */
/*  Controllers                                                         */
/* ------------------------------------------------------------------ */

/**
 * POST /api/create-room
 * Body: { playerName }
 * Creates a new room document in MongoDB and returns the unique code.
 * The socket layer will handle the actual player-joining once the
 * client navigates to the game page.
 */
exports.createRoom = async (req, res) => {
  try {
    const playerName = (req.body.playerName || '').trim();
    if (!playerName) {
      return res.status(400).json({ error: 'Player name is required.' });
    }
    if (playerName.length > 24) {
      return res.status(400).json({ error: 'Name must be 24 characters or fewer.' });
    }

    // Find a unique code with a maximum of 20 attempts
    let roomCode;
    for (let attempt = 0; attempt < 20; attempt++) {
      const candidate = generateRoomCode();
      const existing  = await Room.findOne({ roomCode: candidate });
      if (!existing) { roomCode = candidate; break; }
    }
    if (!roomCode) {
      return res.status(500).json({ error: 'Could not generate a unique room code.' });
    }

    const room = await Room.create({ roomCode, players: [], gameState: 'waiting' });
    return res.json({ success: true, roomCode: room.roomCode });
  } catch (err) {
    console.error('createRoom controller error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

/**
 * GET /api/room/:roomCode
 * Returns lightweight room info (existence check + player count).
 */
exports.getRoomInfo = async (req, res) => {
  try {
    const roomCode = (req.params.roomCode || '').toUpperCase();
    const room = await Room.findOne({ roomCode });
    if (!room) {
      return res.status(404).json({ error: 'Room not found.' });
    }
    return res.json({
      roomCode:    room.roomCode,
      playerCount: room.players.filter(p => p.isConnected).length,
      gameState:   room.gameState,
      canJoin:     room.gameState === 'waiting',
    });
  } catch (err) {
    console.error('getRoomInfo controller error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

/**
 * GET /api/leaderboard/:roomCode
 * Returns the final sorted score list for a finished game.
 */
exports.getLeaderboard = async (req, res) => {
  try {
    const roomCode = (req.params.roomCode || '').toUpperCase();
    const room = await Room.findOne({ roomCode });
    if (!room) {
      return res.status(404).json({ error: 'Room not found.' });
    }
    const scores = room.players
      .map(p => ({ name: p.name, score: p.score }))
      .sort((a, b) => b.score - a.score);
    return res.json({ roomCode, scores });
  } catch (err) {
    console.error('getLeaderboard controller error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};
