// A full-screen chat that fits exactly above the phone's keyboard. Phones (iPhones most of all) don't shrink the page when
// the keyboard opens; they slide the page up instead, which pushed the chat off the top of the screen. This keeps the
// element the size of what is actually visible, in the visible spot, so the message box sits right on the keyboard.
import { useEffect } from 'react';

export function useKeyboardFit(ref) {
  useEffect(() => {
    const vv = window.visualViewport;
    const el = ref.current;
    if (!vv || !el) return undefined;
    const fit = () => {
      el.style.height = vv.height + 'px';
      el.style.transform = vv.offsetTop ? `translateY(${vv.offsetTop}px)` : '';
    };
    fit();
    vv.addEventListener('resize', fit);
    vv.addEventListener('scroll', fit);
    return () => {
      vv.removeEventListener('resize', fit);
      vv.removeEventListener('scroll', fit);
      el.style.height = '';
      el.style.transform = '';
    };
  }, [ref]);
}
