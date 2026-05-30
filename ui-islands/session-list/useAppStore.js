import { useSyncExternalStore, useEffect, useState } from 'react';
// Imported at runtime (esbuild external) -> the SAME live singletons the app uses.
import { appStore } from '/modules/core/store.js';
import { eventBus, EVENTS } from '/modules/core/event-bus.js';

export function useAppState(selector) {
  return useSyncExternalStore(
    (cb) => appStore.subscribe(cb),
    () => selector(appStore.getState())
  );
}

// Session status (working/done/waiting) lives OUTSIDE appStore (session-ui-state).
// Bridge SESSION_UI_STATE_CHANGED -> a React re-render so deriveSessionUiState is
// re-read. React reconciliation still patches only the changed row's indicator
// (attribute change), so churn stays ~0.
export function useStatusBump() {
  const [, bump] = useState(0);
  useEffect(() => {
    const h = () => bump((n) => n + 1);
    const off = eventBus.on(EVENTS.SESSION_UI_STATE_CHANGED, h);
    return typeof off === 'function' ? off : () => eventBus.off?.(EVENTS.SESSION_UI_STATE_CHANGED, h);
  }, []);
}

export { appStore, eventBus, EVENTS };
