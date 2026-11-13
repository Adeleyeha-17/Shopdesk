// A small live map: the rider (and the customer, when they choose to show themselves) on OpenStreetMap tiles.
// It follows the rider: no dragging or zooming, it fits whoever is on it. Dark mode dims the tiles to match.
import React, { useEffect, useRef, useState } from 'react';

const TILE = 256;

// a point's position on the world map, in pixels at zoom z
function toPixels(lat, lng, z) {
  const n = 2 ** z * TILE;
  const r = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180;
  return [((lng + 180) / 360) * n, ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n];
}

// Straight-line distance in km between two points.
export function kmBetween(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// points: [{ lat, lng, kind: 'rider' | 'me', label }]
export function LiveMap({ points, height = 220 }) {
  const ref = useRef(null);
  const [width, setWidth] = useState(340);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth || 340));
    ro.observe(el);
    setWidth(el.clientWidth || 340);
    return () => ro.disconnect();
  }, []);
  const pts = (points || []).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (!pts.length) return null;
  // the closest zoom (up to 16) that fits everyone with room around them
  let z = 16;
  for (; z > 3; z--) {
    const px = pts.map((p) => toPixels(p.lat, p.lng, z));
    const xs = px.map((p) => p[0]);
    const ys = px.map((p) => p[1]);
    if (Math.max(...xs) - Math.min(...xs) < width - 72 && Math.max(...ys) - Math.min(...ys) < height - 72) break;
  }
  const px = pts.map((p) => toPixels(p.lat, p.lng, z));
  const cx = (Math.max(...px.map((p) => p[0])) + Math.min(...px.map((p) => p[0]))) / 2;
  const cy = (Math.max(...px.map((p) => p[1])) + Math.min(...px.map((p) => p[1]))) / 2;
  const left = cx - width / 2;
  const top = cy - height / 2;
  const n = 2 ** z;
  const tiles = [];
  for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + width) / TILE); tx++)
    for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + height) / TILE); ty++) {
      if (ty < 0 || ty >= n) continue;
      const wx = ((tx % n) + n) % n;
      tiles.push(
        <img
          key={tx + ':' + ty}
          src={`https://tile.openstreetmap.org/${z}/${wx}/${ty}.png`}
          alt=""
          draggable="false"
          onError={(e) => (e.currentTarget.style.visibility = 'hidden')}
          style={{ left: tx * TILE - left, top: ty * TILE - top }}
        />,
      );
    }
  return (
    <div className="livemap" ref={ref} style={{ height }}>
      <div className="livemap-tiles" aria-hidden="true">
        {tiles}
      </div>
      {pts.map((p, i) => (
        <span
          key={i}
          className={'livemap-pin ' + p.kind}
          style={{ left: px[i][0] - left, top: px[i][1] - top }}
          title={p.label || ''}
        >
          {p.kind === 'rider' && <i aria-hidden="true" />}
        </span>
      ))}
      <a
        className="livemap-credit"
        href="https://www.openstreetmap.org/copyright"
        target="_blank"
        rel="noopener noreferrer"
      >
        © OpenStreetMap
      </a>
    </div>
  );
}
