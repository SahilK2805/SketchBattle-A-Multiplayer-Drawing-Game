/**
 * main.js  –  Lobby page logic
 * Handles create-room / join-room flows via REST then redirects
 * to game.html with session data stored in sessionStorage.
 */

/* ------------------------------------------------------------------ */
/*  Toast helper                                                        */
/* ------------------------------------------------------------------ */
function showToast(msg, type = 'info', duration = 3500) {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), duration);
}

/* ------------------------------------------------------------------ */
/*  Tab switching                                                       */
/* ------------------------------------------------------------------ */
function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.getElementById(`tab-${tab}`).classList.add('active');
  document.getElementById(`panel-${tab}`).classList.add('active');
}

/* ------------------------------------------------------------------ */
/*  Create Room                                                         */
/* ------------------------------------------------------------------ */
async function handleCreateRoom() {
  const nameInput  = document.getElementById('create-name');
  const rounds     = document.getElementById('rounds').value;
  const roundTime  = document.getElementById('round-time').value;
  const btn        = document.getElementById('btn-create');

  const playerName = nameInput.value.trim();
  if (!playerName) {
    showToast('Please enter your name.', 'error');
    nameInput.focus();
    return;
  }

  btn.disabled    = true;
  btn.textContent = '⏳ Creating…';

  try {
    // We just persist the room via socket in game.js; we only need the
    // socket to do the actual createRoom.  Store params in sessionStorage
    // and let game.js handle the socket flow.
    sessionStorage.setItem('playerName',  playerName);
    sessionStorage.setItem('action',      'create');
    sessionStorage.setItem('totalRounds', rounds);
    sessionStorage.setItem('roundTime',   roundTime);
    window.location.href = 'game.html';
  } catch (err) {
    console.error(err);
    showToast('Network error. Is the server running?', 'error');
    btn.disabled    = false;
    btn.textContent = '🚀 Create Room';
  }
}

/* ------------------------------------------------------------------ */
/*  Join Room                                                           */
/* ------------------------------------------------------------------ */
async function handleJoinRoom() {
  const nameInput = document.getElementById('join-name');
  const codeInput = document.getElementById('join-code');
  const btn       = document.getElementById('btn-join');

  const playerName = nameInput.value.trim();
  const roomCode   = codeInput.value.trim().toUpperCase();

  if (!playerName) {
    showToast('Please enter your name.', 'error');
    nameInput.focus();
    return;
  }
  if (!roomCode || roomCode.length !== 6) {
    showToast('Enter a valid 6-character room code.', 'error');
    codeInput.focus();
    return;
  }

  btn.disabled    = true;
  btn.textContent = '⏳ Joining…';

  try {
    // Quick existence check before navigating
    const res  = await fetch(`/api/room/${roomCode}`);
    const data = await res.json();

    if (!res.ok || data.error) {
      showToast(data.error || 'Room not found.', 'error');
      btn.disabled    = false;
      btn.textContent = '↗ Join Game';
      return;
    }
    if (!data.canJoin) {
      showToast('Game is already in progress. Cannot join.', 'warn');
      btn.disabled    = false;
      btn.textContent = '↗ Join Game';
      return;
    }

    sessionStorage.setItem('playerName', playerName);
    sessionStorage.setItem('action',     'join');
    sessionStorage.setItem('roomCode',   roomCode);
    window.location.href = 'game.html';

  } catch (err) {
    console.error(err);
    showToast('Cannot reach server. Is it running?', 'error');
    btn.disabled    = false;
    btn.textContent = '↗ Join Game';
  }
}

/* ------------------------------------------------------------------ */
/*  Enter key shortcuts                                                 */
/* ------------------------------------------------------------------ */
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  const active = document.querySelector('.tab-panel.active')?.id;
  if (active === 'panel-create') handleCreateRoom();
  else if (active === 'panel-join') handleJoinRoom();
});

/* ------------------------------------------------------------------ */
/*  Room-code input: auto-uppercase                                     */
/* ------------------------------------------------------------------ */
const codeEl = document.getElementById('join-code');
if (codeEl) {
  codeEl.addEventListener('input', () => {
    const sel = codeEl.selectionStart;
    codeEl.value = codeEl.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    codeEl.setSelectionRange(sel, sel);
  });
}
