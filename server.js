const express = require("express");
const http = require("http");
const https = require("https");
const { Server } = require("socket.io");
const { v4: uuidv4 } = require("uuid");
const fetch = require("node-fetch");
const cheerio = require("cheerio");
const path = require("path");

// HTTPS agent that bypasses SSL certificate issues (for proxy)
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(path.join(__dirname, "public")));

// ─── In-memory room store ───────────────────────────────────────────
const rooms = new Map(); // roomId -> { users: Map<socketId, {nick, id}>, currentVideo: null, searchQuery: '' }

// ─── REST: Create Room ──────────────────────────────────────────────
app.get("/api/create-room", (req, res) => {
  const roomId = uuidv4().slice(0, 8).toUpperCase();
  rooms.set(roomId, {
    users: new Map(),
    currentVideo: null,
    searchQuery: "",
    browseUrl: "",
    chatHistory: [],
  });
  res.json({ roomId });
});

// ─── REST: Check Room Exists ────────────────────────────────────────
app.get("/api/check-room/:roomId", (req, res) => {
  const roomId = req.params.roomId.toUpperCase();
  res.json({ exists: rooms.has(roomId) });
});

// ─── REST: YouTube Search Proxy ─────────────────────────────────────
app.get("/api/youtube-search", async (req, res) => {
  const query = req.query.q;
  if (!query) return res.json({ results: [] });

  try {
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    const response = await fetch(searchUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
      agent: httpsAgent,
    });
    const html = await response.text();

    // Extract video data from the page script
    const results = [];
    const regex = /\"videoId\":\"([a-zA-Z0-9_-]{11})\"/g;
    const titleRegex = /\"title\":\{\"runs\":\[\{\"text\":\"(.*?)\"\}\]/g;
    const channelRegex = /\"ownerText\":\{\"runs\":\[\{\"text\":\"(.*?)\"\}/g;

    const videoIds = [];
    let match;
    while ((match = regex.exec(html)) !== null) {
      if (!videoIds.includes(match[1])) {
        videoIds.push(match[1]);
      }
    }

    const titles = [];
    while ((match = titleRegex.exec(html)) !== null) {
      titles.push(match[1]);
    }

    const channels = [];
    while ((match = channelRegex.exec(html)) !== null) {
      channels.push(match[1]);
    }

    const count = Math.min(videoIds.length, 15);
    for (let i = 0; i < count; i++) {
      results.push({
        videoId: videoIds[i],
        title: titles[i] || "Untitled Video",
        channel: channels[i] || "Unknown Channel",
        thumbnail: `https://img.youtube.com/vi/${videoIds[i]}/mqdefault.jpg`,
      });
    }

    res.json({ results });
  } catch (err) {
    console.error("YouTube search error:", err.message);
    res.json({ results: [] });
  }
});

// ─── REST: Web Search Proxy ─────────────────────────────────────────
app.get('/api/web-search', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.json({ results: [] });

  try {
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      agent: httpsAgent,
    });
    const html = await response.text();
    const $ = cheerio.load(html);

    const results = [];
    $('.result').each((i, el) => {
      if (i >= 15) return false;
      const titleEl = $(el).find('.result__a');
      const snippetEl = $(el).find('.result__snippet');
      const urlEl = $(el).find('.result__url');

      const title = titleEl.text().trim();
      let url = titleEl.attr('href') || '';
      const snippet = snippetEl.text().trim();
      const displayUrl = urlEl.text().trim();

      // DuckDuckGo wraps URLs in a redirect, extract actual URL
      if (url.includes('uddg=')) {
        try {
          url = decodeURIComponent(url.split('uddg=')[1].split('&')[0]);
        } catch (e) { /* keep original */ }
      }

      if (title) {
        results.push({ title, url, snippet, displayUrl });
      }
    });

    res.json({ results });
  } catch (err) {
    console.error('Web search error:', err.message);
    res.json({ results: [] });
  }
});

// ─── REST: Proxy for external websites ──────────────────────────────
app.get('/api/proxy', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('Missing url parameter');

  try {
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': targetUrl,
      },
      redirect: 'follow',
      agent: httpsAgent,
    });

    const contentType = response.headers.get('content-type') || '';

    // For non-HTML content, pipe directly
    if (!contentType.includes('text/html')) {
      res.set('Content-Type', contentType);
      const buffer = await response.buffer();
      return res.send(buffer);
    }

    let html = await response.text();

    const parsedUrl = new URL(targetUrl);
    const baseUrl = `${parsedUrl.protocol}//${parsedUrl.host}`;

    // ── STEP 1: Remove frame-busting meta tags ──
    // Remove <meta http-equiv="X-Frame-Options" ...>
    html = html.replace(/<meta[^>]*http-equiv\s*=\s*["']?X-Frame-Options["']?[^>]*>/gi, '');
    // Remove <meta http-equiv="Content-Security-Policy" ...>
    html = html.replace(/<meta[^>]*http-equiv\s*=\s*["']?Content-Security-Policy["']?[^>]*>/gi, '');

    // ── STEP 2: Inject anti-frame-busting + link interceptor as FIRST script ──
    const baseTag = `<base href="${baseUrl}/" target="_self">`;
    const sandboxScript = `
    <script>
    // === ANTI FRAME-BUSTING: Must run BEFORE any other scripts ===
    (function() {
      // Override window.top to trick frame-busting checks
      try {
        if (window.self !== window.top) {
          Object.defineProperty(window, 'top', { get: function() { return window.self; } });
          Object.defineProperty(window, 'parent', { get: function() { return window.self; } });
          Object.defineProperty(window, 'frameElement', { get: function() { return null; } });
        }
      } catch(e) {}

      // Block common frame-busting patterns
      var origSetTimeout = window.setTimeout;
      window.setTimeout = function(fn, delay) {
        var fnStr = typeof fn === 'string' ? fn : (fn && fn.toString ? fn.toString() : '');
        if (fnStr.indexOf('top.location') !== -1 || fnStr.indexOf('parent.location') !== -1) {
          return; // Block frame-busting timers
        }
        return origSetTimeout.apply(this, arguments);
      };

      // Intercept window.open to route through proxy
      var origOpen = window.open;
      window.open = function(url) {
        if (url && url.startsWith('http')) {
          window.location.href = '/api/proxy?url=' + encodeURIComponent(url);
        }
        return null;
      };

      // Intercept link clicks
      document.addEventListener('click', function(e) {
        var link = e.target.closest('a');
        if (link) {
          var href = link.getAttribute('href');
          if (href && !href.startsWith('#') && !href.startsWith('javascript:') && !href.startsWith('data:')) {
            e.preventDefault();
            e.stopPropagation();
            try {
              var absolute = new URL(href, document.baseURI).href;
              if (absolute.startsWith('http')) {
                window.location.href = '/api/proxy?url=' + encodeURIComponent(absolute);
              }
            } catch(err) {}
          }
        }
      }, true);

      // Intercept form submissions
      document.addEventListener('submit', function(e) {
        var form = e.target;
        if (form.action) {
          e.preventDefault();
          try {
            var action = new URL(form.action, document.baseURI).href;
            var fd = new FormData(form);
            var params = new URLSearchParams(fd);
            var url = action + (action.includes('?') ? '&' : '?') + params.toString();
            window.location.href = '/api/proxy?url=' + encodeURIComponent(url);
          } catch(err) {}
        }
      }, true);

      // Notify parent frame of navigation
      try {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({ type: 'proxy-navigate', url: '${targetUrl.replace(/'/g, "\\'")}' }, '*');
        }
      } catch(e) {}
    })();
    </script>`;

    // Inject at the very top (before <html> even) so it runs first
    if (html.includes('<head>')) {
      html = html.replace('<head>', `<head>${baseTag}${sandboxScript}`);
    } else if (html.includes('<HEAD>')) {
      html = html.replace('<HEAD>', `<HEAD>${baseTag}${sandboxScript}`);
    } else if (html.includes('<html>') || html.includes('<HTML>')) {
      html = html.replace(/<html[^>]*>/i, `$&<head>${baseTag}${sandboxScript}</head>`);
    } else {
      html = `<head>${baseTag}${sandboxScript}</head>` + html;
    }

    // ── STEP 3: Set permissive response headers ──
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('Content-Security-Policy', "frame-ancestors *; default-src * 'unsafe-inline' 'unsafe-eval' data: blob:;");
    res.set('Access-Control-Allow-Origin', '*');
    res.removeHeader('X-Frame-Options');
    res.send(html);
  } catch (err) {
    console.error('Proxy error:', err.message);
    res.status(500).send(`
      <html>
        <body style="background:#1a1a2e;color:#e4e4e7;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
          <div style="text-align:center">
            <h2>⚠️ Could not load page</h2>
            <p style="color:#71717a">${err.message}</p>
            <p style="color:#71717a;font-size:0.85rem">URL: ${targetUrl}</p>
          </div>
        </body>
      </html>
    `);
  }
});

// ─── Socket.IO ──────────────────────────────────────────────────────
io.on("connection", (socket) => {
  console.log(`⚡ User connected: ${socket.id}`);

  let currentRoom = null;
  let currentNick = null;

  // ── Join Room ──
  socket.on("join-room", ({ roomId, nick }) => {
    roomId = roomId.toUpperCase();

    // Auto-create room if it doesn't exist
    if (!rooms.has(roomId)) {
      rooms.set(roomId, {
        users: new Map(),
        currentVideo: null,
        searchQuery: "",
        browseUrl: "",
        chatHistory: [],
      });
    }

    const room = rooms.get(roomId);
    currentRoom = roomId;
    currentNick = nick || `User-${socket.id.slice(0, 4)}`;

    room.users.set(socket.id, { nick: currentNick, id: socket.id });
    socket.join(roomId);

    // Send current room state to the new user
    socket.emit("room-state", {
      currentVideo: room.currentVideo,
      browseUrl: room.browseUrl,
      chatHistory: room.chatHistory,
    });

    // Broadcast updated user list
    const userList = Array.from(room.users.values());
    io.to(roomId).emit("user-list", userList);

    // System message
    const joinMsg = {
      nick: "🤖 System",
      text: `${currentNick} joined the room`,
      time: new Date().toLocaleTimeString(),
    };
    room.chatHistory.push(joinMsg);
    io.to(roomId).emit("chat-message", joinMsg);

    console.log(
      `👤 ${currentNick} joined room ${roomId} (${room.users.size} users)`,
    );
  });

  // ── YouTube: Play Video ──
  socket.on("youtube-play", ({ videoId, title }) => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (room) {
      room.currentVideo = { videoId, title };
      socket
        .to(currentRoom)
        .emit("youtube-play", { videoId, title, startedBy: currentNick });
    }
  });

  // ── YouTube: State Change (play/pause/seek) ──
  socket.on("youtube-state", (data) => {
    if (!currentRoom) return;
    socket
      .to(currentRoom)
      .emit("youtube-state", { ...data, from: currentNick });
  });

  // ── YouTube: Search Results Sharing ──
  socket.on("youtube-search-results", ({ query, results }) => {
    if (!currentRoom) return;
    socket
      .to(currentRoom)
      .emit("youtube-search-results", {
        query,
        results,
        searchedBy: currentNick,
      });
  });

  // ── Web Search Sharing ──
  socket.on("web-search", ({ query }) => {
    if (!currentRoom) return;
    socket
      .to(currentRoom)
      .emit("web-search", { query, searchedBy: currentNick });
  });

  // ── Browse URL Sharing ──
  socket.on("browse-url", ({ url }) => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (room) {
      room.browseUrl = url;
      socket.to(currentRoom).emit("browse-url", { url, sharedBy: currentNick });
    }
  });

  // ── Chat Message ──
  socket.on("chat-message", ({ text }) => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (room) {
      const msg = {
        nick: currentNick,
        text,
        time: new Date().toLocaleTimeString(),
      };
      room.chatHistory.push(msg);
      // Keep only last 100 messages
      if (room.chatHistory.length > 100) room.chatHistory.shift();
      io.to(currentRoom).emit("chat-message", msg);
    }
  });

  // ── Disconnect ──
  socket.on("disconnect", () => {
    if (currentRoom && rooms.has(currentRoom)) {
      const room = rooms.get(currentRoom);
      room.users.delete(socket.id);

      const leaveMsg = {
        nick: "🤖 System",
        text: `${currentNick} left the room`,
        time: new Date().toLocaleTimeString(),
      };
      room.chatHistory.push(leaveMsg);
      io.to(currentRoom).emit("chat-message", leaveMsg);

      const userList = Array.from(room.users.values());
      io.to(currentRoom).emit("user-list", userList);

      // Clean up empty rooms after 5 minutes
      if (room.users.size === 0) {
        setTimeout(
          () => {
            if (
              rooms.has(currentRoom) &&
              rooms.get(currentRoom).users.size === 0
            ) {
              rooms.delete(currentRoom);
              console.log(`🗑️ Room ${currentRoom} deleted (empty)`);
            }
          },
          5 * 60 * 1000,
        );
      }

      console.log(`👤 ${currentNick} left room ${currentRoom}`);
    }
  });
});

// ─── Start Server ───────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`\n🚀 SyncWatch server running at http://localhost:${PORT}\n`);
});
