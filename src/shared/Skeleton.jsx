// Grey shapes with a soft shine where a page's content is about to appear, instead of the word "Loading".
// kind: 'shop' (a shop's products), 'list' (cards, e.g. orders), 'page' (a heading and a few lines).
import React from 'react';

const Line = ({ w = 100, h = 14 }) => <div className="sk" style={{ width: w + '%', height: h }} />;

export function Skeleton({ kind = 'list' }) {
  return (
    <div className="sk-wrap" role="status" aria-live="polite">
      <span className="visually-hidden">Loading</span>
      {kind === 'shop' ? (
        <>
          <div className="stack-xs">
            <Line w={55} h={22} />
            <Line w={75} />
          </div>
          <div className="sk" style={{ height: 46, borderRadius: 14 }} />
          <div className="grid">
            {[0, 1, 2, 3].map((i) => (
              <div className="pcard" key={i}>
                <div className="sk sk-img" />
                <Line w={80} />
                <Line w={45} h={16} />
              </div>
            ))}
          </div>
        </>
      ) : kind === 'page' ? (
        <>
          <Line w={50} h={22} />
          <Line w={90} />
          <Line w={70} />
          <div className="sk" style={{ height: 120, borderRadius: 14 }} />
        </>
      ) : (
        [0, 1, 2].map((i) => (
          <div className="sk-card" key={i}>
            <div className="row">
              <Line w={45} h={16} />
              <Line w={25} h={20} />
            </div>
            <Line w={85} />
            <div className="row">
              <Line w={35} h={12} />
              <Line w={20} h={16} />
            </div>
          </div>
        ))
      )}
    </div>
  );
}
