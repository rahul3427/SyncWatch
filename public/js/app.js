// ─── SyncWatch Landing Page — Password Gate ─────────────────
const $ = (sel) => document.querySelector(sel);

const nickInput = $('#nickname');
const passwordInput = $('#password');
const btnEnter = $('#btn-enter');
const errorMsg = $('#error-msg');

const CORRECT_PASSWORD = 'RahulSri123';

function showError(msg) {
  errorMsg.textContent = msg;
  errorMsg.style.display = 'block';
  setTimeout(() => { errorMsg.style.display = 'none'; }, 4000);
}

// ── Enter SyncWatch ──
btnEnter.addEventListener('click', async () => {
  const nick = nickInput.value.trim();
  if (!nick) {
    showError('Please enter a nickname first!');
    nickInput.focus();
    return;
  }

  const password = passwordInput.value;
  if (!password) {
    showError('Please enter the password!');
    passwordInput.focus();
    return;
  }

  if (password !== CORRECT_PASSWORD) {
    showError('Incorrect password. Please try again.');
    passwordInput.value = '';
    passwordInput.focus();
    return;
  }

  // Password correct — save nick and auth flag, then create a room
  localStorage.setItem('syncwatch-nick', nick);
  sessionStorage.setItem('syncwatch-auth', 'true');

  btnEnter.disabled = true;
  btnEnter.textContent = 'Entering...';

  try {
    const res = await fetch('/api/create-room');
    const data = await res.json();
    window.location.href = `/room/${data.roomId}`;
  } catch (err) {
    showError('Failed to create room. Please try again.');
    btnEnter.disabled = false;
    btnEnter.textContent = 'Enter SyncWatch';
  }
});

// ── Enter Key Support ──
passwordInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') btnEnter.click();
});
nickInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') passwordInput.focus();
});
