// The Sales tab's charts, drawn with plain HTML and a little SVG (no chart library).
import React from 'react';
import { naira } from '../lib/money.js';
import { shortNaira, niceTop } from './salesMath.js';

// Income bars for each hour, day or month. The dashed line is the period before, for comparison.
// Tap (or point at) a bar to choose it; the Sales tab shows its amount above the chart.
export function IncomeChart({ values, previous, labels, titles, selected, onSelect }) {
  const n = values.length;
  const max = niceTop(Math.max(1, ...values.map((v) => v || 0), ...previous));
  const hasPrevious = previous.some((v) => v > 0);
  const y = (v) => 100 - (v / max) * 100;
  return (
    <div className="ichart">
      <div className="ichart-plot">
        <div className="ichart-line" style={{ top: 0 }}>
          <span>{shortNaira(max)}</span>
        </div>
        <div className="ichart-line" style={{ top: '50%' }}>
          <span>{shortNaira(max / 2)}</span>
        </div>
        {hasPrevious && (
          <svg className="ichart-prev" viewBox={`0 0 ${n} 100`} preserveAspectRatio="none" aria-hidden="true">
            <polyline points={previous.map((v, i) => `${i + 0.5},${y(v)}`).join(' ')} />
          </svg>
        )}
        <div className="ichart-cols" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
          {values.map((v, i) => (
            <button
              key={i}
              type="button"
              className={'ichart-col' + (i === selected ? ' on' : '') + (v == null ? ' later' : '')}
              onClick={() => onSelect(i)}
              onMouseEnter={() => onSelect(i)}
              onFocus={() => onSelect(i)}
              aria-label={`${titles[i]}: ${v == null ? 'still to come' : naira(v)}`}
              aria-pressed={i === selected}
            >
              <b style={{ height: v ? `${Math.max(2, (v / max) * 100)}%` : 0 }} />
            </button>
          ))}
        </div>
      </div>
      <div
        className="ichart-x"
        style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}
        aria-hidden="true"
      >
        {labels.map((l, i) => (
          <span key={i}>{l}</span>
        ))}
      </div>
    </div>
  );
}

// The running total: how income adds up through the period. The grey line is the period before.
// Tap (or point at) any point to see the total so far at that moment.
export function RunningChart({ values, previous, labels, titles, selected, onSelect }) {
  const n = values.length;
  const max = niceTop(Math.max(1, ...values.map((v) => v || 0), ...previous.map((v) => v || 0)));
  const y = (v) => 100 - (v / max) * 100;
  const now = values.map((v, i) => (v == null ? null : [i + 0.5, y(v)])).filter(Boolean);
  const line = now.map((p) => p.join(',')).join(' ');
  const area = now.length ? `${now[0][0]},100 ${line} ${now[now.length - 1][0]},100` : '';
  const hasPrevious = previous.some((v) => v > 0);
  const picked = values[selected];
  return (
    <div className="ichart">
      <div className="ichart-plot">
        <div className="ichart-line" style={{ top: 0 }}>
          <span>{shortNaira(max)}</span>
        </div>
        <div className="ichart-line" style={{ top: '50%' }}>
          <span>{shortNaira(max / 2)}</span>
        </div>
        <svg className="rchart" viewBox={`0 0 ${n} 100`} preserveAspectRatio="none" aria-hidden="true">
          {hasPrevious && (
            <polyline
              className="rchart-prev"
              points={previous.map((v, i) => `${i + 0.5},${y(v || 0)}`).join(' ')}
            />
          )}
          {now.length > 0 && <polygon className="rchart-area" points={area} />}
          {now.length > 0 && <polyline className="rchart-now" points={line} />}
          {picked != null && (
            <line className="rchart-cross" x1={selected + 0.5} x2={selected + 0.5} y1="0" y2="100" />
          )}
        </svg>
        {picked != null && (
          <i
            className="rchart-dot"
            style={{ left: `${((selected + 0.5) / n) * 100}%`, top: `${y(picked)}%` }}
          />
        )}
        <div className="ichart-cols" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
          {values.map((v, i) => (
            <button
              key={i}
              type="button"
              className={'ichart-col hit' + (v == null ? ' later' : '')}
              onClick={() => onSelect(i)}
              onMouseEnter={() => onSelect(i)}
              onFocus={() => onSelect(i)}
              aria-label={`By ${titles[i]}: ${v == null ? 'still to come' : naira(v)}`}
              aria-pressed={i === selected}
            />
          ))}
        </div>
      </div>
      <div
        className="ichart-x"
        style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}
        aria-hidden="true"
      >
        {labels.map((l, i) => (
          <span key={i}>{l}</span>
        ))}
      </div>
    </div>
  );
}

// Small bars for counts (orders by day of the week, or by hour). The tallest bar is dark.
export function CountBars({ values, labels, label }) {
  const max = Math.max(1, ...values);
  const top = Math.max(...values);
  return (
    <div className="cbars-mini" role="img" aria-label={label}>
      <div
        className="cbars-mini-cols"
        style={{ gridTemplateColumns: `repeat(${values.length}, minmax(0, 1fr))` }}
      >
        {values.map((v, i) => (
          <b
            key={i}
            className={v && v === top ? 'peak' : ''}
            style={{ height: v ? `${Math.max(6, (v / max) * 100)}%` : 2 }}
          />
        ))}
      </div>
      <div
        className="cbars-mini-x"
        style={{ gridTemplateColumns: `repeat(${values.length}, minmax(0, 1fr))` }}
      >
        {labels.map((l, i) => (
          <span key={i}>{l}</span>
        ))}
      </div>
    </div>
  );
}

// One bar split into coloured parts, with a line for each part underneath.
// parts: [{ key, label, value, note }] — key picks the colour (in, owed, rider, cancelled)
export function SplitBar({ parts }) {
  const shown = parts.filter((p) => p.value > 0);
  const total = shown.reduce((a, p) => a + p.value, 0);
  return (
    <>
      <div className="split" aria-hidden="true">
        {total ? (
          shown.map((p) => <i key={p.key} className={'part-' + p.key} style={{ flexGrow: p.value }} />)
        ) : (
          <i className="part-empty" style={{ flexGrow: 1 }} />
        )}
      </div>
      <div className="list">
        {parts.map((p) => (
          <div className="row legend" key={p.key}>
            <span>
              <i className={'dot-' + p.key} aria-hidden="true" />
              {p.label}
              {p.note && <span className="sub"> · {p.note}</span>}
            </span>
            <strong className="num">{naira(p.value)}</strong>
          </div>
        ))}
      </div>
    </>
  );
}

// A ranked list with a thin bar under each line (best sellers, top customers).
export function RankList({ items }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="rank">
      {items.map((i) => (
        <div key={i.name} className="rank-item">
          <div className="row">
            <span>
              {i.name}
              {i.sub && <span className="sub"> · {i.sub}</span>}
            </span>
            <strong className="num">{naira(i.value)}</strong>
          </div>
          <div className="rank-track">
            <i style={{ width: `${Math.max(3, (i.value / max) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
