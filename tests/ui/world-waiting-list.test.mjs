/* story-world-waiting-list-v1: the world lists the judgments waiting for the owner, a few at a time,
 * each a way down to the same judgment in 判断の履歴 (ledger P17 / U2).  No waiting judgment means no
 * list; unreadable judgments are never shown as none waiting. */
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../workspace-kit.js', () => import('../../ui/workspace-kit.js'));
import { createWorldView } from '../../ui/world/world-view.js';
import { FakeDocument, findAll, jsonResponse, waitFor } from './world-canvas-harness.mjs';

const businesses = [{ id: 'id-alpha', code: 'alpha', name: 'alpha', kind: null, status: 'active', purpose: null, summary: 'alpha', engagements: [], activity: { decisions: 1, window_days: 30 } }];

function waitingItem(id, recordedAt, question) {
  return { section: 'needs_human', proof: { decision_attempt_id: id, recorded_at: recordedAt, interruption: { question_display_text: question } } };
}

function homeWith(needsHuman) {
  return {
    status: 'available',
    delegation_map: { judged: needsHuman.length, rows: [] },
    sections: {
      needs_human: needsHuman,
      continued: [{ section: 'continued', proof: { decision_attempt_id: 'dec/continued', recorded_at: '2026-10-11T00:00:00Z', decision: { summary: '聞かずに進めた' } } }],
    },
  };
}

const views = [];
afterEach(() => { views.splice(0).forEach((view) => view.dispose()); vi.unstubAllGlobals(); });

function mount({ judgments, presentation = 'canvas', extra = {} }) {
  const doc = new FakeDocument();
  const root = doc.createElement('main');
  const rail = doc.createElement('aside');
  doc.body.append(root, rail);
  const fetcher = async (path) => {
    if (path.endsWith('/businesses')) {
      return jsonResponse(200, { status: 'ok', businesses, unplaced: [], excluded: { inactive: 0 }, source: { authority: 'organization_graph', server: 'https://example.test' }, vocabulary: { kinds: [], statuses: [] } });
    }
    if (path.endsWith('/organization-judgments')) return jsonResponse(200, judgments);
    if (path.endsWith('/work-summary')) return jsonResponse(200, { status: 'ok', as_of: '2026-10-09T06:00:00Z', businesses: {} });
    return jsonResponse(200, { status: 'unavailable', reason: 'not_connected' });
  };
  const view = createWorldView({ root, rail, presentation, document: doc, fetcher, selection: { read: () => ({}), write: () => {} }, ...extra });
  views.push(view);
  root.querySelector('.bb-world-stage')?.setRect?.({ width: 900, height: 600 });
  return { root };
}

const text = (root) => String(root.textContent);
const waitingLinks = (root) => findAll(root, (node) => node.tagName === 'A' && node.classList?.contains('bb-world-waiting-link'));

const fourWaiting = [
  waitingItem('dec/a', '2026-10-08T00:00:00Z', 'Aを公開してよいか'),
  waitingItem('dec/b', '2026-10-11T00:00:00Z', 'Bの費用を払ってよいか'),
  waitingItem('dec/c', '2026-10-10T00:00:00Z', 'Cを削除してよいか'),
  waitingItem('dec/d', '2026-10-09T00:00:00Z', 'Dを送ってよいか'),
  { ...waitingItem('dec/answered', '2026-10-11T01:00:00Z', '回答済みの問い'), answer: { choice: 'yes' } },
  { ...waitingItem('dec/moved', '2026-10-11T02:00:00Z', '会話で進んだ問い'), conversation_moved_on_at: '2026-10-11T03:00:00Z' },
];

describe('the world lists what waits for the owner (story-world-waiting-list-v1)', () => {
  it('lists the newest three waiting judgments, each opening the same judgment, and points to the rest', async () => {
    const asked = [];
    const { root } = mount({
      judgments: { status: 'available', withheld: 0, home: homeWith(fourWaiting), places: [] },
      extra: { judgmentHref: (id) => { asked.push(id); return `?screen=value-proofs&decision=${id}`; } },
    });
    await waitFor(() => waitingLinks(root).length > 0);
    const links = waitingLinks(root);
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '?screen=value-proofs&decision=dec/b',
      '?screen=value-proofs&decision=dec/c',
      '?screen=value-proofs&decision=dec/d',
    ]);
    expect(text(root)).toContain('Bの費用を払ってよいか');
    expect(text(root)).not.toContain('回答済みの問い');
    expect(text(root)).not.toContain('会話で進んだ問い');
    expect(text(root)).toContain('ほか1件');
  });

  it('shows no list when nothing waits', async () => {
    const { root } = mount({ judgments: { status: 'available', withheld: 0, home: homeWith([]), places: [] } });
    await waitFor(() => text(root).includes('判断'));
    await waitFor(() => text(root).includes('今あなたを待っている判断0件'));
    expect(waitingLinks(root)).toHaveLength(0);
  });

  it('never shows unreadable judgments as none waiting', async () => {
    const { root } = mount({ judgments: { status: 'unavailable', reason: 'judgment_journal_not_connected' } });
    await waitFor(() => text(root).includes('判断の記録'));
    expect(waitingLinks(root)).toHaveLength(0);
    expect(text(root)).not.toMatch(/待っている判断0件|待っている判断はありません/u);
  });

  it('lists them in the standard presentation too, with the local web route by default', async () => {
    const { root } = mount({ judgments: { status: 'available', withheld: 0, home: homeWith(fourWaiting.slice(0, 2)), places: [] }, presentation: 'standard' });
    await waitFor(() => waitingLinks(root).length === 2);
    expect(waitingLinks(root).map((link) => link.getAttribute('href'))).toEqual(['#value-proofs?decision=dec%2Fb', '#value-proofs?decision=dec%2Fa']);
    expect(text(root)).not.toContain('ほか');
  });
});
