import { describeAction } from '../lib/format.js';

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
          {requests.length} pending request{requests.length > 1 ? 's' : ''}
        </header>
        <ul>
          {requests.map((r) => (
            <li key={r.id}>
              <span>
                <strong>{r.username}</strong> wants to {describeAction(r.type, r.payload)}
                {r.type === 'change_video' && (
                  <a
                    className="request-link"
                    href={`https://www.youtube.com/watch?v=${r.payload.videoId}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    preview ↗
                  </a>
                )}
              </span>
              <span className="request-buttons">
                <button type="button" className="btn btn-success btn-sm" onClick={() => onResolve(r.id, true)}>
                  Approve
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => onResolve(r.id, false)}>
                  Decline
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
            <span>
              ⏳ Waiting for approval to <strong>{describeAction(r.type, r.payload)}</strong>
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
