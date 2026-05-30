import { useSyncExternalStore } from 'react';
// NOTE: '/modules/core/store.js' is marked external in the esbuild build, so this
// import resolves at runtime to the SAME appStore singleton the vanilla app uses.
// Single source of truth -> no dual-state divergence (Spec: 二重真実源回避).
import { appStore } from '/modules/core/store.js';

export function useAppState(selector) {
  const getSnapshot = () => selector(appStore.getState());
  const subscribe = (cb) => appStore.subscribe(cb);
  // Store.subscribe passes a change object; React just needs to re-read snapshot.
  return useSyncExternalStore(subscribe, getSnapshot);
}

export { appStore };
