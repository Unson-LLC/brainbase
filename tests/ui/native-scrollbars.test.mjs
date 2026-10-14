import { expect, test, vi } from 'vitest';
import { installNativeScrollbars } from '../../ui/native-scrollbars.js';
function surface() { const set = new Set(); return { classList: { add: (...n) => n.forEach(x => set.add(x)), remove: (...n) => n.forEach(x => set.delete(x)), contains: n => set.has(n) } }; }
test('native scroll activity fades after idle and cleanup cancels pending timers', () => {
  vi.useFakeTimers();
  const root=surface(), nested=surface(); let listener;
  const doc={documentElement:root,scrollingElement:root,addEventListener:(n,fn,c)=>{expect([n,c]).toEqual(['scroll',true]);listener=fn;},removeEventListener:(n,fn,c)=>{expect(fn).toBe(listener);expect(c).toBe(true);}};
  const stop=installNativeScrollbars(doc);
  listener({target:doc}); listener({target:nested});
  expect(root.classList.contains('bb-is-scrolling')).toBe(true);
  vi.advanceTimersByTime(799); listener({target:nested});
  vi.advanceTimersByTime(1); expect(root.classList.contains('bb-is-scrolling')).toBe(false);
  expect(nested.classList.contains('bb-is-scrolling')).toBe(true);
  stop(); expect(nested.classList.contains('bb-is-scrolling')).toBe(false);
  expect(vi.getTimerCount()).toBe(0); expect(root.classList.contains('bb-native-scrollbars')).toBe(false);
  vi.useRealTimers();
});
