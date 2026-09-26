import { afterEach, describe, expect, it } from 'vitest';
import { createLocalWebShell, LOCAL_WEB_SCREENS } from '../../ui/local-web-shell.js';

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.attributes = {};
    this.listeners = new Map();
    this.className = '';
    this.textContent = '';
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.hidden = false;
  }

  append(...children) {
    for (const child of children) {
      if (child === null || child === undefined) continue;
      child.parentNode = this;
      this.children.push(child);
    }
  }

  replaceChildren(...children) { this.children = []; this.append(...children); }
  setAttribute(name, value) { this.attributes[name] = String(value); if (name === 'value') this.value = String(value); }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
}

class FakeDocument { createElement(tagName) { return new FakeElement(tagName); } }

function collectText(node) {
  return `${node?.textContent ?? ''}${(node?.children ?? []).map(collectText).join('')}`;
}

function findAll(node, predicate, result = []) {
  if (!node) return result;
  if (predicate(node)) result.push(node);
  for (const child of node.children ?? []) findAll(child, predicate, result);
  return result;
}

function screen(root, id) {
  return findAll(root, (node) => node.attributes?.['data-screen'] === id)[0];
}

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 5));

function statusPayload(graph) {
  return {
    version: 'local-web-host.v1',
    data_dir: '/home/owner/.brainbase/personal-os',
    journal_root: '/home/owner/.brainbase/personal-os/judgment-journal',
    graph,
    organization_graph: { status: 'not_connected' },
  };
}

const V2 = { status: 'ready', format: 'v2', commands: [] };
const V1 = {
  status: 'migration_required',
  format: 'v1',
  commands: [
    'brainbase ontology:migrate --dir /home/owner/.brainbase/personal-os',
    'brainbase ontology:migrate --dir /home/owner/.brainbase/personal-os --write --expected-input-digest <1行目で表示されたinputDigest>',
  ],
};

function hostFetcher(graph, overrides = {}) {
  const calls = [];
  const routes = {
    '/api/local/status': () => jsonResponse(200, statusPayload(graph)),
    '/api/value-proofs/home': () => jsonResponse(200, { status: 'unavailable', root: '/journal', reason: 'judgment_journal_not_found' }),
    '/api/foundation/objectives': () => jsonResponse(200, { state: 'empty', records: [], absence_confirmed: true, unreadable: { count: 0, codes: [] } }),
    '/api/world-model/variables': () => jsonResponse(200, { state: 'empty', records: [], absence_confirmed: true }),
    '/api/world-model/models': () => jsonResponse(200, { state: 'empty', records: [], absence_confirmed: true }),
    '/api/world-model/observations': () => jsonResponse(200, { state: 'empty', observations: [], absence_confirmed: true }),
    '/api/world-model/adoptions': () => jsonResponse(200, { state: 'empty', adoptions: [], absence_confirmed: true }),
    ...overrides,
  };
  const fetcher = async (path) => {
    calls.push(path);
    const route = routes[path];
    return route ? route() : jsonResponse(404, { error: { code: 'not_found' } });
  };
  return { fetcher, calls };
}

const previousDocument = globalThis.document;
afterEach(() => {
  if (previousDocument === undefined) delete globalThis.document;
  else globalThis.document = previousDocument;
});

function mount(fetcher, initialScreen) {
  const doc = new FakeDocument();
  // The Objective editor renders with the page document.
  globalThis.document = doc;
  const root = new FakeElement('div');
  const shell = createLocalWebShell({ root, document: doc, fetcher, token: 'launch-token-0123456789', initialScreen });
  return { root, shell };
}

describe('local Web shell', () => {
  it('lists only the screens that exist and shows where the data comes from', async () => {
    const { fetcher } = hostFetcher(V2);
    const { root, shell } = mount(fetcher);
    await flush();
    const links = findAll(root, (node) => node.tagName === 'A');
    expect(links.map((link) => [link.textContent, link.attributes.href])).toEqual([
      ['今日', '#today'], ['目的と現状', '#objectives'], ['プロジェクトと関係者', '#projects'], ['情報と関係', '#graph'],
    ]);
    expect(LOCAL_WEB_SCREENS.map((entry) => [entry.id, entry.usesGraph])).toEqual([
      ['today', false], ['objectives', true], ['projects', true], ['graph', true],
    ]);
    expect(links[0].attributes['aria-current']).toBe('page');
    expect(shell.state.active).toBe('today');

    const source = collectText(findAll(root, (node) => node.attributes?.['aria-label'] === '出典')[0]);
    expect(source).toContain('/home/owner/.brainbase/personal-os');
    expect(source).toContain('Graphv2');
    expect(source).toContain('組織のGraph読んでいません');
    expect(collectText(screen(root, 'today'))).toContain('判断journalに接続できません');
  });

  it('mounts the Objective editor and the World Model view for 目的と現状 on Graph v2', async () => {
    const { fetcher, calls } = hostFetcher(V2);
    const { root, shell } = mount(fetcher);
    await flush();
    shell.show('objectives');
    await flush();
    expect(screen(root, 'today').hidden).toBe(true);
    expect(screen(root, 'objectives').hidden).toBe(false);
    const text = collectText(screen(root, 'objectives'));
    expect(text).toContain('目的はまだ登録されていません。');
    expect(text).toContain('現状と見通し');
    expect(text).not.toContain('Story参照');
    expect(calls).toEqual(expect.arrayContaining(['/api/foundation/objectives', '/api/world-model/variables', '/api/world-model/adoptions']));
    const links = findAll(root, (node) => node.tagName === 'A');
    expect(links[1].attributes['aria-current']).toBe('page');
    expect(links[0].attributes['aria-current']).toBeUndefined();
  });

  it('shows the migration commands for Graph v1 and never asks for objectives or the world model', async () => {
    const { fetcher, calls } = hostFetcher(V1);
    const { root } = mount(fetcher, 'objectives');
    await flush();
    const text = collectText(screen(root, 'objectives'));
    expect(text).toContain('Graphの移行が必要です');
    expect(text).toContain('0件ではありません');
    expect(text).toContain('ホストは自動で移行しません');
    expect(text).toContain('--write --expected-input-digest');
    expect(text).not.toContain('目的はまだ登録されていません');
    expect(calls.some((path) => path.startsWith('/api/foundation') || path.startsWith('/api/world-model'))).toBe(false);
    expect(collectText(findAll(root, (node) => node.attributes?.['aria-label'] === '出典')[0])).toContain('v1（移行が必要）');
  });

  it('reports an unreadable status instead of an empty screen, and mounts after a successful recheck', async () => {
    let fail = true;
    const { fetcher } = hostFetcher(V2, {
      '/api/local/status': () => (fail ? jsonResponse(500, { error: { code: 'internal_error' } }) : jsonResponse(200, statusPayload(V2))),
    });
    const { root } = mount(fetcher, 'objectives');
    await flush();
    const gate = collectText(screen(root, 'objectives'));
    expect(gate).toContain('データの状態を確認できません');
    expect(gate).toContain('0件ではありません');
    fail = false;
    const recheck = findAll(screen(root, 'objectives'), (node) => node.tagName === 'BUTTON' && node.textContent === '再確認')[0];
    recheck.listeners.get('click')();
    await flush();
    expect(collectText(screen(root, 'objectives'))).toContain('目的はまだ登録されていません。');
  });

  it('mounts プロジェクトと関係者 and 情報と関係 on Graph v2', async () => {
    const graphEmpty = { status: 'ok', source: { dataDir: '/home/owner/.brainbase/personal-os', graphFormat: 2, authority: 'local_graph' } };
    const { fetcher, calls } = hostFetcher(V2, {
      '/api/graph/projects': () => jsonResponse(200, { ...graphEmpty, asOf: '2026-09-26T00:00:00.000Z', projects: [], absenceConfirmed: true }),
      '/api/graph/search?limit=50': () => jsonResponse(200, { ...graphEmpty, query: { q: '', type: null, asOf: null }, results: [], total: 0, truncated: false, absenceConfirmed: true, graphEmpty: true }),
      '/api/graph/ontology': () => jsonResponse(200, {
        ...graphEmpty,
        asOf: '2026-09-26T00:00:00.000Z',
        ontology: { id: 'o', version: '1', releaseDigest: 'sha256:x', currentVersion: '1', upToDate: true },
        entityTypes: [{ id: 'person', meaning: 'x', count: 0 }],
        relations: [{ id: 'participates_in', from: 'person', to: 'project', meaning: 'x', count: 0, activeCount: 0 }],
      }),
    });
    const { root, shell } = mount(fetcher, 'projects');
    await flush();
    expect(shell.state.active).toBe('projects');
    const projects = collectText(screen(root, 'projects'));
    expect(projects).toContain('プロジェクトの一覧');
    expect(projects).toContain('まだ登録がありません');
    expect(shell.state.mounted).toContain('projects');

    shell.show('graph');
    await flush();
    const graph = collectText(screen(root, 'graph'));
    expect(graph).toContain('情報の種類とつながり方');
    expect(graph).toContain('まだ登録がありません');
    expect(calls).toEqual(expect.arrayContaining(['/api/graph/projects', '/api/graph/search?limit=50', '/api/graph/ontology']));
  });

  it('shows the migration commands on the Graph screens for Graph v1 and never reads the Graph', async () => {
    for (const [id, label] of [['projects', 'プロジェクトと関係者'], ['graph', '情報と関係']]) {
      const { fetcher, calls } = hostFetcher(V1);
      const { root } = mount(fetcher, id);
      await flush();
      const text = collectText(screen(root, id));
      expect(text, id).toContain('Graphの移行が必要です');
      expect(text, id).toContain(`「${label}」を読み書きできません`);
      expect(text, id).toContain('0件ではありません');
      expect(text, id).toContain('--write --expected-input-digest');
      expect(text, id).not.toContain('まだ登録がありません');
      expect(calls.some((path) => path.startsWith('/api/graph')), id).toBe(false);
    }
  });

  it('says how many objectives could not be read beside the readable ones', async () => {
    const record = {
      digest: 'sha256:1',
      definition: {
        id: 'objective-focus', type: 'objective', revision: '1', meaning: '深い仕事の時間を確保する', criteria: [],
        adoptionState: 'draft', acl: { ownerId: 'self' },
      },
    };
    const { fetcher } = hostFetcher(V2, {
      '/api/foundation/objectives': () => jsonResponse(200, { state: 'partial', records: [record], absence_confirmed: false, unreadable: { count: 2, codes: ['authorization_denied'] } }),
    });
    const { root } = mount(fetcher, 'objectives');
    await flush();
    const text = collectText(screen(root, 'objectives'));
    expect(text).toContain('深い仕事の時間を確保する');
    expect(text).toContain('読めない目的が2件あります（読む権限がない）');
  });
});
