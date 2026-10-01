import { useState } from 'react';
import { extractVideoId } from '../lib/youtube.js';

export default function VideoForm({ mode, onChange }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (mode === 'none') return null;

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
      <div className="input-with-button">
        <input
          type="text"
          inputMode="url"
          placeholder="Paste a YouTube link to change the video…"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError('');
          }}
          aria-label="YouTube URL"
        />
        <button type="submit" className="btn btn-primary" disabled={busy || !value.trim()}>
          {mode === 'request' ? 'Request video' : 'Play video'}
        </button>
      </div>
      {error && <p className="field-error">{error}</p>}
    </form>
  );
}
