// ─── SyncWatch Landing Page Logic ───────────────────────────
const $ = (sel) => document.querySelector(sel);

const nickInput = $('#nickname');
const roomCodeInput = $('#room-code');
const btnCreate = $('#btn-create');
const btnJoin = $('#btn-join');
const errorMsg = $('#error-msg');

function showError(msg) {
  errorMsg.textContent = msg;
  errorMsg.style.display = 'block';
  setTimeout(() => { errorMsg.style.display = 'none'; }, 4000);
}

function getNick() {
  const nick = nickInput.value.trim();
  if (!nick) {
    showError('Please enter a nickname first!');
    nickInput.focus();
    return null;
  }
  return nick;
}

// ── Create Room ──
btnCreate.addEventListener('click', async () => {
  const nick = getNick();
  if (!nick) return;

  btnCreate.disabled = true;
  btnCreate.textContent = 'Creating...';

  try {
    const res = await fetch('/api/create-room');
    const data = await res.json();
    window.location.href = `/room.html?room=${data.roomId}&nick=${encodeURIComponent(nick)}`;
  } catch (err) {
    showError('Failed to create room. Please try again.');
    btnCreate.disabled = false;
    btnCreate.textContent = 'Create Room';
  }
});

// ── Join Room ──
btnJoin.addEventListener('click', async () => {
  const nick = getNick();
  if (!nick) return;

  const code = roomCodeInput.value.trim().toUpperCase();
  if (!code) {
    showError('Please enter a room code!');
    roomCodeInput.focus();
    return;
  }

  btnJoin.disabled = true;
  btnJoin.textContent = 'Joining...';

  try {
    const res = await fetch(`/api/check-room/${code}`);
    const data = await res.json();

    if (data.exists) {
      window.location.href = `/room.html?room=${code}&nick=${encodeURIComponent(nick)}`;
    } else {
      // Auto-create room with the given code
      window.location.href = `/room.html?room=${code}&nick=${encodeURIComponent(nick)}`;
    }
  } catch (err) {
    showError('Failed to join room. Please try again.');
    btnJoin.disabled = false;
    btnJoin.textContent = 'Join Room';
  }
});

// ── Enter Key Support ──
roomCodeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') btnJoin.click();
});
nickInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    if (roomCodeInput.value.trim()) btnJoin.click();
    else roomCodeInput.focus();
  }
});
