import { describeAction } from '../lib/format.js';
import { thumbnailUrl } from '../lib/youtube.js';
import Icon from './Icons.jsx';
import { Avatar } from './ParticipantList.jsx';

const TYPE_ICON = { play: 'play', pause: 'pause', seek: 'fwd10', change_video: 'film' };

/**
 * Hosts/moderators: incoming requests with Approve / Decline.
 * Participants: their own pending requests with Cancel.
 */
export default function RequestsPanel({ requests, canResolve, selfId, onResolve, onCancel }) {
  if (!requests.length) return null;

  if (canResolve) {
    return (
      <section className="requests" aria-label="Pending requests">
        <header>
          <span className="pulse" aria-hidden="true" />
          {requests.length} request{requests.length > 1 ? 's' : ''} waiting for you
          <span className="requests-hint">Approve to apply it for everyone</span>
        </header>
        <ul>
          {requests.map((r) => (
            <li key={r.id}>
              <Avatar name={r.username} size={32} />
              <span className="request-text">
                <strong>{r.username}</strong> wants to{' '}
                <span className="request-action">
                  <Icon name={TYPE_ICON[r.type] ?? 'hand'} size={13} /> {describeAction(r.type, r.payload)}
                </span>
              </span>
              {r.type === 'change_video' && (
                <a
                  className="request-thumb"
                  href={`https://www.youtube.com/watch?v=${r.payload.videoId}`}
                  target="_blank"
                  rel="noreferrer"
                  title="Preview on YouTube"
                >
                  <img src={thumbnailUrl(r.payload.videoId, 'default')} alt="Requested video" />
                  <Icon name="external" size={12} />
                </a>
              )}
              <span className="request-buttons">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => onResolve(r.id, false)}>
                  Decline
                </button>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => onResolve(r.id, true)}>
                  <Icon name="check" size={14} /> Approve
                </button>
              </span>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  const mine = requests.filter((r) => r.userId === selfId);
  if (!mine.length) return null;
  return (
    <section className="requests requests-mine" aria-label="Your requests">
      <ul>
        {mine.map((r) => (
          <li key={r.id}>
            <span className="waiting-spinner" aria-hidden="true" />
            <span className="request-text">
              Waiting for the host to approve: <strong>{describeAction(r.type, r.payload)}</strong>
            </span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onCancel(r.id)}>
              Cancel
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
