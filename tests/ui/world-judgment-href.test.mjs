/* story-judgment-history-nav-v1 AC-03: the world descends to a judgment in the host's 判断の履歴.
 * The local web default is `#value-proofs?decision=<id>`; an organization web passes its own route. */
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../workspace-kit.js', () => import('../../ui/workspace-kit.js'));
import { createWorldView } from '../../ui/world/world-view.js';
import { FakeDocument, findAll, jsonResponse, waitFor } from './world-canvas-harness.mjs';

const businesses = ['alpha', 'beta'].map((code) => ({ id: `id-${code}`, code, name: code, kind: null, status: 'active', purpose: null, summary: `${code} summary`, engagements: [], activity: { decisions: 1, window_days: 30 } }));
const home = {
  status: 'available',
  delegation_map: { judged: 1, rows: [] },
  sections: {
    continued: [{ section: 'continued', proof: { decision_attempt_id: 'dec/1', recorded_at: '2026-10-10T00:00:00Z', decision: { summary: '本番へ反映した' } } }],
  },
};

const views = [];
afterEach(() => { views.splice(0).forEach((view) => view.dispose()); vi.unstubAllGlobals(); });

function mount(extra = {}) {
  const doc = new FakeDocument();
  const root = doc.createElement('main');
  const rail = doc.createElement('aside');
  doc.body.append(root, rail);
  const fetcher = async (path) => {
    if (path.endsWith('/businesses')) {
      return jsonResponse(200, { status: 'ok', businesses, unplaced: [], excluded: { inactive: 0 }, source: { authority: 'organization_graph', server: 'https://example.test' }, vocabulary: { kinds: [], statuses: [] } });
    }
    if (path.endsWith('/organization-judgments')) {
      return jsonResponse(200, { status: 'available', withheld: 0, home, places: [{ decision_attempt_id: 'dec/1', workspace: 'alpha' }] });
    }
    if (path.endsWith('/work-summary')) return jsonResponse(200, { status: 'ok', as_of: '2026-10-09T06:00:00Z', businesses: {} });
    return jsonResponse(200, { status: 'unavailable', reason: 'task_store_not_connected' });
  };
  const view = createWorldView({ root, rail, presentation: 'canvas', document: doc, fetcher, selection: { read: () => ({}), write: () => {} }, ...extra });
  views.push(view);
  root.querySelector('.bb-world-stage').setRect({ width: 900, height: 600 });
  const choose = (code) => {
    const city = root.querySelector('.bb-world-canvas-city');
    city.value = code;
    city.dispatch('change');
  };
  const details = () => root.querySelector('.bb-world-canvas-rail-body');
  return { root, choose, details };
}

const judgmentLinks = (container) => findAll(container, (node) => node.tagName === 'A' && node.classList?.contains('bb-world-rail-link') && String(node.textContent).includes('判断の履歴'));

describe('the world descends to 判断の履歴 (story-judgment-history-nav-v1)', () => {
  it('opens the same judgment in the local web 判断の履歴 by default, not the retired 今日', async () => {
    const app = mount();
    await waitFor(() => app.root.querySelector('.bb-world-canvas-city')?.children.length === 3);
    app.choose('alpha');
    await waitFor(() => judgmentLinks(app.details()).length > 0);
    const [link] = judgmentLinks(app.details());
    expect(link.textContent).toBe('「判断の履歴」でこの判断を開く');
    expect(link.getAttribute('href')).toBe('#value-proofs?decision=dec%2F1');
    expect(app.details().textContent).not.toContain('今日');
  });

  it('uses the route the host passes for a judgment', async () => {
    const asked = [];
    const app = mount({ judgmentHref: (id) => { asked.push(id); return `?screen=value-proofs&decision=${id}`; } });
    await waitFor(() => app.root.querySelector('.bb-world-canvas-city')?.children.length === 3);
    app.choose('alpha');
    await waitFor(() => judgmentLinks(app.details()).length > 0);
    expect(judgmentLinks(app.details())[0].getAttribute('href')).toBe('?screen=value-proofs&decision=dec/1');
    expect(asked).toContain('dec/1');
  });
});
