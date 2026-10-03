import { useState } from 'react';
import { extractVideoId, thumbnailUrl } from '../lib/youtube.js';
import Icon from './Icons.jsx';

export default function VideoForm({ mode, onChange }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (mode === 'none') return null;

  const previewId = extractVideoId(value);

  const submit = async (e) => {
    e.preventDefault();
    const videoId = extractVideoId(value);
    if (!videoId) {
      setError('Paste a YouTube link (youtube.com/watch?v=…, youtu.be/…, shorts) or an 11-character id.');
      return;
    }
    setError('');
    setBusy(true);
    const res = await onChange(value.trim(), videoId);
    setBusy(false);
    if (res?.ok) setValue('');
  };

  return (
    <form className="video-form" onSubmit={submit}>
      <div className="video-form-head">
        <Icon name="film" size={16} />
        <strong>{mode === 'request' ? 'Suggest the next video' : 'Change the video'}</strong>
        <span className="muted">
          {mode === 'request' ? 'The host or a moderator approves it first.' : 'Switches for everyone instantly.'}
        </span>
      </div>
      <div className="input-with-button">
        <div className={`url-input ${previewId ? 'has-preview' : ''}`}>
          {previewId ? (
            <img src={thumbnailUrl(previewId, 'default')} alt="" />
          ) : (
            <Icon name="link" size={16} className="url-input-icon" />
          )}
          <input
            type="text"
            inputMode="url"
            placeholder="Paste a YouTube link…"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (error) setError('');
            }}
            aria-label="YouTube URL"
          />
        </div>
        <button type="submit" className="btn btn-primary" disabled={busy || !value.trim()}>
          {mode === 'request' ? 'Send request' : 'Play for everyone'}
        </button>
      </div>
      {error && <p className="field-error">{error}</p>}
    </form>
  );
}
