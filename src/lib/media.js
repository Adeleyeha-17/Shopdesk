// Whether a CSS media query matches, following the window as it's resized or turned (tablets).
import { useEffect, useState } from 'react';

export const WIDE = '(min-width: 1100px)'; // a laptop, or a tablet on its side: room beside the page

export function useMedia(query) {
  const [on, setOn] = useState(() => {
    try {
      return window.matchMedia(query).matches;
    } catch (e) {
      return false;
    }
  });
  useEffect(() => {
    let m;
    try {
      m = window.matchMedia(query);
    } catch (e) {
      return undefined;
    }
    const follow = () => setOn(m.matches);
    follow();
    m.addEventListener('change', follow);
    return () => m.removeEventListener('change', follow);
  }, [query]);
  return on;
}
