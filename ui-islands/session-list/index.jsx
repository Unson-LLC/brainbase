import React from 'react';
import { createRoot } from 'react-dom/client';
import SessionList from './SessionList.jsx';
import SessionListMobile from './SessionListMobile.jsx';

// Phase K3b: the React island is the SINGLE session-list renderer. The vanilla
// SessionView renderer was retired, so there is no opt-out fallback any more — both
// the desktop sidebar (#session-list) and the mobile bottom-sheet (#mobile-session-list)
// are mounted unconditionally. data-island-owned signals other modules (e.g. the
// terminal-switch active-row toggle, the mobile-nav render path) to stand aside.

function mountIsland(id, Component, label) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = '';
  el.dataset.islandOwned = '1';
  createRoot(el).render(<Component />);
  console.info(`[island] React ${label} mounted`);
}

mountIsland('session-list', SessionList, 'session-list');
mountIsland('mobile-session-list', SessionListMobile, 'mobile session-list');
