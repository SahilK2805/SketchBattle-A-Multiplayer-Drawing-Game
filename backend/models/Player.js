const mongoose = require('mongoose');

/**
 * Player Schema
 * Represents a participant in a game room.
 * Embedded inside Room.players[] but also stored separately
 * so individual player stats can be queried independently.
 */
const PlayerSchema = new mongoose.Schema(
  {
    socketId:    { type: String, required: true, index: true },
    name:        { type: String, required: true, trim: true, maxlength: 24 },
    score:       { type: Number, default: 0, min: 0 },
    roomCode:    { type: String, required: true, uppercase: true },
    isHost:      { type: Boolean, default: false },
    isConnected: { type: Boolean, default: true },
    joinedAt:    { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Auto-expire player documents after 24 h of inactivity
PlayerSchema.index({ joinedAt: 1 }, { expireAfterSeconds: 86400 });

module.exports = mongoose.model('Player', PlayerSchema);
