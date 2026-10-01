import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import { Room } from '../src/core/Room.js';
import { PlaybackState } from '../src/core/PlaybackState.js';
import { extractVideoId } from '../src/utils/youtube.js';

/** Minimal stand-in for the Socket.IO server that records every emit. */
function fakeIo() {
  const emits = [];
  const target = (channel) => ({
    emit: (event, payload) => emits.push({ channel, event, payload }),
    socketsLeave: () => {},
  });
  return { emits, to: target, in: target };
}

describe('extractVideoId', () => {
  it('parses common YouTube URL formats', () => {
    for (const input of [
      'dQw4w9WgXcQ',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s',
      'https://youtu.be/dQw4w9WgXcQ?si=abc',
      'youtube.com/shorts/dQw4w9WgXcQ',
      'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
      'https://www.youtube.com/live/dQw4w9WgXcQ',
    ]) {
      assert.equal(extractVideoId(input), 'dQw4w9WgXcQ', input);
    }
  });

  it('rejects non-YouTube input', () => {
    for (const input of ['', 'hello', 'https://vimeo.com/12345', 'https://evil.com/watch?v=dQw4w9WgXcQ', 42]) {
      assert.equal(extractVideoId(input), null, String(input));
    }
  });
});

describe('PlaybackState', () => {
  it('extrapolates time while playing and freezes it when paused', () => {
    const state = new PlaybackState({ videoId: 'dQw4w9WgXcQ', updatedAt: 0 });
    state.play(1_000);
    assert.equal(state.currentTime(11_000), 10);
    state.pause(11_000);
    assert.equal(state.currentTime(99_000), 10);
    state.seek(30, 99_000);
    assert.equal(state.currentTime(120_000), 30);
  });
});

describe('Room roles & permissions', () => {
  let io;
  let room;
  let host;
  let alice;
  let bob;

  beforeEach(() => {
    io = fakeIo();
    room = new Room({ id: 'ABC123', name: 'Test' }, { io, graceMs: 50 });
    const created = room.createHost('Host');
    host = room.join({ token: created.token, username: 'Host', socketId: 's-host' }).participant;
    alice = room.join({ username: 'Alice', socketId: 's-alice' }).participant;
    bob = room.join({ username: 'Bob', socketId: 's-bob' }).participant;
  });

  it('gives the creator Host and joiners Participant', () => {
    assert.equal(host.role, 'host');
    assert.equal(alice.role, 'participant');
    assert.equal(room.publicParticipants()[0].userId, host.userId);
  });

  it('restores identity and role from the session token', () => {
    const token = room.join({ username: 'Carol', socketId: 's1' }).token;
    const again = room.join({ token, username: 'Carol', socketId: 's2' });
    assert.equal(again.token, token);
    assert.equal(room.activeMembers().filter((p) => p.username === 'Carol').length, 1);
  });

  it('rejects playback control from participants', () => {
    assert.throws(() => room.play(alice.userId), { code: 'FORBIDDEN' });
    assert.throws(() => room.changeVideo(alice.userId, 'dQw4w9WgXcQ'), { code: 'FORBIDDEN' });
    assert.equal(room.playback.isPlaying, false);
  });

  it('lets the host promote a participant to moderator who can then control playback', () => {
    room.assignRole(host.userId, alice.userId, 'moderator');
    assert.equal(alice.role, 'moderator');
    room.play(alice.userId);
    room.seek(alice.userId, 42);
    room.changeVideo(alice.userId, 'https://youtu.be/dQw4w9WgXcQ');
    assert.equal(room.playback.videoId, 'dQw4w9WgXcQ');
    const roleEvent = io.emits.find((e) => e.event === 'role_assigned');
    assert.equal(roleEvent.payload.role, 'moderator');
    assert.ok(Array.isArray(roleEvent.payload.participants));
  });

  it('only lets the host assign roles, remove users and transfer host', () => {
    room.assignRole(host.userId, alice.userId, 'moderator');
    assert.throws(() => room.assignRole(alice.userId, bob.userId, 'moderator'), { code: 'FORBIDDEN' });
    assert.throws(() => room.removeParticipant(alice.userId, bob.userId), { code: 'FORBIDDEN' });
    assert.throws(() => room.transferHost(alice.userId, alice.userId), { code: 'FORBIDDEN' });
    assert.throws(() => room.assignRole(host.userId, host.userId, 'viewer'), { code: 'INVALID_TARGET' });
    assert.throws(() => room.assignRole(host.userId, bob.userId, 'host'), { code: 'INVALID_ROLE' });
  });

  it('routes participant requests through host/moderator approval', () => {
    const request = room.createRequest(alice.userId, 'seek', { time: 90 });
    assert.equal(room.playback.position, 0, 'request must not take effect before approval');

    const hostUpdate = io.emits.findLast(
      (e) => e.event === 'requests_update' && e.channel === room.userChannel(host.userId),
    );
    assert.equal(hostUpdate.payload.requests.length, 1);
    const bobUpdate = io.emits.findLast(
      (e) => e.event === 'requests_update' && e.channel === room.userChannel(bob.userId),
    );
    assert.equal(bobUpdate.payload.requests.length, 0, 'other participants do not see the request');

    assert.throws(() => room.resolveRequest(bob.userId, request.id, true), { code: 'FORBIDDEN' });
    room.resolveRequest(host.userId, request.id, true);
    assert.equal(room.playback.position, 90);

    const resolved = io.emits.find((e) => e.event === 'request_resolved');
    assert.equal(resolved.channel, room.userChannel(alice.userId));
    assert.equal(resolved.payload.approved, true);
  });

  it('does not apply rejected requests, and viewers cannot request', () => {
    const request = room.createRequest(alice.userId, 'change_video', { videoId: 'dQw4w9WgXcQ' });
    room.resolveRequest(host.userId, request.id, false);
    assert.notEqual(room.playback.videoId, 'dQw4w9WgXcQ');

    room.assignRole(host.userId, bob.userId, 'viewer');
    assert.throws(() => room.createRequest(bob.userId, 'play', {}), { code: 'FORBIDDEN' });
  });

  it('removes a participant and blocks them from rejoining with the same token', () => {
    const { token, participant } = room.join({ username: 'Mallory', socketId: 's-m' });
    room.removeParticipant(host.userId, participant.userId);
    assert.ok(!room.publicParticipants().some((p) => p.userId === participant.userId));
    assert.throws(() => room.play(participant.userId), { code: 'NOT_IN_ROOM' });
    assert.throws(() => room.join({ token, username: 'Mallory', socketId: 's-m2' }), { code: 'REMOVED' });
  });

  it('transfers host and demotes the old host to moderator', () => {
    room.transferHost(host.userId, bob.userId);
    assert.equal(bob.role, 'host');
    assert.equal(host.role, 'moderator');
    assert.equal(room.hostUserId, bob.userId);
    assert.throws(() => room.removeParticipant(host.userId, alice.userId), { code: 'FORBIDDEN' });
  });

  it('promotes a new host when the host leaves', () => {
    room.assignRole(host.userId, bob.userId, 'moderator');
    room.leave(host.userId, 's-host');
    assert.equal(bob.role, 'host', 'moderators are preferred over participants');
    assert.equal(room.hostUserId, bob.userId);
  });

  it('keeps a disconnected user during the grace period, then removes them', async () => {
    room.handleDisconnect(alice.userId, 's-alice');
    assert.ok(room.publicParticipants().some((p) => p.userId === alice.userId && !p.online));
    await new Promise((r) => setTimeout(r, 80));
    assert.ok(!room.publicParticipants().some((p) => p.userId === alice.userId));
    assert.ok(io.emits.some((e) => e.event === 'user_left' && e.payload.userId === alice.userId));
  });
});
