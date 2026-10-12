/* story-world-waiting-queues-v1: other queues the owner decides (such as meetings waiting to be sorted)
 * are listed next to the waiting judgments, each a way down to its screen (ledger P17 / D9).  Zero is
 * quiet, unreadable is never shown as zero, and without the option the world is unchanged. */
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

const queueLinks = (root) => findAll(root, (node) => node.tagName === 'A' && node.classList?.contains('bb-world-waiting-queue-link'));
const judgments = { status: 'available', withheld: 0, home: homeWith([]), places: [] };

describe('the world lists other waiting queues (story-world-waiting-queues-v1)', () => {
  it('lists each non-empty queue with its count and a way down to its screen', async () => {
    const { root } = mount({ judgments, extra: { waitingQueues: async () => ({ status: 'available', queues: [
      { id: 'meeting-triage', label: '振り分けを待っている会議', count: 8, href: '?screen=meeting-triage', link_label: '会議の振り分けを開く' },
      { id: 'empty', label: '空の行列', count: 0, href: '?screen=empty' },
    ] }) } });
    await waitFor(() => queueLinks(root).length > 0);
    expect(queueLinks(root).map((link) => [link.getAttribute('href'), String(link.textContent)])).toEqual([['?screen=meeting-triage', '会議の振り分けを開く']]);
    expect(text(root)).toContain('振り分けを待っている会議 8件');
    expect(text(root)).not.toContain('空の行列');
  });

  it('never shows an unreadable queue as zero', async () => {
    const { root } = mount({ judgments, extra: { waitingQueues: async () => ({ status: 'available', queues: [{ id: 'meeting-triage', label: '振り分けを待っている会議', count: null, reason: 'triage_unavailable', href: '?screen=meeting-triage' }] }) } });
    await waitFor(() => text(root).includes('振り分けを待っている会議：読めない'));
    expect(text(root)).toContain('0件とは確認できません');
    expect(queueLinks(root)).toHaveLength(0);
  });

  it('says the queues are unreadable when the answer fails, without a count', async () => {
    const { root } = mount({ judgments, extra: { waitingQueues: async () => { throw new Error('network_down'); } } });
    await waitFor(() => text(root).includes('ほかの待っているもの：読めない'));
    expect(text(root)).toContain('network_down');
    expect(text(root)).not.toMatch(/待っている会議 0件/u);
  });

  it('draws no link for an href outside the host or https', async () => {
    const { root } = mount({ judgments, extra: { waitingQueues: async () => ({ status: 'available', queues: [{ id: 'x', label: '危ない行列', count: 2, href: 'javascript:alert(1)' }] }) } });
    await waitFor(() => text(root).includes('危ない行列 2件'));
    expect(queueLinks(root)).toHaveLength(0);
  });

  it('lists them in the standard presentation too', async () => {
    const { root } = mount({ judgments, presentation: 'standard', extra: { waitingQueues: () => ({ status: 'available', queues: [{ id: 'meeting-triage', label: '振り分けを待っている会議', count: 3, href: '/?screen=meeting-triage' }] }) } });
    await waitFor(() => queueLinks(root).length === 1);
    expect(queueLinks(root)[0].getAttribute('href')).toBe('/?screen=meeting-triage');
  });

  it('draws the world as before without the option', async () => {
    const { root } = mount({ judgments });
    await waitFor(() => text(root).includes('今あなたを待っている判断0件'));
    expect(text(root)).not.toContain('ほかの待っているもの');
    expect(queueLinks(root)).toHaveLength(0);
  });
});
