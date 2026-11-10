// A simple bar chart for the admin pages (orders, money and shops per week or month).
import React, { useState } from 'react';
import { short } from './adminHelpers.js';

// One series, one colour. Values show on the latest and the highest bar, and on hover for the rest.
export function BarChart({ title, data, fmt = String, when = short }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(1, ...data.map((d) => d.v));
  const last = data.length - 1;
  const top = data.reduce((b, d, i) => (d.v > data[b].v ? i : b), 0);
  const total = data.reduce((a, d) => a + d.v, 0);
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>{title}</h3>
        <span className="sub num">
          {fmt(total)} in {data.length} {when === short ? 'weeks' : 'months'}
        </span>
      </div>
      <div
        className="cbars"
        role="img"
        aria-label={title + ': ' + data.map((d) => `${when(d.x)} ${fmt(d.v)}`).join(', ')}
      >
        {data.map((d, i) => (
          <div
            key={i}
            className={'cbar' + (i === last ? ' now' : '')}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <span className="cval num">
              {i === last || (i === top && d.v > 0) || hover === i ? fmt(d.v) : ''}
            </span>
            <b style={{ height: d.v ? Math.max(3, Math.round((100 * d.v) / max)) + '%' : 2 }} />
            <span className="cx">{(last - i) % 3 === 0 ? when(d.x) : ''}</span>
            {hover === i && (
              <div className="ctip">
                <strong className="num">{fmt(d.v)}</strong>
                <span>
                  {i === last
                    ? when === short
                      ? 'This week'
                      : 'This month'
                    : (when === short ? 'Week of ' : '') + when(d.x)}
                </span>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
