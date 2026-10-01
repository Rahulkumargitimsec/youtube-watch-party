import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '../components/Toasts.jsx';
import { describeAction, describeSync, ROLE_LABELS } from '../lib/format.js';
import { createSocket, emitAck, measureClockOffset } from '../lib/socket.js';
import { storage } from '../lib/storage.js';

let localId = 0;
const systemMessage = (text) => ({ id: `sys-${++localId}`, system: true, text, ts: Date.now() });

/**
 * Owns the Socket.IO connection for one room and exposes the room as React state.
 *
 * status: 'connecting' | 'joined' | 'reconnecting' | 'removed' | 'error'
 */
export function useWatchRoom(roomId, username, authToken = null) {
  const { notify } = useToast();
  const [status, setStatus] = useState('connecting');
  const [error, setError] = useState(null);
  const [room, setRoom] = useState(null);
  const [selfId, setSelfId] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [playback, setPlayback] = useState(null);
  const [requests, setRequests] = useState([]);
  const [messages, setMessages] = useState([]);
  const [reactions, setReactions] = useState([]);
  const [rolePermissions, setRolePermissions] = useState({});
  const [reactionOptions, setReactionOptions] = useState([]);
  const [clockOffset, setClockOffset] = useState(0);

  const socketRef = useRef(null);
  const selfIdRef = useRef(null);

  useEffect(() => {
    if (!roomId || !username) return undefined;

    const socket = createSocket(authToken);
    socketRef.current = socket;
    let disposed = false;

    const addMessage = (message) => setMessages((list) => [...list, message].slice(-200));
    const addSystem = (text) => addMessage(systemMessage(text));

    // (Re)join on every connect — this also handles automatic reconnects.
    const join = async () => {
      const { offset } = await measureClockOffset(socket);
      if (disposed) return;
      setClockOffset(offset);

      // The server takes the name from the logged-in account (JWT in the handshake).
      const res = await emitAck(socket, 'join_room', { roomId, token: storage.getToken(roomId) });
      if (disposed) return;
      if (!res.ok) {
        if (res.error.code === 'REMOVED') {
          storage.clearToken(roomId);
          setStatus('removed');
        } else {
          setError(res.error.message);
          setStatus('error');
        }
        socket.disconnect();
        return;
      }

      const { state, token } = res;
      storage.setToken(roomId, token);
      selfIdRef.current = state.self.userId;
      setSelfId(state.self.userId);
      setRoom(state.room);
      setParticipants(state.participants);
      setPlayback(state.playback);
      setRequests(state.requests);
      setRolePermissions(state.rolePermissions);
      setReactionOptions(state.reactions);
      setMessages((list) => {
        // Keep local system messages across reconnects, refresh chat from server history.
        const system = list.filter((m) => m.system);
        return [...state.chat, ...system].sort((a, b) => a.ts - b.ts).slice(-200);
      });
      setStatus('joined');
    };

    socket.on('connect', join);
    socket.on('disconnect', (reason) => {
      if (!disposed && reason !== 'io client disconnect') setStatus('reconnecting');
    });
    socket.on('connect_error', () => {
      if (!disposed) setStatus((s) => (s === 'joined' ? 'reconnecting' : s));
    });

    // ---- server → client events -------------------------------------------------

    socket.on('sync_state', (state) => {
      setPlayback(state);
      const text = describeSync(state.action);
      if (text) addSystem(text);
    });

    socket.on('user_joined', ({ userId, username: name, participants: list }) => {
      setParticipants(list);
      if (userId !== selfIdRef.current) addSystem(`${name} joined the party`);
    });

    socket.on('user_left', ({ username: name, participants: list }) => {
      setParticipants(list);
      addSystem(`${name} left`);
    });

    socket.on('participants_update', ({ participants: list }) => setParticipants(list));

    socket.on('role_assigned', ({ userId, username: name, role, participants: list }) => {
      setParticipants(list);
      addSystem(`${name} is now ${ROLE_LABELS[role]}`);
      if (userId === selfIdRef.current) notify(`You are now a ${ROLE_LABELS[role]}`, 'success');
    });

    socket.on('host_transferred', ({ to, reason, participants: list }) => {
      setParticipants(list);
      addSystem(reason === 'host_left' ? `Host left — ${to.username} is the new host` : `${to.username} is now the host`);
      if (to.userId === selfIdRef.current) notify('You are now the host 👑', 'success');
    });

    socket.on('participant_removed', ({ userId, username: name, participants: list }) => {
      setParticipants(list);
      if (userId !== selfIdRef.current) addSystem(`${name} was removed by the host`);
    });

    socket.on('removed_from_room', () => {
      storage.clearToken(roomId);
      setStatus('removed');
      socket.disconnect();
    });

    socket.on('requests_update', ({ requests: list }) => setRequests(list));

    socket.on('request_resolved', ({ type, payload, approved, resolvedBy }) => {
      const what = describeAction(type, payload);
      notify(
        approved
          ? `${resolvedBy.username} approved your request to ${what}`
          : `${resolvedBy.username} declined your request to ${what}`,
        approved ? 'success' : 'warning',
      );
    });

    socket.on('chat_message', (message) => addMessage(message));

    socket.on('reaction', (reaction) => {
      setReactions((list) => [...list.slice(-30), { ...reaction, left: 10 + Math.random() * 80 }]);
      setTimeout(() => setReactions((list) => list.filter((r) => r.id !== reaction.id)), 3000);
    });

    socket.connect();

    return () => {
      disposed = true;
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [roomId, username, authToken, notify]);

  // ---- client → server actions ----------------------------------------------------

  const send = useCallback(
    async (event, payload, { silent = false } = {}) => {
      const socket = socketRef.current;
      if (!socket) return { ok: false };
      const res = await emitAck(socket, event, payload);
      if (!res.ok && !silent) notify(res.error?.message ?? 'Something went wrong', 'error');
      return res;
    },
    [notify],
  );

  const self = useMemo(() => participants.find((p) => p.userId === selfId) ?? null, [participants, selfId]);
  const role = self?.role ?? 'participant';
  const can = useCallback((action) => rolePermissions[role]?.includes(action) ?? false, [rolePermissions, role]);

  const actions = useMemo(
    () => ({
      play: () => send('play'),
      pause: () => send('pause'),
      seek: (time) => send('seek', { time }),
      changeVideo: (url) => send('change_video', { url }),
      requestChange: async (type, payload = {}) => {
        const res = await send('request_change', { type, payload });
        if (res.ok) notify(`Request sent: ${describeAction(type, payload)}. Waiting for approval…`, 'info');
        return res;
      },
      resolveRequest: (requestId, approve) => send('resolve_request', { requestId, approve }),
      cancelRequest: (requestId) => send('cancel_request', { requestId }),
      assignRole: (userId, newRole) => send('assign_role', { userId, role: newRole }),
      removeParticipant: (userId) => send('remove_participant', { userId }),
      transferHost: (userId) => send('transfer_host', { userId }),
      sendChat: (text) => send('chat_message', { text }),
      react: (emoji) => send('reaction', { emoji }, { silent: true }),
      leave: async () => {
        await send('leave_room', {}, { silent: true });
        socketRef.current?.disconnect();
      },
    }),
    [send, notify],
  );

  return {
    status,
    error,
    room,
    self,
    role,
    can,
    participants,
    playback,
    requests,
    messages,
    reactions,
    reactionOptions,
    clockOffset,
    actions,
  };
}
