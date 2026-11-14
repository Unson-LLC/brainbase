/* A browser that can only draw WebGL in software (no GPU) builds the 3D scene so slowly that the page
 * freezes for tens of seconds, which matters once a host opens the World first. Such an environment
 * gets the list, with the reason, instead of a frozen page. */
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../workspace-kit.js', () => import('../../ui/workspace-kit.js'));
import { createWorldView } from '../../ui/world/world-view.js';
import { FakeDocument, jsonResponse, waitFor } from './world-canvas-harness.mjs';

const businesses = ['alpha'].map((code) => ({ id: `id-${code}`, code, name: code, kind: null, status: 'active', purpose: null, summary: `${code} summary`, engagements: [], activity: { decisions: 0, window_days: 30 } }));

const views = [];
afterEach(() => { views.splice(0).forEach((view) => view.dispose()); });

function mount(getContext) {
  const doc = new FakeDocument();
  const create = doc.createElement.bind(doc);
  doc.createElement = (tag) => {
    const node = create(tag);
    if (tag === 'canvas') node.getContext = getContext;
    return node;
  };
  const root = doc.createElement('main');
  const rail = doc.createElement('aside');
  doc.body.append(root, rail);
  const fetcher = async (path) => {
    if (path.endsWith('/businesses')) return jsonResponse(200, { status: 'ok', businesses, unplaced: [], excluded: { inactive: 0 }, source: { authority: 'local_graph' }, vocabulary: { kinds: [], statuses: [] } });
    return jsonResponse(200, { status: 'unavailable', reason: 'not_connected' });
  };
  const view = createWorldView({ root, rail, presentation: 'standard', document: doc, fetcher, selection: { read: () => ({}), write: () => {} } });
  views.push(view);
  return { root };
}

describe('WebGL that would only run in software', () => {
  it('shows the list with the reason instead of building the 3D scene', async () => {
    const asked = [];
    const app = mount((kind, options) => {
      asked.push({ kind, strict: options?.failIfMajorPerformanceCaveat === true });
      if (kind === '2d') return {};
      return options?.failIfMajorPerformanceCaveat ? null : {};
    });
    await waitFor(() => app.root.querySelector('.bb-world-fallback') !== null);
    expect(app.root.textContent).toContain('3Dの描画が非常に遅いため、一覧で出しています');
    expect(asked.some((call) => call.strict)).toBe(true);
  });

  it('keeps the existing reason when WebGL is not available at all', async () => {
    const app = mount(() => null);
    await waitFor(() => app.root.querySelector('.bb-world-fallback') !== null);
    expect(app.root.textContent).toContain('この環境では3Dを表示できないため、一覧で出しています。');
  });
});
