/** Animate native scrollbars without replacing scrolling or input handling. */
export function installNativeScrollbars(doc = document) {
  const timers = new Map();
  doc.documentElement.classList.add('bb-native-scrollbars');
  const activate = event => {
    const target = event.target === doc ? doc.scrollingElement : event.target;
    if (!target?.classList) return;
    target.classList.add('bb-scrollable', 'bb-is-scrolling');
    clearTimeout(timers.get(target));
    timers.set(target, setTimeout(() => { target.classList.remove('bb-is-scrolling'); timers.delete(target); }, 800));
  };
  doc.addEventListener('scroll', activate, true);
  return () => {
    doc.removeEventListener('scroll', activate, true);
    for (const [target, timer] of timers) { clearTimeout(timer); target.classList.remove('bb-is-scrolling'); }
    timers.clear(); doc.documentElement.classList.remove('bb-native-scrollbars');
  };
}
