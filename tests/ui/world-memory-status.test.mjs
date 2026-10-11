/* story-world-memory-status-v1: the world shows how last night's memory organizing went and how many
 * memory candidates wait for the owner (ledger P18 / U3).  A host that cannot read them shows 未接続. */
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../workspace-kit.js', () => import('../../ui/workspace-kit.js'));
import { createWorldView } from '../../ui/world/world-view.js';
import { FakeDocument, findAll, jsonResponse, waitFor } from './world-canvas-harness.mjs';

const businesses = [{ id: 'id-alpha', code: 'alpha', name: 'alpha', kind: null, status: 'active', purpose: null, summary: 'alpha', engagements: [], activity: { decisions: 0, window_days: 30 } }];

const views = [];
afterEach(() => { views.splice(0).forEach((view) => view.dispose()); vi.unstubAllGlobals(); });

function mount(extra = {}, presentation = 'canvas') {
  const doc = new FakeDocument();
  const root = doc.createElement('main');
  const rail = doc.createElement('aside');
  doc.body.append(root, rail);
  const fetcher = async (path) => {
    if (path.endsWith('/businesses')) {
      return jsonResponse(200, { status: 'ok', businesses, unplaced: [], excluded: { inactive: 0 }, source: { authority: 'organization_graph', server: 'https://example.test' }, vocabulary: { kinds: [], statuses: [] } });
    }
    return jsonResponse(200, { status: 'unavailable', reason: 'not_connected' });
  };
  const view = createWorldView({ root, rail, presentation, document: doc, fetcher, selection: { read: () => ({}), write: () => {} }, ...extra });
  views.push(view);
  root.querySelector('.bb-world-stage')?.setRect?.({ width: 900, height: 600 });
  return { root };
}

const text = (root) => String(root.textContent);
const memoryLinks = (root) => findAll(root, (node) => node.tagName === 'A' && node.classList?.contains('bb-world-memory-link'));

describe('the world shows the memory loop (story-world-memory-status-v1)', () => {
  it('says 未接続 when the host gives no memory status, never zero candidates', async () => {
    const { root } = mount();
    await waitFor(() => text(root).includes('記憶の整理'));
    expect(text(root)).toContain('記憶の整理：未接続');
    expect(text(root)).not.toMatch(/候補 0件/u);
    expect(memoryLinks(root)).toHaveLength(0);
  });

  it('shows last night and the waiting candidates with a way down to 候補の確認', async () => {
    const { root } = mount({
      memoryStatus: async () => ({
        status: 'available',
        night: { status: 'partial', finished_at: '2026-10-11T18:00:42Z' },
        candidates: { count: 3 },
        review_href: '?screen=memory-review',
      }),
    });
    await waitFor(() => memoryLinks(root).length > 0);
    expect(text(root)).toContain('昨夜の記憶の整理：一部だけ');
    expect(text(root)).toContain('あなたが決める記憶の候補 3件');
    const [link] = memoryLinks(root);
    expect(link.getAttribute('href')).toBe('?screen=memory-review');
    expect(link.textContent).toBe('候補の確認を開く');
  });

  it('marks a night that could not be organized', async () => {
    const { root } = mount({
      memoryStatus: async () => ({ status: 'available', night: { status: 'failed', finished_at: '2026-10-11T18:01:00Z' }, candidates: { count: 0 } }),
    });
    await waitFor(() => text(root).includes('整理できなかった夜'));
    expect(text(root)).toContain('あなたが決める記憶の候補はありません');
  });

  it('keeps an unreadable part unknown instead of zero, and drops a link the world must not open', async () => {
    const { root } = mount({
      memoryStatus: async () => ({ status: 'partial', night: null, candidates: null, review_href: 'javascript:alert(1)' }),
    });
    await waitFor(() => text(root).includes('昨夜の記憶の整理：読めない'));
    expect(text(root)).toContain('記憶の候補：読めない');
    expect(text(root)).not.toMatch(/候補 0件|候補はありません/u);
    expect(memoryLinks(root)).toHaveLength(0);
  });

  it('treats a failed read as unknown', async () => {
    const { root } = mount({ memoryStatus: async () => { throw new Error('upstream_502'); } });
    await waitFor(() => text(root).includes('記憶の整理：読めない'));
    expect(text(root)).not.toMatch(/候補 0件|候補はありません/u);
  });

  it('shows the same lines in the standard presentation', async () => {
    const { root } = mount({
      memoryStatus: async () => ({ status: 'available', night: { status: 'completed' }, candidates: { count: 1 }, review_href: '/memory' }),
    }, 'standard');
    await waitFor(() => memoryLinks(root).length > 0);
    expect(text(root)).toContain('昨夜の記憶の整理：済み');
    expect(memoryLinks(root)[0].getAttribute('href')).toBe('/memory');
  });
});
