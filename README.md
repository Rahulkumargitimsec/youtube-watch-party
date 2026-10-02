# 🎬 WatchParty — Watch YouTube Together, in Sync

A real-time **YouTube Watch Party** where everyone in a room sees the same video at the same moment. When the host plays, pauses, seeks or changes the video, every participant follows instantly — over **WebSockets**.

**Live demo:** `https://<your-app>.onrender.com` ← _replace after deploying (see [Deployment](#-deployment))_

| Layer     | Technology                                                    |
| --------- | ------------------------------------------------------------- |
| Frontend  | **React 18** + Vite + React Router                            |
| Backend   | **Node.js** + **Express 5**                                   |
| Real-time | **WebSockets** via **Socket.IO 4**                            |
| Database  | **MongoDB** (Mongoose) — users, rooms, members, roles, chat   |
| Auth      | Email + password, **scrypt** hashing, **JWT** (jsonwebtoken)  |
| Video     | **YouTube IFrame Player API**                                 |
| Hosting   | Render (single service: API + WebSocket + React build)        |

---

## ✨ Features

### Core requirements

- **Rooms** — create a room with a (required) room name (you become **Host**) or join via **room code / invite link** (you become **Participant**).
- **Real-time sync** — play, pause, seek and change-video are synchronized for everyone. Late joiners start at the exact current position.
- **YouTube integration** — paste any YouTube link (`watch?v=`, `youtu.be`, `shorts`, `embed`, `live`) or an 11-char id.
- **Role-based access control**, enforced **on the server** for every event:

  | Role            | Play / Pause / Seek | Change video | Approve requests | Assign roles / Remove / Transfer host | Request changes | Chat & react |
  | --------------- | :-----------------: | :----------: | :--------------: | :-----------------------------------: | :-------------: | :----------: |
  | 👑 **Host**      | ✅                   | ✅            | ✅                | ✅                                     | —               | ✅            |
  | 🛡️ **Moderator** | ✅                   | ✅            | ✅                | ❌                                     | —               | ✅            |
  | **Participant** | ❌                   | ❌            | ❌                | ❌                                     | ✅               | ✅            |
  | 👁️ **Viewer**    | ❌                   | ❌            | ❌                | ❌                                     | ❌               | ✅            |

- **Host powers** — assign roles (Participant ⇄ Moderator ⇄ Viewer), remove participants, transfer host.
- **Approval flow** — a Participant's play/pause/seek/change-video becomes a **request**; it only takes effect when a Host or Moderator approves it.
- **Participant list** with roles and live online/reconnecting status.

### Bonus features implemented

- ✅ **Authentication (login before joining)** — **Log in / Sign up** (name, email, password) in the top-right corner. **Only logged-in users can create or join rooms** — enforced on the server for both `POST /api/rooms` and the `join_room` WebSocket event. Opening an invite link while logged out asks you to log in, then joins the room automatically. Your account name is used in rooms, you get a ✓ badge, and your **seat & role follow you to any device** (a host can reopen their room from another laptop and is still host).
- ✅ **OOP WebSocket server** — `Room`, `Participant`, `PlaybackState`, `RoomManager`, `MessageHandler` classes
- ✅ **Persistent rooms** in MongoDB (state, members & roles, chat) — survive server restarts, auto-expire after 7 days idle (TTL index)
- ✅ **Text chat** with history
- ✅ **Emoji reactions** floating over the video for everyone
- ✅ **Transfer host** + **automatic host hand-over** if the host leaves
- ✅ **Reconnect-safe identity** — refresh the page and you keep your seat and role (secret session token, hashed in DB)
- ✅ **Clock-offset + drift correction** for tight sync
- ✅ Rate limiting, input validation, automated tests (unit + real-WebSocket integration)

### Experience & sync polish

- 🎯 **Live sync meter** — every player shows how far (ms) it is from the room's position, plus server round-trip latency in the header.
- ⚡ **Tighter sync** — players re-sync once playback actually starts after buffering (late joiners land within ~150 ms instead of ~1 s), and paused players snap to the exact frame.
- 🔗 **Easy invites** — one-click copy of the room code or invite link.
- 🎬 **Theater mode**, YouTube-style **ambient glow**, double-click for fullscreen.
- 🖼️ **Video previews** — thumbnails while pasting links, on change-video requests, and in "Now playing".
- 🕘 **Jump back in** — recently visited rooms on the home page.
- 📱 Fully responsive, `prefers-reduced-motion` aware.

---

## 🏗️ Architecture

```mermaid
flowchart LR
  subgraph Browser["Browser (React)"]
    UI[Room UI<br/>controls · people · chat]
    YT[YouTube IFrame Player]
    Hook[useWatchRoom hook<br/>Socket.IO client]
    UI --> Hook
    Hook -- sync_state --> YT
  end

  subgraph Server["Node.js server"]
    REST[Express REST<br/>POST /api/rooms<br/>GET /api/rooms/:id]
    WS[Socket.IO server]
    MH[MessageHandler<br/>ack · rate-limit · context]
    RM[RoomManager<br/>load · cache · save]
    R[Room<br/>RBAC · state · broadcast]
    WS --> MH --> R
    RM --> R
  end

  DB[(MongoDB)]

  UI -- create / check room --> REST
  Hook <-- WebSocket events --> WS
  RM <-- debounced save / lazy load --> DB
```

### How WebSockets drive the flow

0. **Login (optional)** — `POST /api/auth/login` returns a **JWT**. The client sends it as `Authorization: Bearer …` on REST calls and in the Socket.IO handshake (`auth: { token }`), where an `io.use()` middleware verifies it.
1. **Create** — `POST /api/rooms` creates the room in MongoDB and returns a secret **session token** that identifies the creator as Host (and links the room to their account if logged in).
2. **Join** — the client opens a WebSocket and sends `join_room { roomId, username, token }`. The server returns the full room state in the acknowledgement and broadcasts `user_joined` to the room.
3. **Control** — a Host/Moderator emits `play` / `pause` / `seek` / `change_video`. The server **checks the role**, updates the authoritative `PlaybackState`, and broadcasts `sync_state` to everyone (including the sender).
4. **Apply** — every client (including the one who clicked) applies `sync_state` to its YouTube player. There is exactly **one source of truth: the server**.
5. **Requests** — a Participant emits `request_change`; hosts/moderators receive `requests_update`; `resolve_request` approves (→ `sync_state`) or declines, and the requester gets `request_resolved`.

### How sync stays accurate

- The server stores `{ videoId, isPlaying, position, updatedAt }` rather than a ticking clock. The live position is `position + (now − updatedAt)` while playing.
- Each `sync_state` carries `serverTime`. Clients measure their **clock offset** to the server (NTP-style `time_sync` ping, best of 4) and compute where the video *should* be right now: `currentTime + (clientNow + offset − serverTime)`.
- The player corrects if it's more than **0.4 s** off after an event, and a background **drift check every second** re-syncs anyone more than **1.2 s** off (buffering, slow devices).
- The YouTube iframe has `controls: 0` and a transparent shield, so nobody can change playback locally — every change goes through the server.

### WebSocket events

| Event                                     | Direction       | Payload                                               | Who                     |
| ----------------------------------------- | --------------- | ----------------------------------------------------- | ----------------------- |
| `join_room`                               | Client → Server | `{ roomId, username, token? }` → ack `{ token, state }` | anyone                  |
| `leave_room`                              | Client → Server | `{}`                                                  | anyone                  |
| `play` / `pause`                          | Client → Server | `{}`                                                  | Host, Moderator         |
| `seek`                                    | Client → Server | `{ time }`                                            | Host, Moderator         |
| `change_video`                            | Client → Server | `{ url \| videoId }`                                  | Host, Moderator         |
| `request_change`                          | Client → Server | `{ type, payload }`                                   | Participant             |
| `resolve_request`                         | Client → Server | `{ requestId, approve }`                              | Host, Moderator         |
| `cancel_request`                          | Client → Server | `{ requestId }`                                       | request owner           |
| `assign_role`                             | Client → Server | `{ userId, role }`                                    | Host                    |
| `remove_participant`                      | Client → Server | `{ userId }`                                          | Host                    |
| `transfer_host`                           | Client → Server | `{ userId }`                                          | Host                    |
| `chat_message` / `reaction`               | Client → Server | `{ text }` / `{ emoji }`                              | everyone                |
| `time_sync`                               | Client → Server | → ack `{ serverTime }`                                | anyone                  |
| `sync_state`                              | Server → Room   | `{ videoId, playState, currentTime, serverTime, action }` |                     |
| `user_joined` / `user_left`               | Server → Room   | `{ userId, username, role?, participants }`           |                         |
| `role_assigned`                           | Server → Room   | `{ userId, username, role, assignedBy, participants }` |                        |
| `participant_removed`                     | Server → Room   | `{ userId, username, removedBy, participants }`       |                         |
| `host_transferred`                        | Server → Room   | `{ from, to, reason, participants }`                  |                         |
| `participants_update`                     | Server → Room   | `{ participants }` (online/offline changes)           |                         |
| `requests_update`                         | Server → User   | `{ requests }` (all for hosts/mods, own for others)   |                         |
| `request_resolved`                        | Server → User   | `{ requestId, type, approved, resolvedBy }`           |                         |
| `removed_from_room`                       | Server → User   | `{ by }`                                              |                         |
| `chat_message` / `reaction`               | Server → Room   | message / reaction                                    |                         |

### REST endpoints

| Method & path            | Purpose                                            |
| ------------------------ | -------------------------------------------------- |
| `POST /api/auth/signup`  | `{ name, email, password }` → `{ token, user }`    |
| `POST /api/auth/login`   | `{ email, password }` → `{ token, user }`          |
| `GET /api/auth/me`       | Validate a JWT → `{ user }`                        |
| `POST /api/rooms`        | **Login required.** `{ roomName, videoUrl? }` → `{ roomId, token }` (room name required) |
| `GET /api/rooms/:roomId` | Room summary (used by the join form / invite link) |
| `GET /api/health`        | Health check (storage type, live rooms)            |

Every client → server event uses a Socket.IO **acknowledgement**: the server always replies `{ ok: true, ... }` or `{ ok: false, error: { code, message } }` (e.g. `FORBIDDEN` when a Participant tries to `play`).

More detail: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## 📁 Project structure

```
.
├── client/                     # React + Vite frontend
│   └── src/
│       ├── pages/              # Home (create/join), Room
│       ├── components/         # YouTubePlayer, PlaybackControls, ParticipantList,
│       │                       # RequestsPanel, Chat, Reactions, VideoForm, Toasts
│       ├── hooks/useWatchRoom.js   # all Socket.IO logic → React state
│       └── lib/                # socket, api, youtube helpers, storage
├── server/                     # Node.js + Express + Socket.IO backend
│   ├── src/
│   │   ├── core/               # Room, Participant, PlaybackState, RoomManager, permissions
│   │   ├── socket/MessageHandler.js
│   │   ├── db/                 # Mongoose model + repositories (Mongo / in-memory)
│   │   ├── routes/api.js       # REST endpoints
│   │   ├── app.js              # wires Express + Socket.IO
│   │   └── index.js            # entry point
│   └── test/                   # node:test unit + WebSocket integration tests
├── docs/                       # architecture + code-walkthrough notes
└── render.yaml                 # one-click Render deployment
```

---

## 🚀 Run locally

**Prerequisites:** Node.js ≥ 20 and MongoDB (local install, Docker, or a free MongoDB Atlas cluster).

```bash
# 1. Install dependencies (root, server and client)
npm install
npm run install:all

# 2. Configure the server
cp server/.env.example server/.env      # edit MONGODB_URI if needed

# 3. Start backend (http://localhost:4000) + frontend (http://localhost:5173) with hot reload
npm run dev
```

Open **http://localhost:5173**, create a room, and open the invite link in another browser (or an incognito window) to join as a second user.

> No MongoDB handy? Start one with `docker run -d -p 27017:27017 mongo:7`, or leave `MONGODB_URI` empty to run with in-memory storage.

**Production mode locally** (exactly what the server runs in the cloud):

```bash
npm run build     # installs everything and builds the React app into client/dist
npm start         # Express serves the API, the WebSocket server and the React build on :4000
```

**Tests** (unit tests for roles/permissions/sync + an end-to-end test over real WebSockets):

```bash
npm test
```

### Environment variables (`server/.env`)

| Variable             | Default                | Purpose                                                               |
| -------------------- | ---------------------- | --------------------------------------------------------------------- |
| `PORT`               | `4000`                 | HTTP + WebSocket port (set automatically by Render/Railway)            |
| `MONGODB_URI`        | _(empty → in-memory)_  | MongoDB connection string                                             |
| `JWT_SECRET`         | _(random in dev)_      | Secret for signing login tokens — **required in production**          |
| `CLIENT_ORIGIN`      | _(empty)_              | Only if the frontend is on another domain (enables CORS for it)       |
| `RECONNECT_GRACE_MS` | `15000`                | How long a disconnected user keeps their seat/role                    |
| `VITE_SERVER_URL`    | _(empty)_              | **Client** build var — backend URL if frontend is hosted separately   |

---

## ☁️ Deployment

The app deploys as **one Render web service**: Express serves the REST API, the Socket.IO WebSocket server and the built React app from the same URL (no CORS, WebSockets work out of the box).

1. **MongoDB Atlas** (free): create an M0 cluster → *Database Access*: add a user → *Network Access*: allow `0.0.0.0/0` → *Connect → Drivers*: copy the URI, e.g.
   `mongodb+srv://user:pass@cluster0.xxxxx.mongodb.net/watch-party?retryWrites=true&w=majority`
2. **Push this repo to GitHub.**
3. **Render** → *New* → *Blueprint* → pick the repo (it reads [`render.yaml`](render.yaml)).
   Or *New → Web Service* manually with:
   - Build command: `npm run build`
   - Start command: `npm start`
   - Environment: `NODE_ENV=production`, `MONGODB_URI=<your Atlas URI>`, `JWT_SECRET=<long random string>` (the Blueprint generates this one for you)
4. Open `https://<your-app>.onrender.com/api/health` → should return `"storage": "mongodb"`.
5. Put the live URL at the top of this README.

> **Free-tier note:** Render's free instances sleep after ~15 min of inactivity; the first request takes ~30–50 s to wake up. Rooms are stored in MongoDB, so nothing is lost.

**Railway** works the same way (build `npm run build`, start `npm start`, add `MONGODB_URI`).
**Split hosting** (Vercel/Netlify frontend + Render backend): build the client with `VITE_SERVER_URL=https://<backend>` and set `CLIENT_ORIGIN=https://<frontend>` on the backend.

---

## ⚖️ Design decisions & trade-offs

- **Server is the single source of truth.** Clients never trust each other's players; they only apply `sync_state`. This makes role enforcement trivial and prevents "echo loops" where two players keep correcting each other.
- **Custom controls instead of YouTube's.** The native YouTube UI can't be permission-checked, so it's hidden and blocked; our control bar routes through the server (or becomes a *request* for Participants).
- **Autoplay policy.** Browsers block autoplay with sound until the user interacts, so each viewer clicks once ("Click to join playback"), then stays in sync automatically.
- **Login required.** Every room member is a registered account (JWT verified on REST and in the WebSocket handshake), so a removed user can't simply rejoin under a new name. Inside a room, a per-room session token (only its SHA-256 hash is stored) additionally restores the exact seat after a refresh. Passwords are hashed with **scrypt** (built into Node, salted, constant-time comparison); the JWT is stored in `localStorage` for simplicity — an httpOnly cookie would be more XSS-resistant.
- **Debounced persistence.** State changes are saved to MongoDB at most every ~0.75 s per room, so a burst of seeks costs one write. Pending approval requests are intentionally in-memory only.
- **Reconnect grace period.** A refresh or network blip doesn't kick you out or trigger a host hand-over; you're shown as *reconnecting* for 15 s.
- **Scaling beyond one instance.** Live room state is in memory on the instance that holds the room. To run many instances you'd add the Socket.IO **Redis adapter** for cross-instance broadcasts **plus** room-affinity (route all members of a room to the same instance, e.g. consistent hashing on `roomId`) or move `PlaybackState` into Redis. A single Node instance comfortably handles hundreds of concurrent sockets for this workload.
