/** Emoji buttons under the player. */
export function ReactionBar({ options, onReact }) {
  return (
    <div className="reaction-bar" role="group" aria-label="Send a reaction">
      {options.map((emoji) => (
        <button key={emoji} type="button" className="reaction-btn" onClick={() => onReact(emoji)}>
          {emoji}
        </button>
      ))}
    </div>
  );
}

/** Floating emojis on top of the video, visible to everyone in the room. */
export function ReactionLayer({ reactions }) {
  return (
    <div className="reaction-layer" aria-hidden="true">
      {reactions.map((r) => (
        <span key={r.id} className="floating-reaction" style={{ left: `${r.left}%` }}>
          <span className="floating-emoji">{r.emoji}</span>
          <span className="floating-name">{r.username}</span>
        </span>
      ))}
    </div>
  );
}
