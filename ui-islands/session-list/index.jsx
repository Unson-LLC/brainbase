import React from 'react';
import { createRoot } from 'react-dom/client';
import SessionList from './SessionList.jsx';

const flag = new URLSearchParams(location.search).has('island')
  || localStorage.getItem('bb:session-list-island') === '1';

if (flag) {
  const el = document.getElementById('session-list');
  if (el) {
    el.innerHTML = '';
    el.dataset.islandOwned = '1';
    createRoot(el).render(<SessionList />);
    console.info('[island] React session-list mounted (flag on)');
  }
}
