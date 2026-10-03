import { useState } from 'react';
import { avatarColor, initials, ROLE_LABELS } from '../lib/format.js';
import Icon, { ROLE_ICON } from './Icons.jsx';

const ROLE_ORDER = { host: 0, moderator: 1, participant: 2, viewer: 3 };
const ASSIGNABLE = [
  { role: 'moderator', hint: 'Controls playback' },
  { role: 'participant', hint: 'Can request' },
  { role: 'viewer', hint: 'Watch only' },
];

export function Avatar({ name, size = 34 }) {
  return (
    <span
      className="avatar"
      style={{ '--avatar': avatarColor(name), width: size, height: size, fontSize: size * 0.38 }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

export function RoleBadge({ role }) {
  return (
    <span className={`role-badge role-${role}`}>
      {role !== 'participant' && <Icon name={ROLE_ICON[role]} size={11} strokeWidth={2.4} />}
      {ROLE_LABELS[role]}
    </span>
  );
}

/** Overlapping avatars of who's online, for the room header. */
export function AvatarStack({ participants, max = 4 }) {
  const online = participants.filter((p) => p.online);
  const shown = online.slice(0, max);
  return (
    <span className="avatar-stack" title={online.map((p) => p.username).join(', ')}>
      {shown.map((p) => (
        <Avatar key={p.userId} name={p.username} size={28} />
      ))}
      {online.length > max && <span className="avatar avatar-more">+{online.length - max}</span>}
      <span className="avatar-stack-label">{online.length} watching</span>
    </span>
  );
}

export default function ParticipantList({ participants, selfId, canManage, onAssignRole, onRemove, onTransferHost }) {
  const [openId, setOpenId] = useState(null);
  const [confirming, setConfirming] = useState(null); // 'host' | 'remove' | null

  const sorted = [...participants].sort(
    (a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || Number(b.online) - Number(a.online),
  );
  const onlineCount = participants.filter((p) => p.online).length;

  const toggle = (id) => {
    setOpenId(openId === id ? null : id);
    setConfirming(null);
  };

  return (
    <div className="people">
      <div className="people-summary">
        <span>
          <span className="live-dot" /> {onlineCount} online
        </span>
        <span className="muted">{participants.length} in room</span>
      </div>
      <ul className="participants">
        {sorted.map((p) => {
          const isSelf = p.userId === selfId;
          const manageable = canManage && !isSelf && p.role !== 'host';
          const open = openId === p.userId;
          return (
            <li key={p.userId} className={`participant ${open ? 'is-open' : ''} ${p.online ? '' : 'is-away'}`}>
              <div className="participant-row">
                <span className="avatar-wrap">
                  <Avatar name={p.username} />
                  <span className={`presence ${p.online ? 'online' : 'away'}`} title={p.online ? 'Online' : 'Reconnecting…'} />
                </span>
                <span className="participant-name">
                  <span className="participant-name-text">{p.username}</span>
                  {p.verified && (
                    <span className="verified" title="Signed-in account">
                      <Icon name="check" size={9} strokeWidth={3.5} />
                    </span>
                  )}
                  {isSelf && <span className="you">you</span>}
                </span>
                <RoleBadge role={p.role} />
                {manageable && (
                  <button
                    type="button"
                    className="icon-btn icon-btn-sm"
                    aria-expanded={open}
                    aria-label={`Manage ${p.username}`}
                    onClick={() => toggle(p.userId)}
                  >
                    <Icon name={open ? 'x' : 'more'} size={16} />
                  </button>
                )}
              </div>

              {manageable && open && (
                <div className="participant-actions">
                  <span className="participant-actions-label">Role</span>
                  <div className="role-picker" role="radiogroup" aria-label={`Role for ${p.username}`}>
                    {ASSIGNABLE.map((r) => (
                      <button
                        key={r.role}
                        type="button"
                        role="radio"
                        aria-checked={p.role === r.role}
                        className={p.role === r.role ? 'active' : ''}
                        onClick={() => p.role !== r.role && onAssignRole(p.userId, r.role)}
                      >
                        <Icon name={ROLE_ICON[r.role]} size={14} />
                        <strong>{ROLE_LABELS[r.role]}</strong>
                        <small>{r.hint}</small>
                      </button>
                    ))}
                  </div>

                  {confirming ? (
                    <div className="confirm-row">
                      <span>
                        {confirming === 'host'
                          ? `Hand the remote to ${p.username}? You become a moderator.`
                          : `Remove ${p.username} from the room?`}
                      </span>
                      <div className="participant-buttons">
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirming(null)}>
                          Cancel
                        </button>
                        <button
                          type="button"
                          className={`btn btn-sm ${confirming === 'host' ? 'btn-primary' : 'btn-danger'}`}
                          onClick={() => {
                            if (confirming === 'host') onTransferHost(p.userId);
                            else onRemove(p.userId);
                            setOpenId(null);
                            setConfirming(null);
                          }}
                        >
                          {confirming === 'host' ? 'Make host' : 'Remove'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="participant-buttons">
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirming('host')}>
                        <Icon name="crown" size={14} /> Make host
                      </button>
                      <button type="button" className="btn btn-danger btn-sm" onClick={() => setConfirming('remove')}>
                        Remove
                      </button>
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
