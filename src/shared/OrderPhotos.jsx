// Order photos on screen: a strip of thumbnails (tap one to open it), and a picker for adding up to 3.
import React, { useEffect, useState } from 'react';
import { orderPhotoLinks, videoLink } from '../lib/photos.js';

// Thumbnails of private order photos. paths: ['1043/c-....jpg', ...]
export function PhotoStrip({ paths, label }) {
  const [links, setLinks] = useState({});
  const key = (paths || []).join('|');
  useEffect(() => {
    let on = true;
    orderPhotoLinks(paths).then((l) => on && setLinks(l));
    return () => {
      on = false;
    };
  }, [key]);
  if (!paths || !paths.length) return null;
  return (
    <div className="photo-strip" aria-label={label || 'Photos'}>
      {paths.map((p, i) =>
        links[p] ? (
          <a key={p} href={links[p]} target="_blank" rel="noopener" aria-label={`Open photo ${i + 1}`}>
            <img src={links[p]} alt={`Photo ${i + 1}`} />
          </a>
        ) : (
          <span key={p} className="photo-wait" aria-hidden="true" />
        ),
      )}
    </div>
  );
}

// Choose photos from the phone (or take them). files: File[]; setFiles(next)
export function PhotoPicker({ id, files, setFiles, max = 3, label = 'Add photos (optional)' }) {
  const [previews, setPreviews] = useState([]);
  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);
  return (
    <div className="field">
      <span>{label}</span>
      <div className="photo-strip">
        {previews.map((u, i) => (
          <span key={u} className="photo-pick-item">
            <img src={u} alt={`Chosen photo ${i + 1}`} />
            <button
              type="button"
              className="photo-x"
              aria-label={`Remove photo ${i + 1}`}
              onClick={() => setFiles(files.filter((_, j) => j !== i))}
            >
              ×
            </button>
          </span>
        ))}
        {files.length < max && (
          <label className="photo-add" htmlFor={id}>
            <span aria-hidden="true">+</span>
            <span className="sub">Photo</span>
          </label>
        )}
      </div>
      <input
        id={id}
        type="file"
        accept="image/*"
        multiple={max > 1}
        className="visually-hidden"
        onChange={(e) => {
          const picked = [...(e.target.files || [])].filter((f) => /^image\//.test(f.type));
          setFiles([...files, ...picked].slice(0, max));
          e.target.value = '';
        }}
      />
    </div>
  );
}

// A video in a chat. local: the file being sent, shown from the phone while it uploads.
export function ChatVideo({ path, local }) {
  const [src, setSrc] = useState(local || null);
  useEffect(() => {
    if (local || !path) return undefined;
    let on = true;
    videoLink(path).then((u) => on && setSrc(u));
    return () => {
      on = false;
    };
  }, [path, local]);
  return src ? (
    <video className="chat-video" src={src} controls playsInline preload="metadata" />
  ) : (
    <span className="chat-video wait" aria-label="Video loading" />
  );
}
