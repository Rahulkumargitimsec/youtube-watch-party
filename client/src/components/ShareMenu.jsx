import { useEffect, useRef, useState } from 'react';
import Icon from './Icons.jsx';
import { useToast } from './Toasts.jsx';

/** "Invite" button with a popover: copy code, copy link, native share. */
export default function ShareMenu({ roomId, roomName }) {
  const { notify } = useToast();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(null); // 'link' | 'code'
  const ref = useRef(null);
  const link = `${window.location.origin}/room/${roomId}`;

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const copy = async (what) => {
    const value = what === 'link' ? link : roomId;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(what);
      notify(what === 'link' ? 'Invite link copied' : 'Room code copied', 'success');
      setTimeout(() => setCopied(null), 1600);
    } catch {
      window.prompt('Copy this:', value);
    }
  };

  const nativeShare = async () => {
    try {
      await navigator.share({ title: `Join “${roomName}” on WatchParty`, url: link });
    } catch {
      /* user cancelled */
    }
  };

  return (
    <div className="share" ref={ref}>
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="share" size={15} /> <span className="hide-sm">Invite</span>
      </button>

      {open && (
        <div className="share-pop card" role="dialog" aria-label="Invite people">
          <div className="share-head">
            <strong>Invite to the party</strong>
            <span className="muted">Anyone with an account can join with this code.</span>
          </div>

          <button type="button" className="share-code" onClick={() => copy('code')} title="Copy room code">
            {roomId.split('').map((c, i) => (
              <span key={i}>{c}</span>
            ))}
            <Icon name={copied === 'code' ? 'check' : 'copy'} size={16} />
          </button>

          <div className="share-link">
            <input type="text" readOnly value={link} aria-label="Invite link" onFocus={(e) => e.target.select()} />
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => copy('link')}>
              <Icon name={copied === 'link' ? 'check' : 'link'} size={14} /> {copied === 'link' ? 'Copied' : 'Copy'}
            </button>
          </div>

          {typeof navigator.share === 'function' && (
            <button type="button" className="link-btn share-native" onClick={nativeShare}>
              <Icon name="share" size={14} /> Share via…
            </button>
          )}
        </div>
      )}
    </div>
  );
}
