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

  // Password correct — save nick and auth flag, then redirect to the global room
  localStorage.setItem('syncwatch-nick', nick);
  localStorage.setItem('syncwatch-auth', 'true');

  btnEnter.disabled = true;
  btnEnter.textContent = 'Entering...';

  // Redirect to the fixed GLOBAL room
  window.location.href = `/room/GLOBAL`;
});

// Check if already authenticated on landing page
window.addEventListener('load', () => {
  if (localStorage.getItem('syncwatch-auth') === 'true') {
    window.location.href = `/room/GLOBAL`;
  }
});

// ── Enter Key Support ──
passwordInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') btnEnter.click();
});
nickInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') passwordInput.focus();
});
