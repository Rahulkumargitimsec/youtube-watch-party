import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { io as connect } from 'socket.io-client';
import { createServer } from '../src/app.js';
import { MemoryRoomRepository, MemoryUserRepository } from '../src/db/repositories.js';

/**
 * End-to-end test over real WebSockets: sign up, REST room creation, join, role
 * enforcement, sync broadcast and the participant approval flow.
 */
describe('WebSocket flow', () => {
  let server;
  let baseUrl;
  const sockets = [];

  before(async () => {
    server = createServer({
      repositories: { rooms: new MemoryRoomRepository(), users: new MemoryUserRepository() },
      jwtSecret: 'test-secret',
      graceMs: 200,
    });
    await new Promise((resolve) => server.httpServer.listen(0, resolve));
    baseUrl = `http://localhost:${server.httpServer.address().port}`;
  });

  after(async () => {
    for (const s of sockets) s.disconnect();
    server.io.close();
    await server.manager.shutdown();
    await new Promise((resolve) => server.httpServer.close(resolve));
  });

  const client = async (jwt) => {
    const socket = connect(baseUrl, { transports: ['websocket'], forceNew: true, auth: jwt ? { token: jwt } : {} });
    sockets.push(socket);
    await new Promise((resolve) => socket.on('connect', resolve));
    return socket;
  };
  const send = (socket, event, payload = {}) => socket.timeout(2000).emitWithAck(event, payload);
  const next = (socket, event) => new Promise((resolve) => socket.once(event, resolve));
  const post = (path, body, jwt) =>
    fetch(`${baseUrl}/api${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(jwt ? { authorization: `Bearer ${jwt}` } : {}) },
      body: JSON.stringify(body),
    });

  let accounts = 0;
  /** Creates a fresh account and returns its JWT. */
  const signup = async (name) => {
    accounts += 1;
    const res = await post('/auth/signup', { name, email: `user${accounts}@example.com`, password: 'secret12' });
    assert.equal(res.status, 201);
    return (await res.json()).token;
  };

  it('creates a room over REST, then syncs playback over WebSockets with roles enforced', async () => {
    const hostJwt = await signup('Hosty');
    const guestJwt = await signup('Guest');

    const res = await post('/rooms', { roomName: 'Movie night' }, hostJwt);
    assert.equal(res.status, 201);
    const { roomId, token } = await res.json();

    const summary = await (await fetch(`${baseUrl}/api/rooms/${roomId.toLowerCase()}`)).json();
    assert.equal(summary.name, 'Movie night');

    const hostSocket = await client(hostJwt);
    const hostJoin = await send(hostSocket, 'join_room', { roomId, token });
    assert.equal(hostJoin.ok, true);
    assert.equal(hostJoin.state.self.role, 'host');

    const guestSocket = await client(guestJwt);
    const joinedEvent = next(hostSocket, 'user_joined');
    const guestJoin = await send(guestSocket, 'join_room', { roomId });
    assert.equal(guestJoin.state.self.role, 'participant');
    const joined = await joinedEvent;
    assert.equal(joined.username, 'Guest');
    assert.equal(joined.participants.length, 2);

    // Participant cannot play directly
    const denied = await send(guestSocket, 'play');
    assert.equal(denied.ok, false);
    assert.equal(denied.error.code, 'FORBIDDEN');

    // Host plays → everyone receives sync_state
    const guestSync = next(guestSocket, 'sync_state');
    assert.equal((await send(hostSocket, 'play')).ok, true);
    const sync = await guestSync;
    assert.equal(sync.playState, 'playing');
    assert.equal(sync.action.type, 'play');

    // Participant requests a seek → host sees it → approves → everyone syncs to it
    const hostRequests = next(hostSocket, 'requests_update');
    const requested = await send(guestSocket, 'request_change', { type: 'seek', payload: { time: 120 } });
    assert.equal(requested.ok, true);
    const { requests } = await hostRequests;
    assert.equal(requests[0].type, 'seek');

    const guestResolved = next(guestSocket, 'request_resolved');
    const guestSeek = next(guestSocket, 'sync_state');
    await send(hostSocket, 'resolve_request', { requestId: requests[0].id, approve: true });
    assert.equal((await guestResolved).approved, true);
    const seekSync = await guestSeek;
    assert.ok(seekSync.currentTime >= 120 && seekSync.currentTime < 121);

    // Host promotes the guest; the guest can now change the video directly
    const roleEvent = next(guestSocket, 'role_assigned');
    await send(hostSocket, 'assign_role', { userId: guestJoin.state.self.userId, role: 'moderator' });
    assert.equal((await roleEvent).role, 'moderator');
    const videoSync = next(hostSocket, 'sync_state');
    assert.equal((await send(guestSocket, 'change_video', { videoId: 'https://youtu.be/dQw4w9WgXcQ' })).ok, true);
    assert.equal((await videoSync).videoId, 'dQw4w9WgXcQ');

    // Host removes the guest
    const removed = next(guestSocket, 'removed_from_room');
    const removedBroadcast = next(hostSocket, 'participant_removed');
    await send(hostSocket, 'remove_participant', { userId: guestJoin.state.self.userId });
    await removed;
    assert.equal((await removedBroadcast).participants.length, 1);
    assert.equal((await send(guestSocket, 'pause')).error.code, 'NOT_IN_ROOM');

    // A removed account cannot come back, even from a new device (no session token).
    const otherDevice = await client(guestJwt);
    assert.equal((await send(otherDevice, 'join_room', { roomId })).error.code, 'REMOVED');
  });

  it('does not let guests (not logged in) create or join rooms', async () => {
    const created = await post('/rooms', { roomName: 'Guest room' });
    assert.equal(created.status, 401);
    assert.equal((await created.json()).error.code, 'UNAUTHORIZED');

    const { roomId } = await (await post('/rooms', { roomName: 'Members only' }, await signup('Owner'))).json();
    const guest = await client();
    const joined = await send(guest, 'join_room', { roomId, username: 'Sneaky' });
    assert.equal(joined.ok, false);
    assert.equal(joined.error.code, 'UNAUTHORIZED');

    const forged = await client('not-a-real-jwt');
    assert.equal((await send(forged, 'join_room', { roomId })).error.code, 'UNAUTHORIZED');
  });

  it('requires a room name', async () => {
    const res = await post('/rooms', {}, await signup('NoName'));
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error.code, 'INVALID_ROOM_NAME');
  });

  it('signs up, logs in, and rejects bad credentials', async () => {
    const res = await post('/auth/signup', { name: 'Priya', email: 'Priya@Example.com', password: 'secret12' });
    assert.equal(res.status, 201);
    const { token, user } = await res.json();
    assert.equal(user.email, 'priya@example.com');
    assert.ok(!('passwordHash' in user));

    assert.equal((await post('/auth/signup', { name: 'P2', email: 'priya@example.com', password: 'secret12' })).status, 409);
    assert.equal((await post('/auth/signup', { name: 'P3', email: 'x@y.co', password: '123' })).status, 400);
    assert.equal((await post('/auth/login', { email: 'priya@example.com', password: 'wrong-pass' })).status, 401);

    const login = await post('/auth/login', { email: 'PRIYA@example.com', password: 'secret12' });
    assert.equal(login.status, 200);

    const me = await fetch(`${baseUrl}/api/auth/me`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal((await me.json()).user.name, 'Priya');
    assert.equal((await fetch(`${baseUrl}/api/auth/me`, { headers: { authorization: 'Bearer nope' } })).status, 401);
  });

  it('lets a host keep their role on another device through their account', async () => {
    const jwt = await signup('Arjun');
    const { roomId } = await (await post('/rooms', { roomName: 'Account room' }, jwt)).json();

    // "Another device": no room session token, only the account JWT in the handshake.
    const socket = await client(jwt);
    const res = await send(socket, 'join_room', { roomId });
    assert.equal(res.ok, true);
    assert.equal(res.state.self.role, 'host');
    assert.equal(res.state.self.username, 'Arjun');
    assert.equal(res.state.participants[0].verified, true);
  });

  it('returns ROOM_NOT_FOUND for unknown rooms', async () => {
    const socket = await client(await signup('Lost'));
    const res = await send(socket, 'join_room', { roomId: 'NOPE99' });
    assert.equal(res.ok, false);
    assert.equal(res.error.code, 'ROOM_NOT_FOUND');
    assert.equal((await fetch(`${baseUrl}/api/rooms/NOPE99`)).status, 404);
  });
});
