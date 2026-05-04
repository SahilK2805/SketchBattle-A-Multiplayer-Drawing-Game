/**
 * gameSocket.js
 * ─────────────
 * All Socket.io event handlers for the multiplayer drawing game.
 *
 * Distributed-system design decisions:
 *  • Hot state kept in `activeRooms` Map (in-process, O(1) access)
 *  • Cold / authoritative state persisted to MongoDB after every
 *    significant transition (join, start, turn-end, game-end)
 *  • Server-side timers guarantee consistent round duration across
 *    all clients regardless of individual clock drift or latency
 *  • Graceful disconnect: drawer replaced, host migrated, game
 *    halted only when < 2 players remain
 *  • Idempotent rejoin: reconnected clients receive full state
 *    snapshot and resume seamlessly
 */

const Room = require('../models/Room');

/* ------------------------------------------------------------------ */
/*  Word bank                                                           */
/* ------------------------------------------------------------------ */
const WORDS = [
  'apple','banana','car','dog','elephant','flower','guitar','house','island',
  'jacket','kite','lion','mountain','notebook','orange','piano','queen',
  'rainbow','sun','tree','umbrella','volcano','whale','xylophone','yacht',
  'zebra','airplane','bridge','castle','diamond','eagle','forest','ghost',
  'hammer','iceberg','jungle','kangaroo','lighthouse','mermaid','ninja',
  'ocean','penguin','rocket','spider','tornado','unicorn','vampire','wizard',
  'butterfly','cactus','dolphin','explosion','fireworks','gorilla','helicopter',
  'igloo','jellyfish','keyboard','lemon','mushroom','newspaper','popcorn',
  'quicksand','sandwich','telescope','waterfall','astronaut','bookshelf',
  'caterpillar','dinosaur','escalator','flamingo','graduation','hourglass',
  'invitation','jackpot','kaleidoscope','laboratory','microscope','nightclub',
  'Olympics','parachute','quarterback','rollercoaster','submarine','thunderstorm',
  'underground','valentine','windmill','xmas tree','yellow brick road','zipper',
];

/* ------------------------------------------------------------------ */
/*  In-memory room state                                                */
/* ------------------------------------------------------------------ */
/**
 * activeRooms: Map<roomCode, RoomState>
 *
 * RoomState {
 *   roomCode        : string
 *   players         : PlayerObj[]
 *   gameState       : 'waiting'|'playing'|'ended'
 *   drawTurnOrder   : string[]   (socketIds, shuffled each round)
 *   drawTurnIndex   : number
 *   currentRound    : number
 *   totalRounds     : number
 *   roundTime       : number     (seconds per turn)
 *   timeRemaining   : number
 *   currentWord     : string
 *   guessedPlayers  : Set<socketId>
 *   timer           : Interval | null
 * }
 *
 * PlayerObj { socketId, name, score, isHost, isConnected }
 */
const activeRooms = new Map();

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

const pick = arr => arr[Math.floor(Math.random() * arr.length)];

const shuffle = arr => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/** Returns '_ _ _ _ _'-style hint for a word. */
const wordHint = word =>
  word.split('').map((c, i) =>
    c === ' ' ? '/' : (i === 0 || i === word.length - 1) ? c : '_'
  ).join(' ');

/** Levenshtein distance for "close guess" detection. */
const levenshtein = (a, b) => {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[m][n];
};

const isClose = (guess, word) =>
  guess !== word && levenshtein(guess, word) <= 2;

/** Build the score payload the client expects. */
const scoreMap = memRoom =>
  memRoom.players
    .filter(p => p.isConnected)
    .map(p => ({ name: p.name, score: p.score, socketId: p.socketId }))
    .sort((a, b) => b.score - a.score);

const generateCode = () =>
  Math.random().toString(36).substring(2, 8).toUpperCase();

/* ------------------------------------------------------------------ */
/*  Main export                                                         */
/* ------------------------------------------------------------------ */
module.exports = io => {
  io.on('connection', socket => {
    console.log(`🔌  Socket connected: ${socket.id}`);

    /* ──────────────────────────────────────────────────────────────── */
    /*  CREATE ROOM                                                      */
    /* ──────────────────────────────────────────────────────────────── */
    socket.on('createRoom', async ({ playerName, totalRounds = 3, roundTime = 80 }, cb) => {
      try {
        const name = (playerName || '').trim();
        if (!name) return cb({ success: false, error: 'Name required.' });

        // Unique code
        let roomCode;
        for (let i = 0; i < 20; i++) {
          const c = generateCode();
          if (!(await Room.findOne({ roomCode: c }))) { roomCode = c; break; }
        }
        if (!roomCode) return cb({ success: false, error: 'Could not allocate room.' });

        const player = { socketId: socket.id, name, score: 0, isHost: true, isConnected: true };

        // Persist
        await Room.create({ roomCode, players: [player], gameState: 'waiting', totalRounds, roundTimeLimit: roundTime });

        // Hot state
        activeRooms.set(roomCode, {
          roomCode, totalRounds, roundTime,
          players:        [{ ...player }],
          gameState:      'waiting',
          drawTurnOrder:  [],
          drawTurnIndex:  0,
          currentRound:   1,
          timeRemaining:  roundTime,
          currentWord:    '',
          guessedPlayers: new Set(),
          timer:          null,
        });

        socket.join(roomCode);
        socket.roomCode    = roomCode;
        socket.playerName  = name;

        console.log(`🏠  Room created: ${roomCode} by ${name}`);
        cb({ success: true, roomCode, player });

      } catch (err) {
        console.error('createRoom error:', err);
        cb({ success: false, error: 'Server error.' });
      }
    });

    /* ──────────────────────────────────────────────────────────────── */
    /*  JOIN ROOM                                                        */
    /* ──────────────────────────────────────────────────────────────── */
    socket.on('joinRoom', async ({ playerName, roomCode }, cb) => {
      try {
        const code = (roomCode || '').toUpperCase();
        const name = (playerName || '').trim();
        if (!name)  return cb({ success: false, error: 'Name required.' });
        if (!code)  return cb({ success: false, error: 'Room code required.' });

        const dbRoom = await Room.findOne({ roomCode: code });
        if (!dbRoom) return cb({ success: false, error: 'Room not found.' });
        if (dbRoom.gameState === 'playing')
          return cb({ success: false, error: 'Game already in progress.' });
        if (dbRoom.gameState === 'ended')
          return cb({ success: false, error: 'This game has ended.' });

        // Prevent duplicate names
        const mem = activeRooms.get(code);
        const existingPlayers = mem ? mem.players : dbRoom.players;
        const nameTaken = existingPlayers.some(
          p => p.isConnected && p.name.toLowerCase() === name.toLowerCase()
        );
        if (nameTaken) return cb({ success: false, error: 'Name already taken in this room.' });

        const isFirstPlayer = existingPlayers.filter(p => p.isConnected).length === 0;
        const player = {
          socketId:    socket.id,
          name,
          score:       0,
          isHost:      isFirstPlayer,
          isConnected: true,
        };

        // Persist
        await Room.findOneAndUpdate({ roomCode: code }, { $push: { players: player } });

        // Hot state
        if (mem) {
          mem.players.push({ ...player });
        } else {
          // Room was in DB but not memory (e.g. server restart)
          activeRooms.set(code, {
            roomCode:       code,
            totalRounds:    dbRoom.totalRounds,
            roundTime:      dbRoom.roundTimeLimit,
            players:        [...dbRoom.players.map(p => p.toObject()), { ...player }],
            gameState:      'waiting',
            drawTurnOrder:  [],
            drawTurnIndex:  0,
            currentRound:   1,
            timeRemaining:  dbRoom.roundTimeLimit,
            currentWord:    '',
            guessedPlayers: new Set(),
            timer:          null,
          });
        }

        socket.join(code);
        socket.roomCode   = code;
        socket.playerName = name;

        const memRoom = activeRooms.get(code);
        const players = memRoom.players.filter(p => p.isConnected);

        io.to(code).emit('playerJoined', { player, players });
        console.log(`👤  ${name} joined room ${code}`);

        cb({ success: true, roomCode: code, player, players, gameState: dbRoom.gameState });

      } catch (err) {
        console.error('joinRoom error:', err);
        cb({ success: false, error: 'Server error.' });
      }
    });

    /* ──────────────────────────────────────────────────────────────── */
    /*  START GAME                                                       */
    /* ──────────────────────────────────────────────────────────────── */
    socket.on('startGame', async ({ roomCode }, cb) => {
      try {
        const mem = activeRooms.get(roomCode);
        if (!mem) return cb?.({ success: false, error: 'Room not found.' });

        const caller = mem.players.find(p => p.socketId === socket.id);
        if (!caller?.isHost) return cb?.({ success: false, error: 'Only the host can start.' });

        const connected = mem.players.filter(p => p.isConnected);
        if (connected.length < 2)
          return cb?.({ success: false, error: 'Need at least 2 players.' });

        mem.gameState     = 'playing';
        mem.currentRound  = 1;
        mem.drawTurnOrder = shuffle(connected.map(p => p.socketId));
        mem.drawTurnIndex = 0;
        mem.players.forEach(p => (p.score = 0));

        await Room.findOneAndUpdate({ roomCode }, { gameState: 'playing', 'players.$[].score': 0 });

        io.to(roomCode).emit('gameStarted', {
          players:     connected,
          totalRounds: mem.totalRounds,
          roundTime:   mem.roundTime,
        });

        cb?.({ success: true });
        console.log(`🎮  Game started in room ${roomCode}`);

        // Brief pause then kick off first turn
        setTimeout(() => startTurn(io, roomCode), 1500);

      } catch (err) {
        console.error('startGame error:', err);
        cb?.({ success: false, error: 'Server error.' });
      }
    });

    /* ──────────────────────────────────────────────────────────────── */
    /*  DRAW                                                             */
    /* ──────────────────────────────────────────────────────────────── */
    socket.on('draw', ({ roomCode, drawData }) => {
      // Relay to all other clients in room – no DB write needed
      socket.to(roomCode).emit('draw', drawData);
    });

    /* ──────────────────────────────────────────────────────────────── */
    /*  CLEAR CANVAS                                                     */
    /* ──────────────────────────────────────────────────────────────── */
    socket.on('clearCanvas', ({ roomCode }) => {
      io.to(roomCode).emit('clearCanvas');
    });

    /* ──────────────────────────────────────────────────────────────── */
    /*  FILL CANVAS                                                      */
    /* ──────────────────────────────────────────────────────────────── */
    socket.on('fillCanvas', ({ roomCode, color }) => {
      io.to(roomCode).emit('fillCanvas', { color });
    });

    /* ──────────────────────────────────────────────────────────────── */
    /*  GUESS                                                            */
    /* ──────────────────────────────────────────────────────────────── */
    socket.on('guess', ({ roomCode, guess, playerName }) => {
      const mem = activeRooms.get(roomCode);
      if (!mem || mem.gameState !== 'playing') return;

      const drawerSocketId = mem.drawTurnOrder[mem.drawTurnIndex];
      if (socket.id === drawerSocketId) return;       // drawer can't guess
      if (mem.guessedPlayers.has(socket.id)) return;  // already guessed

      const target = mem.currentWord.toLowerCase().trim();
      const input  = (guess || '').toLowerCase().trim();
      if (!input) return;

      if (input === target) {
        // ── Correct! ──────────────────────────────────────────────
        mem.guessedPlayers.add(socket.id);

        const orderBonus   = Math.max(0, 4 - mem.guessedPlayers.size) * 15;
        const timeBonus    = Math.floor((mem.timeRemaining || 0) * 0.9);
        const points       = 50 + timeBonus + orderBonus;

        const guesser = mem.players.find(p => p.socketId === socket.id);
        if (guesser) guesser.score += points;

        // Drawer earns points per correct guesser
        const drawer = mem.players.find(p => p.socketId === drawerSocketId);
        if (drawer) drawer.score += 20;

        io.to(roomCode).emit('correctGuess', {
          playerName,
          points,
          scores: scoreMap(mem),
        });

        // Check if everyone has guessed
        const nonDrawers = mem.players.filter(
          p => p.isConnected && p.socketId !== drawerSocketId
        );
        if (nonDrawers.every(p => mem.guessedPlayers.has(p.socketId))) {
          endTurn(io, roomCode);
        }

      } else {
        // ── Wrong guess – show in chat ─────────────────────────────
        const close = isClose(input, target);
        io.to(roomCode).emit('chatMessage', {
          playerName,
          message: guess,
          type:    close ? 'close' : 'guess',
        });
      }
    });

    /* ──────────────────────────────────────────────────────────────── */
    /*  CHAT (non-guess messages during lobby / break)                  */
    /* ──────────────────────────────────────────────────────────────── */
    socket.on('chatMessage', ({ roomCode, message, playerName }) => {
      if (!message?.trim()) return;
      io.to(roomCode).emit('chatMessage', {
        playerName,
        message: message.substring(0, 200),
        type: 'chat',
      });
    });

    /* ──────────────────────────────────────────────────────────────── */
    /*  RESTART GAME                                                     */
    /* ──────────────────────────────────────────────────────────────── */
    socket.on('restartGame', async ({ roomCode }) => {
      const mem = activeRooms.get(roomCode);
      if (!mem) return;
      const caller = mem.players.find(p => p.socketId === socket.id);
      if (!caller?.isHost) return;

      clearTimer(mem);

      mem.players.forEach(p => (p.score = 0));
      Object.assign(mem, {
        gameState:      'waiting',
        currentRound:   1,
        currentWord:    '',
        drawTurnOrder:  [],
        drawTurnIndex:  0,
        guessedPlayers: new Set(),
      });

      await Room.findOneAndUpdate(
        { roomCode },
        { gameState: 'waiting', currentWord: '', currentRound: 1, 'players.$[].score': 0 }
      );

      io.to(roomCode).emit('gameRestarted', {
        players: mem.players.filter(p => p.isConnected),
      });
    });

    /* ──────────────────────────────────────────────────────────────── */
    /*  REJOIN (reconnect with same name)                               */
    /* ──────────────────────────────────────────────────────────────── */
    socket.on('rejoinRoom', async ({ roomCode, playerName }, cb) => {
      try {
        const code = (roomCode || '').toUpperCase();
        const mem  = activeRooms.get(code);
        if (!mem) return cb({ success: false, error: 'Room not found or expired.' });

        const existing = mem.players.find(
          p => p.name.toLowerCase() === (playerName || '').toLowerCase()
        );
        if (!existing) {
          return cb({ success: false, error: 'Player not found – please join fresh.' });
        }

        const oldId = existing.socketId;
        existing.socketId    = socket.id;
        existing.isConnected = true;

        // Patch draw order
        const idx = mem.drawTurnOrder.indexOf(oldId);
        if (idx !== -1) mem.drawTurnOrder[idx] = socket.id;

        socket.join(code);
        socket.roomCode   = code;
        socket.playerName = playerName;

        await Room.findOneAndUpdate(
          { roomCode: code, 'players.name': playerName },
          { '$set': { 'players.$.socketId': socket.id, 'players.$.isConnected': true } }
        );

        io.to(code).emit('playerRejoined', {
          playerName,
          players: mem.players.filter(p => p.isConnected),
        });

        const drawerSocketId = mem.drawTurnOrder[mem.drawTurnIndex];
        const isDrawing = socket.id === drawerSocketId;

        cb({
          success:      true,
          gameState:    mem.gameState,
          players:      mem.players.filter(p => p.isConnected),
          currentRound: mem.currentRound,
          totalRounds:  mem.totalRounds,
          timeRemaining:mem.timeRemaining,
          drawerName:   mem.players.find(p => p.socketId === drawerSocketId)?.name || '',
          isDrawing,
          word:         isDrawing ? mem.currentWord : wordHint(mem.currentWord),
          wordLength:   mem.currentWord.length,
        });

      } catch (err) {
        console.error('rejoinRoom error:', err);
        cb({ success: false, error: 'Server error.' });
      }
    });

    /* ──────────────────────────────────────────────────────────────── */
    /*  DISCONNECT                                                       */
    /* ──────────────────────────────────────────────────────────────── */
    socket.on('disconnect', async () => {
      const roomCode = socket.roomCode;
      if (!roomCode) return;

      const mem = activeRooms.get(roomCode);
      if (!mem)  return;

      const player = mem.players.find(p => p.socketId === socket.id);
      if (!player) return;

      player.isConnected = false;
      console.log(`❌  ${player.name} disconnected from ${roomCode}`);

      // Persist
      await Room.findOneAndUpdate(
        { roomCode, 'players.socketId': socket.id },
        { '$set': { 'players.$.isConnected': false } }
      ).catch(() => {});

      io.to(roomCode).emit('playerDisconnected', {
        playerName: player.name,
        players:    mem.players.filter(p => p.isConnected),
      });

      // ── Host migration ────────────────────────────────────────────
      if (player.isHost) {
        player.isHost = false;
        const next = mem.players.find(p => p.isConnected);
        if (next) {
          next.isHost = true;
          io.to(next.socketId).emit('becameHost');
          io.to(roomCode).emit('systemMessage', `${next.name} is now the host.`);
          await Room.findOneAndUpdate(
            { roomCode, 'players.socketId': next.socketId },
            { '$set': { 'players.$.isHost': true } }
          ).catch(() => {});
        }
      }

      // ── Game impact ───────────────────────────────────────────────
      if (mem.gameState === 'playing') {
        const drawerSocketId = mem.drawTurnOrder[mem.drawTurnIndex];

        if (drawerSocketId === socket.id) {
          io.to(roomCode).emit('systemMessage',
            `${player.name} (drawer) disconnected. Skipping turn…`
          );
          setTimeout(() => endTurn(io, roomCode), 2500);
        }

        const connectedCount = mem.players.filter(p => p.isConnected).length;
        if (connectedCount < 2) {
          clearTimer(mem);
          mem.gameState = 'ended';
          io.to(roomCode).emit('gameEnded', {
            reason: 'Not enough players to continue.',
            scores: scoreMap(mem),
            winner: null,
          });
        }
      }
    });
  }); // end io.on('connection')


  /* ================================================================== */
  /*  GAME ENGINE (server-side)                                          */
  /* ================================================================== */

  /**
   * startTurn – picks a drawer, assigns a word, starts the countdown.
   */
  async function startTurn(io, roomCode) {
    const mem = activeRooms.get(roomCode);
    if (!mem || mem.gameState !== 'playing') return;

    clearTimer(mem);
    mem.guessedPlayers = new Set();
    mem.currentWord    = pick(WORDS);
    mem.timeRemaining  = mem.roundTime;

    // Skip disconnected drawers
    let attempts = 0;
    while (attempts < mem.drawTurnOrder.length) {
      const drawerSocketId = mem.drawTurnOrder[mem.drawTurnIndex];
      const drawer = mem.players.find(p => p.socketId === drawerSocketId);
      if (drawer?.isConnected) break;
      advanceTurn(mem);
      attempts++;
      if (mem.currentRound > mem.totalRounds) {
        return endGame(io, roomCode);
      }
    }

    const drawerSocketId = mem.drawTurnOrder[mem.drawTurnIndex];
    const drawer = mem.players.find(p => p.socketId === drawerSocketId);
    if (!drawer) return endGame(io, roomCode);

    // Persist turn info
    await Room.findOneAndUpdate(
      { roomCode },
      {
        currentDrawerIndex: mem.drawTurnIndex,
        currentWord:        mem.currentWord,
        currentRound:       mem.currentRound,
      }
    ).catch(() => {});

    // Tell the drawer their secret word
    io.to(drawerSocketId).emit('youAreDrawing', {
      word:        mem.currentWord,
      round:       mem.currentRound,
      totalRounds: mem.totalRounds,
      timeLimit:   mem.roundTime,
    });

    // Tell everyone else the hint + who is drawing
    io.to(roomCode).emit('turnStart', {
      drawerName:  drawer.name,
      drawerId:    drawerSocketId,
      hint:        wordHint(mem.currentWord),
      wordLength:  mem.currentWord.length,
      round:       mem.currentRound,
      totalRounds: mem.totalRounds,
      timeLimit:   mem.roundTime,
    });

    // Server-side countdown
    mem.timer = setInterval(() => {
      mem.timeRemaining--;
      io.to(roomCode).emit('timerTick', { timeLeft: mem.timeRemaining });
      if (mem.timeRemaining <= 0) endTurn(io, roomCode);
    }, 1000);
  }

  /**
   * endTurn – stops timer, reveals word, advances state.
   */
  function endTurn(io, roomCode) {
    const mem = activeRooms.get(roomCode);
    if (!mem) return;

    clearTimer(mem);

    io.to(roomCode).emit('turnEnd', {
      word:   mem.currentWord,
      scores: scoreMap(mem),
    });

    const roundAdvanced = advanceTurn(mem);

    if (mem.currentRound > mem.totalRounds) {
      setTimeout(() => endGame(io, roomCode), 4000);
    } else {
      if (roundAdvanced) {
        io.to(roomCode).emit('newRound', {
          round:       mem.currentRound,
          totalRounds: mem.totalRounds,
        });
      }
      setTimeout(() => startTurn(io, roomCode), 4000);
    }
  }

  /**
   * advanceTurn – increments drawer index; returns true if a new round began.
   */
  function advanceTurn(mem) {
    mem.drawTurnIndex++;
    if (mem.drawTurnIndex >= mem.drawTurnOrder.length) {
      mem.currentRound++;
      mem.drawTurnIndex  = 0;
      mem.drawTurnOrder  = shuffle(
        mem.players.filter(p => p.isConnected).map(p => p.socketId)
      );
      return true; // new round
    }
    return false;
  }

  /**
   * endGame – finalise scores, emit results.
   */
  async function endGame(io, roomCode) {
    const mem = activeRooms.get(roomCode);
    if (!mem) return;

    clearTimer(mem);
    mem.gameState = 'ended';

    const sorted = scoreMap(mem);
    const winner = sorted[0] || null;

    io.to(roomCode).emit('gameEnded', {
      scores: sorted,
      winner: winner?.name || null,
      reason: 'Game complete!',
    });

    await Room.findOneAndUpdate({ roomCode }, { gameState: 'ended' }).catch(() => {});
    console.log(`🏁  Game ended in room ${roomCode}, winner: ${winner?.name}`);
  }

  function clearTimer(mem) {
    if (mem.timer) { clearInterval(mem.timer); mem.timer = null; }
  }
};
