// ─── SyncWatch Room — YouTube + Chat ────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ─── Extract Room ID from URL path (/room/ROOMID) ──────────
const pathParts = window.location.pathname.split('/');
const ROOM_ID = pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2];

if (!ROOM_ID) {
  window.location.href = '/';
}

// ─── Password Gate ──────────────────────────────────────────
const CORRECT_PASSWORD = 'RahulSri123';
let NICK = null;
let socket = null;

function initRoom(nick) {
  NICK = nick;
  localStorage.setItem('syncwatch-nick', nick);
  sessionStorage.setItem('syncwatch-auth', 'true');

  // Hide overlay, show room
  $('#password-overlay').style.display = 'none';

  // Display room code
  $('#room-code-display').textContent = ROOM_ID;
  document.title = `SyncWatch — Room ${ROOM_ID}`;

  // Connect socket
  socket = io();
  socket.emit('join-room', { roomId: ROOM_ID, nick: NICK });

  // Initialize all socket event handlers
  initSocketHandlers();

  // Request Mic Access for Calling
  initMicrophone();
}

// Check if already authenticated
if (sessionStorage.getItem('syncwatch-auth') === 'true') {
  const savedNick = localStorage.getItem('syncwatch-nick') || 'Anonymous';
  initRoom(savedNick);
} else {
  // Show password overlay
  $('#password-overlay').style.display = 'flex';

  // Pre-fill saved nickname if any
  const savedNick = localStorage.getItem('syncwatch-nick');
  if (savedNick) $('#overlay-nick').value = savedNick;

  $('#btn-overlay-enter').addEventListener('click', () => {
    const nick = $('#overlay-nick').value.trim();
    if (!nick) {
      showOverlayError('Please enter a nickname!');
      $('#overlay-nick').focus();
      return;
    }
    const pw = $('#overlay-password').value;
    if (!pw) {
      showOverlayError('Please enter the password!');
      $('#overlay-password').focus();
      return;
    }
    if (pw !== CORRECT_PASSWORD) {
      showOverlayError('Incorrect password. Try again.');
      $('#overlay-password').value = '';
      $('#overlay-password').focus();
      return;
    }
    initRoom(nick);
  });

  $('#overlay-password').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#btn-overlay-enter').click();
  });
  $('#overlay-nick').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#overlay-password').focus();
  });
}

function showOverlayError(msg) {
  const el = $('#overlay-error');
  el.textContent = msg;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 3000);
}

// ─── State ──────────────────────────────────────────────────
let ytPlayer = null;

// WebRTC Calling State
let myStream = null;
let callingPeer = null;
let myId = null;
let receivingCall = false;
let caller = null;
let callerSignal = null;
let callAccepted = false;
let isMuted = false;
let ytReady = false;
let ignoreStateChange = false;
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
  const shareUrl = `${window.location.origin}/room/${ROOM_ID}`;
  navigator.clipboard.writeText(shareUrl).then(() => showToast('Share link copied! Send it to your friend 🔗'));
});

// ═══════════════════════════════════════════════════════════
//  MOBILE CHAT TOGGLE
// ═══════════════════════════════════════════════════════════
$('#btn-chat-toggle').addEventListener('click', () => {
  const chatPanel = $('#panel-chat');
  chatPanel.classList.toggle('open');
  // Clear badge
  $('#chat-badge').style.display = 'none';
});

// Close chat when clicking outside on mobile
document.addEventListener('click', (e) => {
  const chatPanel = $('#panel-chat');
  const toggleBtn = $('#btn-chat-toggle');
  if (chatPanel.classList.contains('open') &&
      !chatPanel.contains(e.target) &&
      !toggleBtn.contains(e.target)) {
    chatPanel.classList.remove('open');
  }
});

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
//  PICTURE-IN-PICTURE (Background Play)
// ═══════════════════════════════════════════════════════════
$('#btn-pip').addEventListener('click', async () => {
  try {
    // Get the video element inside the YouTube iframe
    const iframe = document.querySelector('#yt-player iframe');
    if (!iframe) {
      showToast('Start playing a video first');
      return;
    }

    // Try to use the iframe's video element for PiP
    // Since we can't access cross-origin iframe content,
    // we create a canvas-based PiP workaround
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture();
      showToast('Exited Picture-in-Picture');
    } else {
      // Try native PiP on the iframe (works in some browsers)
      if (iframe.requestPictureInPicture) {
        await iframe.requestPictureInPicture();
        showToast('🖼️ Picture-in-Picture enabled! You can minimize the browser.');
      } else {
        // Fallback: open video in a mini popup window
        if (currentVideoId) {
          const pipUrl = `https://www.youtube.com/embed/${currentVideoId}?autoplay=1&playsinline=1`;
          const pipWin = window.open(pipUrl, 'pip', 'width=400,height=250,top=50,right=50');
          if (pipWin) {
            showToast('🖼️ Opened mini player window! Keep it open for background audio.');
          } else {
            showToast('⚠️ Please allow popups for background play.');
          }
        }
      }
    }
  } catch (err) {
    showToast('⚠️ PiP not supported. Try the mini player on YouTube controls.');
  }
});

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

  // Blur input on mobile to close keyboard
  if (window.innerWidth <= 768) {
    $('#yt-search-input').blur();
  }

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
  // Keep focus on input for easy multiple messages
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

  // Show badge on mobile if chat is closed
  const chatPanel = $('#panel-chat');
  if (window.innerWidth <= 768 && !chatPanel.classList.contains('open')) {
    $('#chat-badge').style.display = 'block';
  }
}

// ═══════════════════════════════════════════════════════════
//  SOCKET.IO EVENT HANDLERS (called after auth)
// ═══════════════════════════════════════════════════════════
function initSocketHandlers() {
  // ── Room State (on join) ──
  socket.on('room-state', (state) => {
    if (state.currentVideo) {
      loadVideo(state.currentVideo.videoId, state.currentVideo.title);
    }
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
    updateCallButtonState(users.length);
  });

  // ── YouTube: Video Play ──
  socket.on('youtube-play', ({ videoId, title, startedBy }) => {
    loadVideo(videoId, title);
    showToast(`${startedBy} started playing: ${title}`);
  });

  // ── YouTube: State Sync ──
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
    showToast(`${searchedBy} searched: "${query}"`);
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

  // ── WebRTC Calling ──
  socket.on('me', (id) => { myId = id; });

  socket.on('callUser', (data) => {
    receivingCall = true;
    caller = data.from;
    callerSignal = data.signal;
    updateCallUI();
    showToast(`Incoming call from ${escapeHTML(data.name)}`);
  });

  socket.on('callAccepted', (signal) => {
    callAccepted = true;
    if (callingPeer) {
      callingPeer.signal(signal);
    }
    updateCallUI();
  });

  socket.on('callEnded', () => {
    if (callAccepted || receivingCall) {
      showToast('Call ended');
    }
    endCall(false);
  });
}

// ═══════════════════════════════════════════════════════════
//  WEBRTC CALLING LOGIC
// ═══════════════════════════════════════════════════════════

function updateCallButtonState(userCount) {
  const btnCall = $('#btn-call-partner');
  if (userCount > 1 && myStream && !callAccepted && !receivingCall) {
    btnCall.disabled = false;
    btnCall.title = 'Call Partner';
  } else {
    btnCall.disabled = true;
    btnCall.title = !myStream ? 'Waiting for mic access' : (callAccepted ? 'In call' : 'Need 2+ users to call');
  }
}

function updateCallUI() {
  const idlePanel = $('#call-idle');
  const incomingPanel = $('#call-incoming');
  const activePanel = $('#call-active');

  idlePanel.style.display = (!callAccepted && !receivingCall) ? 'block' : 'none';
  incomingPanel.style.display = (receivingCall && !callAccepted) ? 'block' : 'none';
  activePanel.style.display = callAccepted ? 'block' : 'none';
}

$('#btn-call-partner').addEventListener('click', callPartner);
$('#btn-answer-call').addEventListener('click', answerCall);
$('#btn-decline-call').addEventListener('click', declineCall);
$('#btn-mute-call').addEventListener('click', toggleMute);
$('#btn-end-call').addEventListener('click', () => endCall(true));

function initMicrophone() {
  navigator.mediaDevices.getUserMedia({ video: false, audio: true })
    .then((stream) => {
      myStream = stream;
      const userCount = parseInt($('#user-count').textContent) || 0;
      updateCallButtonState(userCount);
    })
    .catch((err) => {
      console.error("Error accessing mic:", err);
      showToast("Microphone access denied. You cannot call.");
    });
}

function callPartner() {
  if (!myStream || !myId) return;
  
  callingPeer = new SimplePeer({
    initiator: true,
    trickle: false,
    stream: myStream
  });

  callingPeer.on('signal', (data) => {
    socket.emit('callUser', { signalData: data, from: myId, name: NICK });
  });

  callingPeer.on('stream', (remoteStream) => {
    const remoteAudio = $('#remote-audio');
    if (remoteAudio) {
      if ('srcObject' in remoteAudio) {
        remoteAudio.srcObject = remoteStream;
      } else {
        remoteAudio.src = window.URL.createObjectURL(remoteStream);
      }
    }
  });

  showToast("Calling partner...");
  $('#btn-call-partner').disabled = true;
}

function answerCall() {
  callAccepted = true;
  receivingCall = false;
  updateCallUI();

  callingPeer = new SimplePeer({
    initiator: false,
    trickle: false,
    stream: myStream
  });

  callingPeer.on('signal', (data) => {
    socket.emit('answerCall', { signal: data, to: caller });
  });

  callingPeer.on('stream', (remoteStream) => {
    const remoteAudio = $('#remote-audio');
    if (remoteAudio) {
      if ('srcObject' in remoteAudio) {
        remoteAudio.srcObject = remoteStream;
      } else {
        remoteAudio.src = window.URL.createObjectURL(remoteStream);
      }
    }
  });

  if (callerSignal) {
    callingPeer.signal(callerSignal);
  }
}

function declineCall() {
  receivingCall = false;
  updateCallUI();
  socket.emit('endCall');
}

function endCall(notifyServer = true) {
  callAccepted = false;
  receivingCall = false;
  caller = null;
  callerSignal = null;
  
  if (callingPeer) {
    callingPeer.destroy();
    callingPeer = null;
  }
  
  if (notifyServer) {
    socket.emit('endCall');
  }
  
  updateCallUI();
  const userCount = parseInt($('#user-count').textContent) || 0;
  updateCallButtonState(userCount);
}

function toggleMute() {
  if (myStream) {
    const audioTrack = myStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      isMuted = !audioTrack.enabled;
      const btn = $('#btn-mute-call');
      btn.textContent = isMuted ? 'Unmute' : 'Mute';
      btn.className = isMuted ? 'btn-call btn-danger' : 'btn-call btn-ghost';
    }
  }
}

// ═══════════════════════════════════════════════════════════
//  UTILITIES
// ═══════════════════════════════════════════════════════════
function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

