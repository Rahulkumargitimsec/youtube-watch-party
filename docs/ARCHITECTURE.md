# Architecture & Code Walkthrough

This document explains **what each part of the code does and why**. It's written to help you walk an interviewer through the project.

---

## 1. Request lifecycle, end to end

### Creating a room

```
Home.jsx ──POST /api/rooms {username, roomName, videoUrl}──▶ routes/api.js
                                                              │
                                   RoomManager.createRoom() ◀─┘
                                   ├─ generate unique 6-char code (no 0/O/1/I)
                                   ├─ new Room(...) + room.createHost(username)
                                   │     └─ random token → store SHA-256(token) in member
                                   └─ repository.save(room.toDocument())  → MongoDB
◀── 201 { roomId, token, userId } ──
Home.jsx stores token in localStorage (wp:token:<roomId>) and navigates to /room/<roomId>
```

### Joining & syncing

```
useWatchRoom (client)                         MessageHandler / Room (server)
─────────────────────                         ──────────────────────────────
socket.connect()
'connect' → time_sync ×4  ───────────────▶    ack { serverTime }         (clock offset)
join_room {roomId, username, token} ─────▶    RoomManager.getRoom()  (memory or MongoDB)
                                              Room.join()
                                                ├─ token matches a member? → same user & role
                                                └─ otherwise → new Participant
                                              socket.join('room:<id>', 'room:<id>:user:<uid>')
                              ◀── ack ─────── { token, state: participants, playback, chat, ... }
                              ◀── broadcast ─ user_joined { participants }
```

### A playback action

```
Host clicks ❚❚   → emit('pause')
                 → MessageHandler.on('pause') → rate-limit → resolve {room, userId}
                 → room.pause(userId)
                      ├─ requireMember(userId)            (is this socket really in the room?)
                      ├─ authorize(actor, CONTROL_PLAYBACK) (RBAC — throws FORBIDDEN)
                      ├─ playback.pause(now)               (freeze position)
                      ├─ broadcast('sync_state', snapshot + action)
                      └─ onChange() → RoomManager.scheduleSave() (debounced MongoDB write)
                 ← ack { ok: true }
Every client     ← sync_state → setPlayback() → YouTubePlayer.syncToRoom()
```

---

### Signing up / logging in

```
AuthModal.jsx ──POST /api/auth/signup {name, email, password}──▶ AuthService.signup()
                                                                  ├─ validate name / email / password (≥ 6 chars)
                                                                  ├─ reject duplicate email (409, plus a unique index)
                                                                  ├─ scrypt(password, random salt) → "scrypt:<salt>:<hash>"
                                                                  └─ users.create() → MongoDB
◀── { token: JWT(sub = accountId, 7 days), user: { id, name, email } } ──
AuthProvider stores it; api.js adds `Authorization: Bearer <jwt>`; createSocket() adds `auth: { token }`.
```

On the server, `optionalAuth` (REST) and an `io.use()` middleware (WebSockets) verify the JWT and attach the account (`req.user`, `socket.data.account`).

**Login is required to create or join a room:** `POST /api/rooms` returns `401 UNAUTHORIZED` without `req.user`, and `join_room` rejects sockets without `socket.data.account`. The room name shown to others is always the account name (the client can't choose a fake one). On the frontend, `/room/:id` redirects logged-out visitors to `/?join=<id>`, which opens the login dialog and joins the room right after login.

**Identity in a room:** `Room.findReturningMember(token, accountId)` first looks for the per-room session token (same browser), then for a member with the same `accountId` (another device). A logged-in host therefore keeps the Host role everywhere, and a removed account can't rejoin from a different browser.

---

## 2. Backend classes (OOP)

| Class / module                         | Responsibility |
| -------------------------------------- | -------------- |
| `auth/AuthService.js`                  | Sign up / log in / verify JWT. scrypt password hashing with per-user salt and `timingSafeEqual`. |
| `routes/auth.js`                       | `POST /api/auth/signup`, `POST /api/auth/login`, `GET /api/auth/me`, plus the `optionalAuth` middleware. |
| `core/permissions.js`                  | Role constants and the **permission matrix** (`can(role, action)`). Single place to change who can do what. |
| `core/PlaybackState.js`                | `{ videoId, isPlaying, position, updatedAt }`. `currentTime(now)` extrapolates while playing — no timers needed. |
| `core/Participant.js`                  | One member: public `userId`, secret `tokenHash`, `role`, the set of connected sockets (multi-tab), reconnect timer. |
| `core/Room.js`                         | **Domain logic**: join/leave, host hand-over, RBAC checks, playback, approval requests, chat, reactions, broadcasting. |
| `core/RoomManager.js`                  | Registry of live rooms: lazy-load from DB, debounced saves, unload idle rooms, graceful shutdown flush. |
| `socket/MessageHandler.js`             | Maps Socket.IO events → Room methods. Adds acks, rate limiting, error translation and context lookup. |
| `db/RoomModel.js`                      | Mongoose schema (unique `roomId`, TTL index on `lastActiveAt`). |
| `db/repositories.js`                   | **Repository pattern**: `MongoRoomRepository` and `MemoryRoomRepository` share `findById / exists / save`. |
| `routes/api.js`                        | REST: create room, room summary, health check. |
| `app.js` / `index.js`                  | Wiring (Express + HTTP server + Socket.IO) and process lifecycle. |

Why separate `Room` from `MessageHandler`? The `Room` has no idea Socket.IO events exist — it exposes plain methods (`room.seek(userId, time)`) that throw `RoomError`s. That makes it easy to unit-test without sockets and keeps permission checks in one place no matter how the method is called.

---

## 3. Role-based access control

- Roles: `host`, `moderator`, `participant`, `viewer`.
- `permissions.js` maps each role to a `Set` of actions. `Room.authorize(actor, action)` throws `FORBIDDEN` if not allowed.
- **Every** mutating method calls `requireMember` + `authorize` **before** changing state. The frontend only *mirrors* the matrix (sent in the join ack as `rolePermissions`) to hide/disable buttons — it is never trusted.
- Host-only guards: can't change your own role, can't assign `host` via `assign_role` (use `transfer_host`), can't remove yourself.
- `role_assigned` / `host_transferred` / `participant_removed` are broadcast with the full `participants` list so every UI updates immediately.
- When a role changes, `emitRequests()` re-sends the pending-request lists, because visibility depends on role (a newly promoted moderator suddenly sees all requests).

### Approval requests (Participant → Host/Moderator)

1. Participant emits `request_change { type: 'seek', payload: { time: 90 } }`.
2. `Room.createRequest` validates the payload **now** (bad links are rejected immediately), de-duplicates (a newer request of the same type replaces the old one), caps pending requests at 3 per user.
3. `emitRequests()` sends each user a personalised `requests_update` (hosts/mods: all; others: their own).
4. Host/Moderator emits `resolve_request { requestId, approve }`. If approved, the same `applyAction` path as a direct command runs, with `requestedBy` attached so the activity feed reads "Host jumped to 1:30 (requested by Rahul)".
5. Requester gets `request_resolved` → a toast.

---

## 4. Synchronization algorithm (client)

`client/src/components/YouTubePlayer.jsx → syncToRoom(threshold)`

1. **Expected time:** `expectedTime(playback, clockOffset)` = `currentTime + (Date.now() + offset − serverTime)/1000` when playing.
2. **New video?** `loadVideoById` (playing) or `cueVideoById` (paused) with `startSeconds = expected`.
3. **Paused room:** pause the player if needed; if more than `threshold` off, `seekTo` (or re-cue for a not-yet-started video, since `seekTo` on a cued video would start it).
4. **Playing room:** `seekTo` if drift > threshold; `playVideo` if not playing/buffering.
5. Thresholds: **0.4 s** immediately after a server event, **1.2 s** on the 1-second background check. The larger periodic threshold avoids constant micro-seeks (which cause stutter) while still catching real drift.

**Clock offset:** `measureClockOffset` sends 4 `time_sync` pings and keeps the one with the smallest round-trip: `offset = serverTime − (t0 + t1) / 2`. Without this, a client whose system clock is 3 s off would be 3 s out of sync.

**Why a transparent shield + `controls: 0`?** If users could click the YouTube player, their local player would diverge from the room. All interaction goes through our control bar → server → `sync_state`.

**Autoplay:** browsers block audio autoplay without a user gesture, so the "Click to join playback" overlay collects one click, then everything is automatic.

---

## 5. Presence, reconnects and host hand-over

- A user can have multiple sockets (tabs). They're **online** while any is connected.
- When the last socket disconnects, a **15 s grace timer** starts (`RECONNECT_GRACE_MS`). If they come back with their token in time, nothing is broadcast except a presence update. Otherwise `user_left` is broadcast.
- If the **host** leaves (explicitly, or grace expires), `ensureHost()` promotes the longest-standing **moderator**, else the longest-standing participant. The old host becomes a moderator if they return.
- After a **server restart**, rooms are re-loaded from MongoDB with playback paused at the last known position; the original host gets a grace window to reconnect before anyone else is promoted.

---

## 6. Security & robustness

- Server-side validation of every input (`utils/validate.js`, `utils/youtube.js`): usernames 1–24 chars, room codes, finite seek times, chat ≤ 500 chars, emoji whitelist, YouTube id regex.
- **Session tokens:** 24 random bytes; only the SHA-256 hash is stored. Public `userId`s are useless for impersonation.
- **Rate limiting** per socket (general, chat, reactions, joins) and per IP for room creation.
- `maxHttpBufferSize` 100 KB and `express.json({ limit: '10kb' })`.
- Removed users are flagged `removed` — their token can't rejoin; their sockets are forcibly detached from the room channels.
- Graceful shutdown (`SIGTERM` from Railway on every redeploy) flushes all rooms to MongoDB before exit.

---

## 7. Likely interview questions (short answers)

**Why Socket.IO instead of raw `ws`?** Rooms/broadcast (`io.to(room).emit`), automatic reconnection, acknowledgements (request/response over a socket), and a long-polling fallback for networks that block WebSockets. It still uses a real WebSocket transport (we request `transports: ['websocket', 'polling']`).

**Why WebSockets and not HTTP polling?** Full-duplex, persistent connection: the server can *push* `sync_state` the instant the host clicks, with ~one network hop of latency and no polling overhead.

**How do you stop a participant from pausing the video by calling the socket directly?** `Room.pause()` calls `authorize(actor, CONTROL_PLAYBACK)`. The role comes from the server's own record for that socket's `userId` — not from anything the client sends.

**What happens if two moderators seek at the same time?** Node processes events one at a time; the last event processed wins and is broadcast to everyone, so all clients converge on the same state.

**How would you scale to 1,000+ users / many servers?** Socket.IO Redis adapter for cross-instance broadcast + sticky sessions at the load balancer + room affinity (or shared `PlaybackState` in Redis). MongoDB already holds durable state; the in-memory `RoomManager` is the per-instance cache.

**How does login work? Why JWT?** The server signs `{ sub: accountId }` with `JWT_SECRET`; any request or socket handshake carrying that token can be verified without a session table. Passwords are never stored — only a salted scrypt hash — and login errors don't reveal whether an email exists.

**Why MongoDB?** A room is naturally one document (state + members + recent chat), read/written as a unit — no joins needed. TTL indexes auto-clean abandoned rooms.

**What was tricky?**
- The YouTube player's behaviour in the *cued* state (`seekTo` starts playback; `getCurrentTime` is unreliable) → track the cue position and re-cue instead of seeking.
- Browser autoplay policy → one-click "join playback" overlay.
- Refresh ≠ leave → token-based identity + grace period, otherwise every refresh would trigger a host hand-over.
