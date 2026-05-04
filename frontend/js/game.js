/**
 * game.js  –  Full game client
 * ─────────────────────────────
 * Responsibilities:
 *  • Socket.io connection & all event handlers
 *  • HTML5 Canvas drawing engine (pen / eraser / fill)
 *  • Real-time draw data relay
 *  • Chat / guessing UI
 *  • Turn / round / game state machine
 *  • Score display & end-game scoreboard
 *  • Reconnect logic using sessionStorage
 */

'use strict';

/* ================================================================== */
/*  1.  SESSION DATA                                                    */
/* ================================================================== */
const SESSION = {
  playerName:  sessionStorage.getItem('playerName')  || '',
  action:      sessionStorage.getItem('action')      || 'join',
  roomCode:    sessionStorage.getItem('roomCode')    || '',
  totalRounds: parseInt(sessionStorage.getItem('totalRounds') || '3', 10),
  roundTime:   parseInt(sessionStorage.getItem('roundTime')   || '80', 10),
};

if (!SESSION.playerName) {
  window.location.href = 'index.html';
}

/* ================================================================== */
/*  2.  STATE                                                           */
/* ================================================================== */
let socket;
let mySocketId      = '';
let myRoomCode      = '';
let isHost          = false;
let isDrawing       = false;         // true when it's MY turn to draw
let currentDrawerId = '';
let gameState       = 'waiting';     // 'waiting' | 'playing' | 'ended'
let currentRound    = 0;
let totalRounds     = SESSION.totalRounds;
let hasGuessedRight = false;

/* Canvas */
let painting        = false;
let currentColor    = '#000000';
let brushSize       = 4;
let currentTool     = 'draw';       // 'draw' | 'eraser' | 'fill'
let lastX           = 0;
let lastY           = 0;

/* ================================================================== */
/*  3.  DOM REFS                                                        */
/* ================================================================== */
const dom = {
  connectScreen:    document.getElementById('connecting-screen'),
  gameLayout:       document.getElementById('game-layout'),
  wordDisplay:      document.getElementById('word-display'),
  roundInfo:        document.getElementById('round-info'),
  timer:            document.getElementById('timer'),
  headerRoomCode:   document.getElementById('header-room-code'),
  roomCodeBig:      document.getElementById('room-code-big'),
  waitingRoom:      document.getElementById('waiting-room'),
  playersList:      document.getElementById('players-list'),
  btnStart:         document.getElementById('btn-start'),
  toolbar:          document.getElementById('toolbar'),
  canvas:           document.getElementById('drawing-canvas'),
  canvasOverlay:    document.getElementById('canvas-overlay'),
  canvasOverlayTxt: document.getElementById('canvas-overlay-text'),
  turnOverlay:      document.getElementById('turn-overlay'),
  turnOverlayTitle: document.getElementById('turn-overlay-title'),
  turnOverlayBody:  document.getElementById('turn-overlay-body'),
  turnOverlayWord:  document.getElementById('turn-overlay-word'),
  chatMessages:     document.getElementById('chat-messages'),
  chatInput:        document.getElementById('chat-input'),
  scoreboardOverlay:document.getElementById('scoreboard-overlay'),
  finalScoreList:   document.getElementById('final-score-list'),
  winnerName:       document.getElementById('winner-name'),
  btnRestart:       document.getElementById('btn-restart'),
  notifPop:         document.getElementById('notif-pop'),
  notifTitle:       document.getElementById('notif-title'),
  notifBody:        document.getElementById('notif-body'),
};

const ctx = dom.canvas.getContext('2d');

/* ================================================================== */
/*  4.  TOAST & NOTIFICATION HELPERS                                   */
/* ================================================================== */
function showToast(msg, type = 'info', duration = 3500) {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), duration);
}

function showNotif(title, body, duration = 3000) {
  dom.notifTitle.textContent = title;
  dom.notifBody.textContent  = body;
  dom.notifPop.classList.add('show');
  setTimeout(() => dom.notifPop.classList.remove('show'), duration);
}

/* ================================================================== */
/*  5.  CANVAS HELPERS                                                  */
/* ================================================================== */
function resizeCanvas() {
  const wrapper = dom.canvas.parentElement;
  const maxW = wrapper.clientWidth  - 32;
  const maxH = wrapper.clientHeight - 32;
  const ratio = 800 / 560;
  let w = maxW, h = maxW / ratio;
  if (h > maxH) { h = maxH; w = maxH * ratio; }
  dom.canvas.style.width  = `${w}px`;
  dom.canvas.style.height = `${h}px`;
}

function getCanvasPos(e) {
  const rect  = dom.canvas.getBoundingClientRect();
  const scaleX = dom.canvas.width  / rect.width;
  const scaleY = dom.canvas.height / rect.height;
  const src = e.touches ? e.touches[0] : e;
  return {
    x: (src.clientX - rect.left) * scaleX,
    y: (src.clientY - rect.top)  * scaleY,
  };
}

/* ── Flood fill (bucket) ─────────────────────────────────────────── */
function hexToRgba(hex) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return [r, g, b, 255];
}
function colorsMatch(a, b, tol = 30) {
  return Math.abs(a[0]-b[0]) + Math.abs(a[1]-b[1]) +
         Math.abs(a[2]-b[2]) + Math.abs(a[3]-b[3]) < tol;
}
function floodFill(startX, startY, fillColor) {
  startX = Math.round(startX);
  startY = Math.round(startY);
  const imgData = ctx.getImageData(0, 0, dom.canvas.width, dom.canvas.height);
  const data    = imgData.data;
  const W       = dom.canvas.width;
  const H       = dom.canvas.height;
  const idx     = (y, x) => (y * W + x) * 4;
  const startIdx = idx(startY, startX);
  const target   = [data[startIdx], data[startIdx+1], data[startIdx+2], data[startIdx+3]];
  const fill     = hexToRgba(fillColor);
  if (colorsMatch(target, fill, 5)) return;

  const stack = [[startX, startY]];
  const visited = new Uint8Array(W * H);

  while (stack.length) {
    const [cx, cy] = stack.pop();
    if (cx < 0 || cx >= W || cy < 0 || cy >= H) continue;
    const i = cy * W + cx;
    if (visited[i]) continue;
    const di = i * 4;
    if (!colorsMatch([data[di],data[di+1],data[di+2],data[di+3]], target)) continue;
    visited[i] = 1;
    data[di]   = fill[0]; data[di+1] = fill[1];
    data[di+2] = fill[2]; data[di+3] = fill[3];
    stack.push([cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]);
  }
  ctx.putImageData(imgData, 0, 0);
}

/* ── Draw a line segment ─────────────────────────────────────────── */
function drawSegment(x0, y0, x1, y1, color, size, tool) {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.strokeStyle = tool === 'eraser' ? '#ffffff' : color;
  ctx.lineWidth   = tool === 'eraser' ? size * 2.5 : size;
  ctx.lineCap     = 'round';
  ctx.lineJoin    = 'round';
  ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
  ctx.stroke();
  ctx.globalCompositeOperation = 'source-over';
}

/* ================================================================== */
/*  6.  CANVAS EVENT LISTENERS                                         */
/* ================================================================== */
function onPointerDown(e) {
  if (!isDrawing) return;
  e.preventDefault();
  const pos = getCanvasPos(e);
  lastX = pos.x; lastY = pos.y;

  if (currentTool === 'fill') {
    floodFill(pos.x, pos.y, currentColor);
    socket.emit('fillCanvas', { roomCode: myRoomCode, color: currentColor,
      x: pos.x / dom.canvas.width, y: pos.y / dom.canvas.height });
    return;
  }
  painting = true;
  drawSegment(lastX, lastY, lastX+0.1, lastY+0.1, currentColor, brushSize, currentTool);
  socket.emit('draw', { roomCode: myRoomCode, drawData: {
    type: 'dot', x0: lastX, y0: lastY, color: currentColor, size: brushSize, tool: currentTool,
  }});
}

function onPointerMove(e) {
  if (!isDrawing || !painting) return;
  e.preventDefault();
  const pos = getCanvasPos(e);
  drawSegment(lastX, lastY, pos.x, pos.y, currentColor, brushSize, currentTool);
  socket.emit('draw', { roomCode: myRoomCode, drawData: {
    type: 'line', x0: lastX, y0: lastY, x1: pos.x, y1: pos.y,
    color: currentColor, size: brushSize, tool: currentTool,
  }});
  lastX = pos.x; lastY = pos.y;
}

function onPointerUp(e) { painting = false; }

dom.canvas.addEventListener('mousedown',  onPointerDown, { passive: false });
dom.canvas.addEventListener('mousemove',  onPointerMove, { passive: false });
dom.canvas.addEventListener('mouseup',    onPointerUp);
dom.canvas.addEventListener('mouseleave', onPointerUp);
dom.canvas.addEventListener('touchstart', onPointerDown, { passive: false });
dom.canvas.addEventListener('touchmove',  onPointerMove, { passive: false });
dom.canvas.addEventListener('touchend',   onPointerUp);

/* ================================================================== */
/*  7.  TOOLBAR ACTIONS (global functions called from HTML)            */
/* ================================================================== */
window.setColor = function(el) {
  if (!isDrawing) return;
  currentColor = el.dataset.color;
  if (currentTool === 'eraser') setTool('draw');
  document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
  el.classList.add('active');
};

window.setCustomColor = function(val) {
  if (!isDrawing) return;
  currentColor = val;
  if (currentTool === 'eraser') setTool('draw');
  document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
};

window.setBrush = function(el, size) {
  if (!isDrawing) return;
  brushSize = size;
  document.querySelectorAll('.brush-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
};

window.setTool = function(tool) {
  if (!isDrawing) return;
  currentTool = tool;
  ['draw','eraser','fill'].forEach(t => {
    document.getElementById(`tool-${t}`)?.classList.remove('active');
  });
  document.getElementById(`tool-${tool}`)?.classList.add('active');
  dom.canvas.className = tool === 'eraser' ? 'eraser-cursor'
                       : tool === 'fill'   ? 'fill-cursor'
                       : '';
};

window.clearCanvas = function() {
  if (!isDrawing) return;
  ctx.clearRect(0, 0, dom.canvas.width, dom.canvas.height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, dom.canvas.width, dom.canvas.height);
  socket.emit('clearCanvas', { roomCode: myRoomCode });
};

function resetCanvas() {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, dom.canvas.width, dom.canvas.height);
}

/* ================================================================== */
/*  8.  UI STATE HELPERS                                               */
/* ================================================================== */
const AVATAR_COLORS = [
  '#6366f1','#22d3ee','#f43f5e','#10b981','#f59e0b',
  '#8b5cf6','#ec4899','#14b8a6','#f97316','#a3e635',
];
function avatarColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

function setDrawingMode(enabled) {
  isDrawing = enabled;
  dom.toolbar.style.opacity       = enabled ? '1' : '0.35';
  dom.toolbar.style.pointerEvents = enabled ? 'auto' : 'none';
  if (enabled) {
    dom.canvasOverlay.classList.add('hidden');
  } else {
    dom.canvasOverlay.classList.remove('hidden');
  }
}

function updatePlayersList(players) {
  dom.playersList.innerHTML = '';
  players.forEach(p => {
    const div = document.createElement('div');
    div.className = 'player-item' +
      (p.socketId === currentDrawerId ? ' drawing' : '') +
      (!p.isConnected ? ' disconnected' : '');
    div.id = `player-${p.socketId}`;

    const isMe = p.socketId === mySocketId;
    const badgeText = [
      p.isHost ? '👑 Host' : '',
      isMe      ? '(you)'  : '',
    ].filter(Boolean).join(' ');

    div.innerHTML = `
      <div class="player-avatar" style="background:${avatarColor(p.name)}">
        ${p.name.charAt(0).toUpperCase()}
      </div>
      <div class="player-info">
        <div class="player-name">${escHtml(p.name)}</div>
        <div class="player-badge">
          ${p.socketId === currentDrawerId ? '<span class="drawing-pencil">✏️</span>' : ''}
          ${badgeText}
        </div>
      </div>
      <div class="player-score">${p.score ?? 0}</div>
    `;
    dom.playersList.appendChild(div);
  });
}

function switchToGameView() {
  dom.waitingRoom.classList.add('hidden');
  dom.playersList.classList.remove('hidden');
}

function switchToWaitingView() {
  dom.waitingRoom.classList.remove('hidden');
  dom.playersList.classList.add('hidden');
}

function setRoomCode(code) {
  myRoomCode = code;
  dom.headerRoomCode.textContent = code;
  dom.roomCodeBig.textContent    = code;
  sessionStorage.setItem('roomCode', code);
}

/* ================================================================== */
/*  9.  CHAT                                                           */
/* ================================================================== */
function appendChat(playerName, message, type = 'guess') {
  const div   = document.createElement('div');
  div.className = `chat-msg ${type}`;

  if (type === 'system') {
    div.textContent = message;
  } else {
    const nameSpan = document.createElement('span');
    nameSpan.className   = 'chat-msg-name';
    nameSpan.textContent = playerName + ':';
    nameSpan.style.color = avatarColor(playerName);
    div.appendChild(nameSpan);
    div.appendChild(document.createTextNode(' ' + message));
  }

  if (type === 'close') {
    const hint = document.createElement('span');
    hint.textContent = ' 🔥 close!';
    hint.style.color = 'var(--gold)';
    div.appendChild(hint);
  }

  dom.chatMessages.appendChild(div);
  dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
}

window.handleChatKey = function(e) {
  if (e.key === 'Enter') sendGuess();
};

window.sendGuess = function() {
  const msg = dom.chatInput.value.trim();
  if (!msg || !myRoomCode) return;

  if (gameState === 'playing') {
    if (isDrawing) {
      socket.emit('chatMessage', { roomCode: myRoomCode, message: msg, playerName: SESSION.playerName });
    } else if (!hasGuessedRight) {
      socket.emit('guess', { roomCode: myRoomCode, guess: msg, playerName: SESSION.playerName });
    } else {
      appendChat('You', msg, 'chat');
      socket.emit('chatMessage', { roomCode: myRoomCode, message: msg, playerName: SESSION.playerName });
    }
  } else {
    socket.emit('chatMessage', { roomCode: myRoomCode, message: msg, playerName: SESSION.playerName });
    appendChat(SESSION.playerName, msg, 'chat');
  }
  dom.chatInput.value = '';
};

/* ================================================================== */
/*  10.  SCOREBOARD                                                     */
/* ================================================================== */
function showScoreboard(scores, winner) {
  dom.finalScoreList.innerHTML = '';
  const medals = ['🥇','🥈','🥉'];
  scores.forEach((entry, i) => {
    const div = document.createElement('div');
    div.className = 'score-entry';
    div.innerHTML = `
      <span class="score-rank">${medals[i] || (i+1)}</span>
      <span class="score-name">${escHtml(entry.name)}</span>
      <span class="score-pts">${entry.score} pts</span>
    `;
    dom.finalScoreList.appendChild(div);
  });
  dom.winnerName.textContent = winner || (scores[0]?.name ?? 'Nobody');
  dom.scoreboardOverlay.classList.remove('hidden');

  // Only host can see restart button
  dom.btnRestart.style.display = isHost ? 'inline-flex' : 'none';
}

window.requestRestart = function() {
  socket.emit('restartGame', { roomCode: myRoomCode });
  dom.scoreboardOverlay.classList.add('hidden');
};

window.leaveGame = function() {
  sessionStorage.clear();
  window.location.href = 'index.html';
};

/* ================================================================== */
/*  11.  TIMER                                                          */
/* ================================================================== */
function updateTimer(sec) {
  dom.timer.textContent = sec;
  dom.timer.className = 'timer' + (sec <= 10 ? ' urgent' : sec <= 20 ? ' warn' : '');
}

/* ================================================================== */
/*  12.  TURN OVERLAY                                                   */
/* ================================================================== */
function showTurnOverlay(title, body, word, duration = 3500) {
  dom.turnOverlayTitle.textContent = title;
  dom.turnOverlayBody.textContent  = body;
  dom.turnOverlayWord.textContent  = word;
  dom.turnOverlay.classList.remove('hidden');
  setTimeout(() => dom.turnOverlay.classList.add('hidden'), duration);
}

/* ================================================================== */
/*  13.  COPY ROOM CODE                                                 */
/* ================================================================== */
window.copyRoomCode = function() {
  navigator.clipboard.writeText(myRoomCode).then(() => {
    showToast(`Room code "${myRoomCode}" copied!`, 'success', 2000);
  }).catch(() => showToast(myRoomCode, 'info'));
};

/* ================================================================== */
/*  14.  START GAME (host only)                                        */
/* ================================================================== */
window.startGame = function() {
  if (!isHost) return;
  socket.emit('startGame', { roomCode: myRoomCode }, res => {
    if (!res?.success) showToast(res?.error || 'Could not start game.', 'error');
  });
};

/* ================================================================== */
/*  15.  ESCAPE HTML                                                    */
/* ================================================================== */
function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ================================================================== */
/*  16.  SOCKET CONNECTION & EVENTS                                    */
/* ================================================================== */
function initSocket() {
  socket = io({ transports: ['websocket', 'polling'] });

  /* ── Connected ──────────────────────────────────────────────── */
  socket.on('connect', () => {
    mySocketId = socket.id;
    console.log('🔌 Connected:', mySocketId);
    dom.connectScreen.style.display = 'none';
    dom.gameLayout.style.display    = 'grid';
    resizeCanvas();
    resetCanvas();
    doRoomAction();
  });

  /* ── Connection error ───────────────────────────────────────── */
  socket.on('connect_error', err => {
    console.error('Connection error:', err);
    showToast('Connection failed. Retrying…', 'error');
  });

  /* ── Reconnect ──────────────────────────────────────────────── */
  socket.on('disconnect', () => {
    showToast('Disconnected from server. Reconnecting…', 'warn');
  });

  socket.io.on('reconnect', () => {
    showToast('Reconnected!', 'success');
    // Try to rejoin the active room
    if (myRoomCode) {
      socket.emit('rejoinRoom', { roomCode: myRoomCode, playerName: SESSION.playerName }, res => {
        if (!res?.success) {
          showToast(res?.error || 'Could not rejoin.', 'error');
        } else {
          handleRejoinState(res);
        }
      });
    }
  });

  /* ────────────────────────────────────────────────────────────
     ROOM EVENTS
  ──────────────────────────────────────────────────────────── */

  socket.on('playerJoined', ({ player, players }) => {
    updateWaitingPlayers(players);
    if (player.socketId !== mySocketId) {
      appendChat('', `${player.name} joined the room.`, 'system');
      showToast(`${player.name} joined!`, 'info', 2000);
    }
  });

  socket.on('playerDisconnected', ({ playerName, players }) => {
    appendChat('', `${playerName} disconnected.`, 'system');
    showToast(`${playerName} left.`, 'warn', 2500);
    if (gameState === 'playing') updatePlayersList(players);
    else updateWaitingPlayers(players);
  });

  socket.on('playerRejoined', ({ playerName, players }) => {
    appendChat('', `${playerName} reconnected.`, 'system');
    showToast(`${playerName} rejoined!`, 'success', 2000);
    updatePlayersList(players);
  });

  socket.on('becameHost', () => {
    isHost = true;
    showNotif('You are now the Host!', 'You can start the game.');
    if (gameState === 'waiting') dom.btnStart.classList.remove('hidden');
  });

  socket.on('systemMessage', msg => {
    appendChat('', msg, 'system');
  });

  socket.on('gameRestarted', ({ players }) => {
    dom.scoreboardOverlay.classList.add('hidden');
    gameState = 'waiting';
    hasGuessedRight = false;
    currentDrawerId = '';
    dom.wordDisplay.textContent = 'Waiting…';
    dom.timer.textContent       = '—';
    dom.roundInfo.textContent   = 'Round 0 / 0';
    resetCanvas();
    appendChat('', 'Game restarted! Waiting to start…', 'system');
    dom.chatMessages.innerHTML = '';
    switchToWaitingView();
    updateWaitingPlayers(players);
  });

  /* ────────────────────────────────────────────────────────────
     GAME FLOW EVENTS
  ──────────────────────────────────────────────────────────── */

  socket.on('gameStarted', ({ players, totalRounds: tr, roundTime }) => {
    gameState   = 'playing';
    totalRounds = tr;
    switchToGameView();
    dom.chatMessages.innerHTML = '';
    appendChat('', 'Game started! Get ready to draw and guess.', 'system');
    showNotif('Game Started!', 'First turn begins soon…');
    updatePlayersList(players);
  });

  socket.on('youAreDrawing', ({ word, round, totalRounds: tr, timeLimit }) => {
    currentRound    = round;
    totalRounds     = tr;
    isDrawing       = true;
    hasGuessedRight = false;
    currentDrawerId = mySocketId;

    setDrawingMode(true);
    dom.wordDisplay.textContent = word.toUpperCase();
    dom.roundInfo.textContent   = `Round ${round} / ${tr}`;
    dom.chatInput.placeholder   = 'Chat (others are guessing)…';

    resetCanvas();
    showNotif('Your Turn to Draw!', `Word: ${word.toUpperCase()}`, 4000);
    appendChat('', `Your word is: "${word}". Start drawing!`, 'system');
    updateTimer(timeLimit);
    updatePlayersList(buildPlayerList());
  });

  socket.on('turnStart', ({ drawerName, drawerId, hint, wordLength, round, totalRounds: tr, timeLimit }) => {
    currentRound    = round;
    totalRounds     = tr;
    currentDrawerId = drawerId;
    hasGuessedRight = false;

    if (drawerId !== mySocketId) {
      isDrawing = false;
      setDrawingMode(false);
      dom.canvasOverlayTxt.textContent = `${drawerName} is drawing…`;
      dom.wordDisplay.textContent = hint;
      dom.chatInput.placeholder   = 'Type your guess…';
      dom.chatInput.disabled      = false;
    }

    dom.roundInfo.textContent = `Round ${round} / ${tr}`;
    updateTimer(timeLimit);
    resetCanvas();
    showNotif(`${drawerName} is drawing!`, `Word: ${hint}  (${wordLength} letters)`);
    appendChat('', `Round ${round}: ${drawerName} is drawing!`, 'system');
    updatePlayersList(buildPlayerList());
  });

  socket.on('timerTick', ({ timeLeft }) => {
    updateTimer(timeLeft);
  });

  socket.on('correctGuess', ({ playerName, points, scores }) => {
    const isMe = playerName === SESSION.playerName;

    if (isMe) {
      hasGuessedRight = true;
      dom.chatInput.disabled     = false;
      dom.chatInput.placeholder  = 'Guessed it! Keep chatting…';
      appendChat('', `✅ You guessed it! +${points} points!`, 'system');
      showNotif('Correct!', `+${points} points!`, 2500);
    } else {
      appendChat(playerName, `guessed the word! +${points} pts`, 'correct');
    }

    // Refresh score column
    updateScoresInList(scores);
  });

  socket.on('chatMessage', ({ playerName, message, type }) => {
    const isMe = playerName === SESSION.playerName;
    if (isMe && gameState === 'playing' && !isDrawing) return; // already shown locally
    appendChat(playerName, message, type === 'close' ? 'close' : type === 'system' ? 'system' : 'guess');
  });

  socket.on('turnEnd', ({ word, scores }) => {
    setDrawingMode(false);
    isDrawing       = false;
    currentDrawerId = '';
    updateScoresInList(scores);
    dom.wordDisplay.textContent = word.toUpperCase();
    dom.timer.textContent = '0';
    appendChat('', `Time's up! The word was: "${word}"`, 'system');
    showTurnOverlay('Turn Over!', 'The word was:', word.toUpperCase());
  });

  socket.on('newRound', ({ round, totalRounds: tr }) => {
    appendChat('', `──── Round ${round} of ${tr} ────`, 'system');
  });

  socket.on('gameEnded', ({ scores, winner, reason }) => {
    gameState = 'ended';
    dom.timer.textContent = '0';
    appendChat('', reason || 'Game over!', 'system');
    setTimeout(() => showScoreboard(scores, winner), 1500);
  });

  /* ────────────────────────────────────────────────────────────
     DRAWING RELAY EVENTS
  ──────────────────────────────────────────────────────────── */

  socket.on('draw', drawData => {
    if (isDrawing) return; // own strokes already rendered locally
    if (drawData.type === 'line') {
      drawSegment(drawData.x0, drawData.y0, drawData.x1, drawData.y1,
                  drawData.color, drawData.size, drawData.tool);
    } else if (drawData.type === 'dot') {
      drawSegment(drawData.x0, drawData.y0, drawData.x0+0.1, drawData.y0+0.1,
                  drawData.color, drawData.size, drawData.tool);
    }
  });

  socket.on('clearCanvas', () => {
    resetCanvas();
  });

  socket.on('fillCanvas', ({ color, x, y }) => {
    if (isDrawing) return;
    floodFill(
      x * dom.canvas.width,
      y * dom.canvas.height,
      color
    );
  });
}

/* ================================================================== */
/*  17.  ROOM ACTIONS                                                   */
/* ================================================================== */
function doRoomAction() {
  if (SESSION.action === 'create') {
    socket.emit('createRoom', {
      playerName:  SESSION.playerName,
      totalRounds: SESSION.totalRounds,
      roundTime:   SESSION.roundTime,
    }, res => {
      if (!res?.success) {
        showToast(res?.error || 'Could not create room.', 'error');
        setTimeout(() => (window.location.href = 'index.html'), 2000);
        return;
      }
      isHost  = true;
      setRoomCode(res.roomCode);
      dom.btnStart.classList.remove('hidden');
      appendChat('', `Room "${res.roomCode}" created. Share the code!`, 'system');
      updateWaitingPlayers([res.player]);
      sessionStorage.setItem('action', 'join'); // prevent re-create on F5
    });

  } else {
    // join
    const roomCode = SESSION.roomCode || sessionStorage.getItem('roomCode');
    socket.emit('joinRoom', {
      playerName: SESSION.playerName,
      roomCode,
    }, res => {
      if (!res?.success) {
        showToast(res?.error || 'Could not join room.', 'error');
        setTimeout(() => (window.location.href = 'index.html'), 2500);
        return;
      }
      isHost = res.player?.isHost || false;
      setRoomCode(res.roomCode);
      if (isHost) dom.btnStart.classList.remove('hidden');
      updateWaitingPlayers(res.players);
      appendChat('', `You joined room "${res.roomCode}".`, 'system');
    });
  }
}

/* ================================================================== */
/*  18.  REJOIN STATE RESTORATION                                      */
/* ================================================================== */
function handleRejoinState(res) {
  gameState   = res.gameState;
  currentRound = res.currentRound;
  totalRounds  = res.totalRounds;
  setRoomCode(myRoomCode);

  if (gameState === 'playing') {
    switchToGameView();
    updatePlayersList(res.players);
    dom.roundInfo.textContent = `Round ${res.currentRound} / ${res.totalRounds}`;

    if (res.isDrawing) {
      isDrawing       = true;
      currentDrawerId = mySocketId;
      setDrawingMode(true);
      dom.wordDisplay.textContent = res.word?.toUpperCase() || '';
      appendChat('', 'Reconnected – your turn to draw!', 'system');
    } else {
      setDrawingMode(false);
      dom.wordDisplay.textContent = res.word || '';
      dom.canvasOverlayTxt.textContent = `${res.drawerName} is drawing…`;
      appendChat('', 'Reconnected – guess the word!', 'system');
    }
    updateTimer(res.timeRemaining || 0);
  } else {
    updateWaitingPlayers(res.players);
  }
}

/* ================================================================== */
/*  19.  WAITING ROOM PLAYER LIST                                      */
/* ================================================================== */
let _cachedPlayers = [];

function updateWaitingPlayers(players) {
  _cachedPlayers = players;
  const ul = dom.waitingRoom.querySelector('#waiting-player-list') ||
             (() => {
               const el = document.createElement('div');
               el.id = 'waiting-player-list';
               el.style.cssText = 'display:flex;flex-direction:column;gap:4px;width:100%;';
               dom.waitingRoom.insertBefore(el, dom.btnStart);
               return el;
             })();

  ul.innerHTML = '';
  players.filter(p => p.isConnected).forEach(p => {
    const d = document.createElement('div');
    d.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 8px;border-radius:8px;background:rgba(255,255,255,0.04);font-size:0.82rem;';
    d.innerHTML = `
      <div style="width:24px;height:24px;border-radius:50%;background:${avatarColor(p.name)};
                  display:flex;align-items:center;justify-content:center;font-size:0.7rem;font-weight:700;color:#fff;">
        ${p.name.charAt(0).toUpperCase()}
      </div>
      <span style="flex:1">${escHtml(p.name)}</span>
      ${p.isHost ? '<span style="color:var(--gold);font-size:0.7rem">👑</span>' : ''}
      ${p.socketId === mySocketId ? '<span style="color:var(--text-muted);font-size:0.7rem">(you)</span>' : ''}
    `;
    ul.appendChild(d);
  });
}

function buildPlayerList() {
  return _cachedPlayers;
}

function updateScoresInList(scores) {
  scores.forEach(entry => {
    const el = document.getElementById(`player-${entry.socketId}`);
    if (el) {
      const scoreEl = el.querySelector('.player-score');
      if (scoreEl) scoreEl.textContent = entry.score;
    }
  });
  // Also update our cached list
  scores.forEach(s => {
    const p = _cachedPlayers.find(pl => pl.socketId === s.socketId);
    if (p) p.score = s.score;
  });
}

/* ================================================================== */
/*  20.  WINDOW RESIZE                                                  */
/* ================================================================== */
window.addEventListener('resize', resizeCanvas);

/* ================================================================== */
/*  21.  KICK OFF                                                       */
/* ================================================================== */
initSocket();
