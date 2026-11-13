// The box for writing a chat message (order chats and the ShopDesk chat): one rounded card with a camera button, the
// message (it grows with what you type, up to about six lines) and a round send arrow. The camera button opens a sheet:
// Camera (take a photo), Video (record one, when the chat takes videos) and Photos (pick from the phone).
// Enter sends on a computer; on a phone Enter makes a new line and the arrow sends.
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const ICONS = {
  camera: (
    <>
      <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.6-2h5.8L16.5 7h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" />
      <circle cx="12" cy="12.5" r="3.4" />
    </>
  ),
  video: (
    <>
      <rect x="3" y="6.5" width="12.5" height="11" rx="2" />
      <path d="M15.5 10.5l5-3v9l-5-3" />
    </>
  ),
  photos: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
      <circle cx="15" cy="9" r="1.8" />
      <path d="M3.5 16.5l5-5 9 9" />
    </>
  ),
  send: <path d="M12 19V5M5.5 11.5L12 5l6.5 6.5" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
};
const Icon = ({ name }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    {ICONS[name]}
  </svg>
);

// The sheet: big tiles, each one a file picker (the phone opens its camera or its photos).
function MediaSheet({ video, maxSeconds, onPick, close }) {
  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && close();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [close]);
  const tile = (name, label, accept, capture) => (
    <label className="media-tile">
      <Icon name={name} />
      <span>{label}</span>
      <input
        type="file"
        accept={accept}
        capture={capture ? 'environment' : undefined}
        className="visually-hidden"
        onChange={(e) => {
          const f = e.target.files && e.target.files[0];
          e.target.value = '';
          close();
          if (f) onPick(f, /^video\//.test(f.type) || /\.(mp4|mov|webm|3gp|mkv)$/i.test(f.name) ? 'video' : 'photo');
        }}
      />
    </label>
  );
  return createPortal(
    <div className="overlay bottom media-overlay" onClick={(e) => e.target === e.currentTarget && close()}>
      <div className="modal sheet media-sheet" role="dialog" aria-modal="true" aria-labelledby="mediaTitle">
        <span className="sheet-handle" aria-hidden="true" />
        <div className="media-head">
          <button type="button" className="round-x" onClick={close} aria-label="Close">
            <Icon name="close" />
          </button>
          <h2 id="mediaTitle">{video ? 'Send a photo or video' : 'Send a photo'}</h2>
          <span />
        </div>
        <div className={'media-tiles' + (video ? '' : ' two')}>
          {tile('camera', 'Camera', 'image/*', true)}
          {video && tile('video', 'Video', 'video/*', true)}
          {tile('photos', 'Photos', video ? 'image/*,video/*' : 'image/*')}
        </div>
        {video && <p className="sub media-note">Videos can be up to {maxSeconds} seconds.</p>}
      </div>
    </div>,
    document.body,
  );
}

export function MessageBox({
  value,
  onChange,
  onSend,
  onFile,
  video = false,
  maxSeconds = 20,
  busy = false,
  autoFocus = false,
  maxLength = 1000,
}) {
  const ref = useRef(null);
  const [sheet, setSheet] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 150) + 'px';
  }, [value]);
  const ready = !busy && value.trim().length > 0;
  return (
    <>
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) onSend();
        }}
      >
        {onFile && (
          <button
            type="button"
            className="cmp-btn"
            onClick={() => setSheet(true)}
            disabled={busy}
            aria-label={video ? 'Send a photo or video' : 'Send a photo'}
          >
            <Icon name="camera" />
          </button>
        )}
        <textarea
          ref={ref}
          rows={1}
          value={value}
          maxLength={maxLength}
          placeholder="Message"
          aria-label="Message"
          autoFocus={autoFocus}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) {
              e.preventDefault();
              if (ready) onSend();
            }
          }}
        />
        <button className={'cmp-send' + (ready ? ' ready' : '')} disabled={!ready} aria-label="Send">
          <Icon name="send" />
        </button>
      </form>
      {sheet && <MediaSheet video={video} maxSeconds={maxSeconds} onPick={onFile} close={() => setSheet(false)} />}
    </>
  );
}
