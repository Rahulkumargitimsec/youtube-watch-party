import { useEffect, useRef, useState } from 'react';
import { timeOfDay } from '../lib/format.js';
import { Avatar, RoleBadge } from './ParticipantList.jsx';

export default function Chat({ messages, selfId, onSend }) {
  const [text, setText] = useState('');
  const listRef = useRef(null);
  const stickToBottom = useRef(true);

  useEffect(() => {
    const el = listRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const onScroll = () => {
    const el = listRef.current;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };

  const submit = async (e) => {
    e.preventDefault();
    const value = text.trim();
    if (!value) return;
    setText('');
    stickToBottom.current = true;
    const res = await onSend(value);
    if (!res?.ok) setText(value);
  };

  return (
    <div className="chat">
      <div className="chat-list" ref={listRef} onScroll={onScroll}>
        {messages.length === 0 && <p className="empty">No messages yet — say hi 👋</p>}
        {messages.map((m) =>
          m.system ? (
            <div key={m.id} className="chat-system">
              {m.text}
            </div>
          ) : (
            <div key={m.id} className={`chat-message ${m.userId === selfId ? 'is-self' : ''}`}>
              <Avatar name={m.username} size={28} />
              <div className="chat-body">
                <div className="chat-meta">
                  <strong>{m.username}</strong>
                  {m.role !== 'participant' && <RoleBadge role={m.role} />}
                  <time>{timeOfDay(m.ts)}</time>
                </div>
                <p>{m.text}</p>
              </div>
            </div>
          ),
        )}
      </div>
      <form className="chat-form" onSubmit={submit}>
        <input
          type="text"
          value={text}
          maxLength={500}
          placeholder="Send a message…"
          aria-label="Chat message"
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="btn btn-primary" disabled={!text.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
