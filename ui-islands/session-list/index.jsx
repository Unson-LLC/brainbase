import React from 'react';
import { createRoot } from 'react-dom/client';
import SessionList from './SessionList.jsx';

// Default ON. Opt OUT with ?island=0 or localStorage bb:session-list-island='0'.
// Must mirror SessionView._sessionListIslandEnabled() so exactly one renderer owns
// #session-list (the vanilla guards bail iff the island mounts).
function islandEnabled() {
  try {
    const p = new URLSearchParams(location.search);
    if (p.get('island') === '0') return false;
    if (p.has('island')) return true;
    const ls = localStorage.getItem('bb:session-list-island');
    if (ls === '0') return false;
    return true;
  } catch { return true; }
}

if (islandEnabled()) {
  const el = document.getElementById('session-list');
  if (el) {
    el.innerHTML = '';
    el.dataset.islandOwned = '1';
    createRoot(el).render(<SessionList />);
    console.info('[island] React session-list mounted (default on)');
  }
}
