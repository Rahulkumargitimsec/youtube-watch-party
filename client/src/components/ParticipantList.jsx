import { useState } from 'react';
import { avatarColor, initials, ROLE_LABELS } from '../lib/format.js';

const ROLE_ICONS = { host: '👑', moderator: '🛡️', participant: '', viewer: '👁️' };

export function Avatar({ name, size = 34 }) {
  return (
    <span
      className="avatar"
      style={{ background: avatarColor(name), width: size, height: size, fontSize: size * 0.38 }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

export function RoleBadge({ role }) {
  return (
    <span className={`role-badge role-${role}`}>
      {ROLE_ICONS[role] && <span aria-hidden="true">{ROLE_ICONS[role]} </span>}
      {ROLE_LABELS[role]}
    </span>
  );
}

export default function ParticipantList({ participants, selfId, canManage, onAssignRole, onRemove, onTransferHost }) {
  const [openId, setOpenId] = useState(null);

  return (
    <ul className="participants">
      {participants.map((p) => {
        const isSelf = p.userId === selfId;
        const manageable = canManage && !isSelf && p.role !== 'host';
        const open = openId === p.userId;
        return (
          <li key={p.userId} className={`participant ${open ? 'is-open' : ''}`}>
            <div className="participant-row">
              <span className="avatar-wrap">
                <Avatar name={p.username} />
                <span className={`presence ${p.online ? 'online' : 'away'}`} title={p.online ? 'Online' : 'Reconnecting…'} />
              </span>
              <span className="participant-name">
                {p.username}
                {p.verified && (
                  <span className="verified" title="Signed-in account">
                    ✓
                  </span>
                )}
                {isSelf && <span className="you">you</span>}
              </span>
              <RoleBadge role={p.role} />
              {manageable && (
                <button
                  type="button"
                  className="icon-btn"
                  aria-expanded={open}
                  aria-label={`Manage ${p.username}`}
                  onClick={() => setOpenId(open ? null : p.userId)}
                >
                  ⋯
                </button>
              )}
            </div>

            {manageable && open && (
              <div className="participant-actions">
                <label>
                  Role
                  <select
                    value={p.role}
                    onChange={(e) => {
                      onAssignRole(p.userId, e.target.value);
                      setOpenId(null);
                    }}
                  >
                    <option value="moderator">Moderator — can control playback</option>
                    <option value="participant">Participant — can request changes</option>
                    <option value="viewer">Viewer — watch only</option>
                  </select>
                </label>
                <div className="participant-buttons">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      if (window.confirm(`Make ${p.username} the host? You will become a moderator.`)) {
                        onTransferHost(p.userId);
                        setOpenId(null);
                      }
                    }}
                  >
                    👑 Make host
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    onClick={() => {
                      if (window.confirm(`Remove ${p.username} from the room?`)) {
                        onRemove(p.userId);
                        setOpenId(null);
                      }
                    }}
                  >
                    Remove
                  </button>
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
