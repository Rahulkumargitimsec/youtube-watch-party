import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { timeOfDay } from '../lib/format.js';
import Icon from './Icons.jsx';
import { Avatar, RoleBadge } from './ParticipantList.jsx';

const QUICK = ['👋', '😂', '🔥', '🍿', '👀', '❤️'];
const GROUP_WINDOW_MS = 2 * 60_000; // consecutive messages within 2 min collapse under one header

const Chat = forwardRef(function Chat({ messages, selfId, onSend }, ref) {
  const [text, setText] = useState('');
  const [newBelow, setNewBelow] = useState(0);
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const stickToBottom = useRef(true);
  const lastCount = useRef(messages.length);

  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus() }), []);

  useEffect(() => {
    const el = listRef.current;
    const added = messages.length - lastCount.current;
    lastCount.current = messages.length;
    if (!el) return;
    if (stickToBottom.current) el.scrollTop = el.scrollHeight;
    else if (added > 0) setNewBelow((n) => n + added);
  }, [messages]);

  const onScroll = () => {
    const el = listRef.current;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (stickToBottom.current) setNewBelow(0);
  };

  const jumpDown = () => {
    const el = listRef.current;
    el?.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    setNewBelow(0);
  };

  const send = async (value) => {
    stickToBottom.current = true;
    const res = await onSend(value);
    return res?.ok;
  };

  const submit = async (e) => {
    e.preventDefault();
    const value = text.trim();
    if (!value) return;
    setText('');
    if (!(await send(value))) setText(value);
  };

  return (
    <div className="chat">
      <div className="chat-list" ref={listRef} onScroll={onScroll}>
        {messages.length === 0 && (
          <div className="empty">
            <Icon name="chat" size={26} strokeWidth={1.5} />
            <strong>No messages yet</strong>
            <span>Say hi — everyone in the room sees it live.</span>
          </div>
        )}
        {messages.map((m, i) => {
          if (m.system) {
            return (
              <div key={m.id} className="chat-system">
                <span>{m.text}</span>
                <time>{timeOfDay(m.ts)}</time>
              </div>
            );
          }
          const prev = messages[i - 1];
          const grouped = prev && !prev.system && prev.userId === m.userId && m.ts - prev.ts < GROUP_WINDOW_MS;
          const self = m.userId === selfId;
          return (
            <div key={m.id} className={`chat-message ${self ? 'is-self' : ''} ${grouped ? 'is-grouped' : ''}`}>
              {grouped ? <span className="chat-gutter" /> : <Avatar name={m.username} size={30} />}
              <div className="chat-body">
                {!grouped && (
                  <div className="chat-meta">
                    <strong>{self ? 'You' : m.username}</strong>
                    {m.role && m.role !== 'participant' && <RoleBadge role={m.role} />}
                    <time>{timeOfDay(m.ts)}</time>
                  </div>
                )}
                <p>{m.text}</p>
              </div>
            </div>
          );
        })}
      </div>

      {newBelow > 0 && (
        <button type="button" className="chat-jump" onClick={jumpDown}>
          {newBelow} new message{newBelow > 1 ? 's' : ''} ↓
        </button>
      )}

      <div className="chat-quick" role="group" aria-label="Quick messages">
        {QUICK.map((q) => (
          <button key={q} type="button" onClick={() => send(q)} aria-label={`Send ${q}`}>
            {q}
          </button>
        ))}
      </div>
      <form className="chat-form" onSubmit={submit}>
        <input
          ref={inputRef}
          type="text"
          value={text}
          maxLength={500}
          placeholder="Message the room…"
          aria-label="Chat message"
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="btn btn-primary btn-icon" disabled={!text.trim()} aria-label="Send">
          <Icon name="send" size={16} />
        </button>
      </form>
    </div>
  );
});

export default Chat;
