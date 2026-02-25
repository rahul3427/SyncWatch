// ─── SyncWatch Room — Core Logic ────────────────────────────
// Handles: Socket.IO, YouTube IFrame API, search sync, browse sync, chat

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ─── URL Params ─────────────────────────────────────────────
const params = new URLSearchParams(window.location.search);
const ROOM_ID = params.get('room');
const NICK = params.get('nick') || 'Anonymous';

if (!ROOM_ID) {
  window.location.href = '/';
}

// ─── Display room code ─────────────────────────────────────
$('#room-code-display').textContent = ROOM_ID;
document.title = `SyncWatch — Room ${ROOM_ID}`;

// ─── Socket Connection ─────────────────────────────────────
const socket = io();
socket.emit('join-room', { roomId: ROOM_ID, nick: NICK });

// ─── State ──────────────────────────────────────────────────
let ytPlayer = null;
let ytReady = false;
let ignoreStateChange = false; // prevent echo loops
let currentVideoId = null;

// ═══════════════════════════════════════════════════════════
//  TOAST NOTIFICATIONS
// ═══════════════════════════════════════════════════════════
function showToast(message, duration = 3000) {
  const container = $('#toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ═══════════════════════════════════════════════════════════
//  COPY ROOM CODE
// ═══════════════════════════════════════════════════════════
$('#btn-copy-code').addEventListener('click', () => {
  navigator.clipboard.writeText(ROOM_ID).then(() => showToast('Room code copied!'));
});

// ═══════════════════════════════════════════════════════════
//  LEFT PANEL TABS
// ═══════════════════════════════════════════════════════════
$$('.panel-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    $$('.panel-tab').forEach(t => t.classList.remove('active'));
    $$('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    $(`#tab-${tab.dataset.tab}`).classList.add('active');
  });
});

// ═══════════════════════════════════════════════════════════
//  CENTER PANEL TABS (YouTube / Browser)
// ═══════════════════════════════════════════════════════════
$$('.center-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    $$('.center-tab').forEach(t => t.classList.remove('active'));
    $$('.center-view').forEach(v => v.classList.remove('active'));
    tab.classList.add('active');
    $(`#center-${tab.dataset.center}`).classList.add('active');
    // Show/hide URL bar
    const urlBar = $('#center-url-bar');
    if (tab.dataset.center === 'browser') {
      urlBar.style.display = 'flex';
    } else {
      urlBar.style.display = 'none';
    }
  });
});

// Center panel URL bar
$('#btn-center-go').addEventListener('click', () => {
  const url = $('#center-url-input').value.trim();
  if (url) loadInBrowser(url);
});
$('#center-url-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const url = $('#center-url-input').value.trim();
    if (url) loadInBrowser(url);
  }
});

function switchToCenterTab(tabName) {
  $$('.center-tab').forEach(t => t.classList.remove('active'));
  $$('.center-view').forEach(v => v.classList.remove('active'));
  $(`[data-center="${tabName}"]`).classList.add('active');
  $(`#center-${tabName}`).classList.add('active');
  const urlBar = $('#center-url-bar');
  urlBar.style.display = tabName === 'browser' ? 'flex' : 'none';
}

function loadInBrowser(url) {
  // Add https:// if missing
  if (!/^https?:\/\//i.test(url)) {
    url = 'https://' + url;
  }
  // Switch to browser tab in center panel
  switchToCenterTab('browser');
  // Load via proxy
  const proxyUrl = `/api/proxy?url=${encodeURIComponent(url)}`;
  $('#browse-frame').src = proxyUrl;
  $('#browser-placeholder').style.display = 'none';
  $('#now-browsing').style.display = 'flex';
  $('#now-browsing-url').textContent = url;
  $('#center-url-input').value = url;

  // Add to browse history on left panel
  addBrowseItem(url, 'You');
}

// ═══════════════════════════════════════════════════════════
//  YOUTUBE IFRAME API
// ═══════════════════════════════════════════════════════════
const ytScript = document.createElement('script');
ytScript.src = 'https://www.youtube.com/iframe_api';
document.head.appendChild(ytScript);

window.onYouTubeIframeAPIReady = function() {
  ytPlayer = new YT.Player('yt-player', {
    height: '100%',
    width: '100%',
    playerVars: {
      autoplay: 0,
      modestbranding: 1,
      rel: 0,
      fs: 1,
      playsinline: 1
    },
    events: {
      onReady: () => { ytReady = true; },
      onStateChange: onPlayerStateChange
    }
  });
};

function onPlayerStateChange(event) {
  if (ignoreStateChange) return;

  const state = event.data;
  const time = ytPlayer.getCurrentTime();

  // YT.PlayerState: PLAYING=1, PAUSED=2, BUFFERING=3
  if (state === YT.PlayerState.PLAYING) {
    socket.emit('youtube-state', { action: 'play', time });
  } else if (state === YT.PlayerState.PAUSED) {
    socket.emit('youtube-state', { action: 'pause', time });
  }
}

function loadVideo(videoId, title) {
  if (!ytReady) return;
  currentVideoId = videoId;

  $('#player-placeholder').style.display = 'none';
  $('#now-playing').style.display = 'flex';
  $('#now-playing-title').textContent = title || videoId;

  ignoreStateChange = true;
  ytPlayer.loadVideoById(videoId);
  setTimeout(() => { ignoreStateChange = false; }, 1500);

  // Highlight in results
  $$('.video-card').forEach(card => {
    card.classList.toggle('active', card.dataset.videoId === videoId);
  });
}

// ═══════════════════════════════════════════════════════════
//  YOUTUBE SEARCH
// ═══════════════════════════════════════════════════════════
$('#btn-yt-search').addEventListener('click', doYTSearch);
$('#yt-search-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doYTSearch();
});

async function doYTSearch() {
  const query = $('#yt-search-input').value.trim();
  if (!query) return;

  $('#yt-search-info').textContent = 'Searching...';
  $('#yt-results').innerHTML = '';

  try {
    const res = await fetch(`/api/youtube-search?q=${encodeURIComponent(query)}`);
    const data = await res.json();

    if (data.results.length === 0) {
      $('#yt-search-info').textContent = 'No results found. Try a different search.';
      return;
    }

    $('#yt-search-info').textContent = `${data.results.length} results for "${query}"`;
    renderYTResults(data.results);

    // Share search results with room
    socket.emit('youtube-search-results', { query, results: data.results });
  } catch (err) {
    $('#yt-search-info').textContent = 'Search failed. Try again.';
  }
}

function renderYTResults(results) {
  const container = $('#yt-results');
  container.innerHTML = '';

  results.forEach(video => {
    const card = document.createElement('div');
    card.className = 'video-card';
    card.dataset.videoId = video.videoId;
    if (video.videoId === currentVideoId) card.classList.add('active');

    card.innerHTML = `
      <img class="video-thumb" src="${video.thumbnail}" alt="" loading="lazy">
      <div class="video-info">
        <div class="video-title">${escapeHTML(video.title)}</div>
        <div class="video-channel">${escapeHTML(video.channel)}</div>
      </div>
    `;
    card.addEventListener('click', () => {
      loadVideo(video.videoId, video.title);
      socket.emit('youtube-play', { videoId: video.videoId, title: video.title });
    });
    container.appendChild(card);
  });
}

// ═══════════════════════════════════════════════════════════
//  WEB SEARCH
// ═══════════════════════════════════════════════════════════
$('#btn-web-search').addEventListener('click', doWebSearch);
$('#web-search-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doWebSearch();
});

function doWebSearch() {
  const query = $('#web-search-input').value.trim();
  if (!query) return;

  $('#web-search-info').textContent = 'Searching...';
  $('#web-results').innerHTML = '';

  fetch(`/api/web-search?q=${encodeURIComponent(query)}`)
    .then(res => res.json())
    .then(data => {
      if (data.results.length === 0) {
        $('#web-search-info').textContent = 'No results found. Try a different search.';
        return;
      }
      $('#web-search-info').textContent = `${data.results.length} results for "${query}"`;
      renderWebResults(data.results);

      // Share with room
      socket.emit('web-search', { query, results: data.results });
    })
    .catch(() => {
      $('#web-search-info').textContent = 'Search failed. Try again.';
    });
}

function renderWebResults(results) {
  const container = $('#web-results');
  container.innerHTML = '';

  results.forEach(item => {
    const card = document.createElement('div');
    card.className = 'web-result-card';
    card.innerHTML = `
      <div class="web-result-title">${escapeHTML(item.title)}</div>
      <div class="web-result-url">${escapeHTML(item.displayUrl || item.url)}</div>
      <div class="web-result-snippet">${escapeHTML(item.snippet)}</div>
    `;
    card.addEventListener('click', () => {
      // Load in center panel browser via proxy
      loadInBrowser(item.url);
      socket.emit('browse-url', { url: item.url });
    });
    container.appendChild(card);
  });
}

// ═══════════════════════════════════════════════════════════
//  BROWSE URL
// ═══════════════════════════════════════════════════════════
$('#btn-browse').addEventListener('click', doBrowse);
$('#browse-url-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doBrowse();
});

function doBrowse() {
  let url = $('#browse-url-input').value.trim();
  if (!url) return;

  // Add https:// if missing
  if (!/^https?:\/\//i.test(url)) {
    url = 'https://' + url;
    $('#browse-url-input').value = url;
  }

  // Open in center panel browser via proxy
  loadInBrowser(url);
  $('#browse-info').textContent = `Opened: ${url}`;

  // Share with room
  socket.emit('browse-url', { url });
}

function addBrowseItem(url, by) {
  const container = $('#browse-history');
  const item = document.createElement('div');
  item.className = 'browse-item';
  item.innerHTML = `
    <span class="browse-item-icon">🔗</span>
    <span class="browse-item-url">${escapeHTML(url)}</span>
    <span class="browse-item-by">${escapeHTML(by)}</span>
  `;
  item.addEventListener('click', () => {
    loadInBrowser(url);
    socket.emit('browse-url', { url });
  });
  container.prepend(item);
}

// ═══════════════════════════════════════════════════════════
//  CHAT
// ═══════════════════════════════════════════════════════════
$('#btn-send-chat').addEventListener('click', sendChat);
$('#chat-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendChat();
});

function sendChat() {
  const input = $('#chat-input');
  const text = input.value.trim();
  if (!text) return;

  socket.emit('chat-message', { text });
  input.value = '';
  input.focus();
}

function renderChatMessage(msg) {
  const container = $('#chat-messages');
  const div = document.createElement('div');

  if (msg.nick === '🤖 System') {
    div.className = 'chat-msg system';
    div.textContent = msg.text;
  } else {
    div.className = 'chat-msg';
    div.innerHTML = `
      <span class="chat-msg-time">${msg.time}</span>
      <span class="chat-msg-nick">${escapeHTML(msg.nick)}</span>
      ${escapeHTML(msg.text)}
    `;
  }

  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

// ═══════════════════════════════════════════════════════════
//  SOCKET.IO EVENT HANDLERS
// ═══════════════════════════════════════════════════════════

// ── Room State (on join) ──
socket.on('room-state', (state) => {
  // Load current video if one is playing
  if (state.currentVideo) {
    loadVideo(state.currentVideo.videoId, state.currentVideo.title);
  }
  // Load browse URL
  if (state.browseUrl) {
    $('#browse-url-input').value = state.browseUrl;
    addBrowseItem(state.browseUrl, 'earlier');
    $('#browse-info').textContent = `Last shared: ${state.browseUrl}`;
    // Load it in the center browser
    const proxyUrl = `/api/proxy?url=${encodeURIComponent(state.browseUrl)}`;
    $('#browse-frame').src = proxyUrl;
    $('#browser-placeholder').style.display = 'none';
    $('#now-browsing').style.display = 'flex';
    $('#now-browsing-url').textContent = state.browseUrl;
    $('#center-url-input').value = state.browseUrl;
  }
  // Load chat history
  if (state.chatHistory) {
    state.chatHistory.forEach(msg => renderChatMessage(msg));
  }
});

// ── User List ──
socket.on('user-list', (users) => {
  $('#user-count').textContent = users.length;

  const container = $('#user-list');
  container.innerHTML = '';
  users.forEach(user => {
    const item = document.createElement('div');
    item.className = 'user-item';
    const isYou = user.nick === NICK;
    item.innerHTML = `
      <span class="user-dot"></span>
      <span class="user-nick">${escapeHTML(user.nick)}</span>
      ${isYou ? '<span class="user-you">(you)</span>' : ''}
    `;
    container.appendChild(item);
  });
});

// ── YouTube: Video Play ──
socket.on('youtube-play', ({ videoId, title, startedBy }) => {
  loadVideo(videoId, title);
  showToast(`${startedBy} started playing: ${title}`);
});

// ── YouTube: State Sync (play/pause/seek) ──
socket.on('youtube-state', ({ action, time, from }) => {
  if (!ytReady || !ytPlayer) return;

  ignoreStateChange = true;

  if (action === 'play') {
    ytPlayer.seekTo(time, true);
    ytPlayer.playVideo();
  } else if (action === 'pause') {
    ytPlayer.seekTo(time, true);
    ytPlayer.pauseVideo();
  }

  setTimeout(() => { ignoreStateChange = false; }, 1000);
});

// ── YouTube: Search Results from others ──
socket.on('youtube-search-results', ({ query, results, searchedBy }) => {
  $('#yt-search-input').value = query;
  $('#yt-search-info').textContent = `${results.length} results for "${query}" (by ${searchedBy})`;
  renderYTResults(results);

  // Switch to YouTube tab
  $$('.panel-tab').forEach(t => t.classList.remove('active'));
  $$('.tab-content').forEach(c => c.classList.remove('active'));
  $('[data-tab="yt-search"]').classList.add('active');
  $('#tab-yt-search').classList.add('active');

  showToast(`${searchedBy} searched: "${query}"`);
});

// ── Web Search from others ──
socket.on('web-search', ({ query, results, searchedBy }) => {
  $('#web-search-input').value = query;
  if (results && results.length > 0) {
    $('#web-search-info').textContent = `${results.length} results for "${query}" (by ${searchedBy})`;
    renderWebResults(results);
  } else {
    $('#web-search-info').textContent = `"${query}" searched by ${searchedBy}`;
  }

  // Switch to web search tab
  $$('.panel-tab').forEach(t => t.classList.remove('active'));
  $$('.tab-content').forEach(c => c.classList.remove('active'));
  $('[data-tab="web-search"]').classList.add('active');
  $('#tab-web-search').classList.add('active');

  showToast(`${searchedBy} searched the web: "${query}"`);
});

// ── Browse URL from others ──
socket.on('browse-url', ({ url, sharedBy }) => {
  $('#browse-url-input').value = url;
  addBrowseItem(url, sharedBy);
  $('#browse-info').textContent = `${sharedBy} shared: ${url}`;

  // Load in center browser via proxy
  switchToCenterTab('browser');
  const proxyUrl = `/api/proxy?url=${encodeURIComponent(url)}`;
  $('#browse-frame').src = proxyUrl;
  $('#browser-placeholder').style.display = 'none';
  $('#now-browsing').style.display = 'flex';
  $('#now-browsing-url').textContent = url;
  $('#center-url-input').value = url;

  // Switch to browse tab in left panel
  $$('.panel-tab').forEach(t => t.classList.remove('active'));
  $$('.tab-content').forEach(c => c.classList.remove('active'));
  $('[data-tab="browse"]').classList.add('active');
  $('#tab-browse').classList.add('active');

  showToast(`${sharedBy} is browsing: ${url}`);
});

// ── Chat Message ──
socket.on('chat-message', (msg) => {
  renderChatMessage(msg);
});

// ── Disconnect ──
socket.on('disconnect', () => {
  showToast('⚠️ Disconnected from server. Reconnecting...', 5000);
});

socket.on('reconnect', () => {
  socket.emit('join-room', { roomId: ROOM_ID, nick: NICK });
  showToast('✅ Reconnected!');
});

// ═══════════════════════════════════════════════════════════
//  UTILITIES
// ═══════════════════════════════════════════════════════════
function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
