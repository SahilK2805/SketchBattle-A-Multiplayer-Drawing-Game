const mongoose = require('mongoose');

/**
 * Embedded player sub-document used inside Room.
 */
const RoomPlayerSchema = new mongoose.Schema(
  {
    socketId:    { type: String, required: true },
    name:        { type: String, required: true, trim: true },
    score:       { type: Number, default: 0 },
    isHost:      { type: Boolean, default: false },
    isConnected: { type: Boolean, default: true },
    joinedAt:    { type: Date, default: Date.now },
  },
  { _id: false }
);

/**
 * Room Schema
 * One document per active game room.  The in-memory Map inside
 * gameSocket.js mirrors this for ultra-low-latency reads; MongoDB
 * is the authoritative, durable store.
 */
const RoomSchema = new mongoose.Schema(
  {
    roomCode: {
      type:     String,
      required: true,
      unique:   true,
      uppercase: true,
      index:    true,
    },

    players: [RoomPlayerSchema],

    gameState: {
      type:    String,
      enum:    ['waiting', 'playing', 'ended'],
      default: 'waiting',
    },

    currentDrawerIndex: { type: Number, default: 0 },
    currentWord:        { type: String,  default: '' },
    currentRound:       { type: Number,  default: 1 },
    totalRounds:        { type: Number,  default: 3, min: 1, max: 10 },
    roundTimeLimit:     { type: Number,  default: 80, min: 20, max: 180 },

    // TTL – rooms auto-delete after 24 h
    createdAt: { type: Date, default: Date.now, expires: 86400 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Room', RoomSchema);
