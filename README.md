# 🎬 SyncWatch — Watch Together, Browse Together

Real-time collaborative app to **watch YouTube**, **search the web**, and **browse URLs** together with friends.

## ✨ Features

- 🎥 **Synced YouTube Player** — play, pause, seek synced in real-time
- 🔍 **YouTube Search** — search results shared with everyone in the room
- 🌐 **Web Search** — shared DuckDuckGo search
- 🔗 **Shared Browsing** — enter a URL and everyone sees it
- 💬 **Live Chat** — text chat with all room members
- 👥 **Multi-user rooms** — unlimited users per room
- 🔑 **No login needed** — just a nickname + room code

## 🚀 Quick Start (Local)

### Prerequisites

- [Node.js](https://nodejs.org/) v16+ installed

### Steps

```bash
# 1. Navigate to the SyncWatch folder
cd SyncWatch

# 2. Install dependencies
npm install

# 3. Start the server
npm start
```

4. Open **http://localhost:3000** in your browser
5. Create a room, share the **room code** with your friend
6. Your friend opens the same URL and joins with the room code

## 🌍 Deploy Online (so your friend can access remotely)

### Option A: Render (Free)

1. Push your code to a **GitHub** repository
2. Go to [render.com](https://render.com) → New → **Web Service**
3. Connect your GitHub repo
4. Settings:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
5. Deploy! You'll get a public URL like `https://syncwatch-xxxx.onrender.com`

### Option B: Railway (Free)

1. Go to [railway.app](https://railway.app) → New Project → **Deploy from GitHub**
2. Select your repository
3. Railway auto-detects Node.js — just deploy
4. You'll get a public URL to share

### Option C: Ngrok (Quick temporary tunnel)

```bash
# After starting the server locally:
npx ngrok http 3000
```

Share the ngrok URL with your friend.

## 📁 File Structure

```
SyncWatch/
├── package.json          # Dependencies & scripts
├── server.js             # Express + Socket.IO backend
├── .gitignore
├── README.md
└── public/
    ├── index.html        # Landing page (create/join room)
    ├── room.html         # Main room (player + search + chat)
    ├── css/
    │   ├── style.css     # Landing page styles
    │   └── room.css      # Room page styles
    └── js/
        ├── app.js        # Landing page logic
        └── room.js       # Room real-time logic
```

## 🛠 Tech Stack

- **Backend**: Node.js, Express, Socket.IO
- **Frontend**: Vanilla HTML/CSS/JS
- **YouTube**: YouTube IFrame Player API
- **Web Search**: DuckDuckGo (iframe)
- **Real-time**: WebSockets via Socket.IO
