import { afterEach, describe, expect, it } from 'vitest';
import { createLocalWebShell, LOCAL_WEB_SCREENS, parseLocalWebTarget } from '../../ui/local-web-shell.js';
import {
  graphEntityPayload,
  sourceBearingHome,
  sourceBearingProof,
  sourceFreeProof,
  UX06_GRAPH_ENTITY,
  UX06_GRAPH_ONTOLOGY,
  UX06_GRAPH_SEARCH,
} from './ux06-source-fixture.mjs';

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
const flushMany = async (count = 3) => { for (let index = 0; index < count; index += 1) await flush(); };

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
  it('parses a Graph entity target from the same-origin hash and ignores queries on other screens', () => {
    expect(parseLocalWebTarget('#graph?entity_id=project-atlas')).toEqual({ screenId: 'graph', entityId: 'project-atlas' });
    expect(parseLocalWebTarget('graph?entity_id=project%2Datlas')).toEqual({ screenId: 'graph', entityId: 'project-atlas' });
    expect(parseLocalWebTarget('#today?entity_id=project-atlas')).toEqual({ screenId: 'today', entityId: null });
    expect(parseLocalWebTarget(undefined)).toEqual({ screenId: null, entityId: null });
  });

  it('gives each screen its own right rail and the page context, and shows the rail column only for the mounted screen', async () => {
    const received = [];
    const screens = [
      { id: 'one', label: '一つ目', usesGraph: false, rail: true, source: '手元のGraph', mount: (container, context) => { received.push(context); context.rail.append(new FakeElement('p')); return true; } },
      { id: 'two', label: '二つ目', usesGraph: false, mount: () => true },
    ];
    const { fetcher } = hostFetcher(V2);
    const doc = new FakeDocument();
    globalThis.document = doc;
    const root = new FakeElement('div');
    const shell = createLocalWebShell({ root, document: doc, fetcher, token: 'launch-token-0123456789', screens, initialScreen: 'one' });
    await flush();
    const shellElement = root.children[0];
    const rail = findAll(root, (node) => node.attributes?.['aria-label'] === '選択中の項目')[0];
    expect(received[0].page).toEqual({ crumbs: ['あなたのBrainbase', '一つ目'], source: '手元のGraph' });
    expect(received[0].rail.attributes['data-rail']).toBe('one');
    expect(shellElement.className).toBe('bb-shell has-rail');
    expect(rail.hidden).toBe(false);

    shell.show('two');
    expect(shellElement.className).toBe('bb-shell');
    expect(rail.hidden).toBe(true);
  });

  it('keeps the rail column hidden while a Graph screen waits behind the migration notice', async () => {
    const { fetcher } = hostFetcher(V1);
    const { root } = mount(fetcher, 'projects');
    await flush();
    expect(root.children[0].className).toBe('bb-shell');
    expect(findAll(root, (node) => node.attributes?.['aria-label'] === '選択中の項目')[0].hidden).toBe(true);
  });

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
    expect(text).toContain('最初の登録');
    expect(text).toContain('ここから変数と最初の観測値を登録できます');
    const worldModel = findAll(screen(root, 'objectives'), (node) => String(node.className ?? '').split(' ').includes('bb-wm'))[0];
    expect(findAll(worldModel, (node) => node.tagName === 'BUTTON')).toHaveLength(1);
    expect(text).not.toContain('Story参照');
    expect(calls).toEqual(expect.arrayContaining(['/api/foundation/objectives', '/api/world-model/variables', '/api/world-model/adoptions']));
    const links = findAll(root, (node) => node.tagName === 'A');
    expect(links[1].attributes['aria-current']).toBe('page');
    expect(links[0].attributes['aria-current']).toBeUndefined();
  });

  it('shows existing synthetic World Model records without the first-registration entry', async () => {
    const variable = {
      digest: 'sha256:synthetic-variable',
      definition: {
        id: 'synthetic.focus-hours', type: 'variable', revision: '1', meaning: '架空の集中時間',
        subject: '架空の利用者', unit: '時間', measurementMethod: '架空の記録',
        epistemicState: 'supported', adoptionState: 'approved',
      },
    };
    const observation = {
      id: 'synthetic-observation', variableRef: { id: variable.definition.id, type: 'variable', revision: '1' },
      subjectId: 'synthetic-owner', value: 4,
      occurredAt: '2026-09-20T00:00:00.000Z',
      period: { from: '2026-09-19T00:00:00.000Z', until: '2026-09-19T23:59:59.000Z' },
      recordedAt: '2026-09-20T00:01:00.000Z',
      sourceRef: { sourceId: 'synthetic-journal', sourceKind: 'observation', evidenceIds: [] },
    };
    const { fetcher } = hostFetcher(V2, {
      '/api/world-model/variables': () => jsonResponse(200, { state: 'ready', records: [variable], absence_confirmed: true, unreadable: { count: 0, codes: [] } }),
      '/api/world-model/observations': () => jsonResponse(200, { state: 'ready', observations: [observation], absence_confirmed: true, unreadable: { count: 0, codes: [] } }),
    });
    const { root } = mount(fetcher, 'objectives');
    await flushMany();
    const text = collectText(screen(root, 'objectives'));
    expect(text).toContain('架空の集中時間');
    expect(text).toContain('synthetic-observation');
    expect(text).not.toContain('最初の登録');
    expect(findAll(screen(root, 'objectives'), (node) => node.attributes?.['aria-label'] === '最初の変数と観測値を登録')).toHaveLength(0);
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

  it('shows an unreadable Graph and a recheck action instead of the first-registration entry', async () => {
    const unreadable = {
      status: 'unreadable', format: null, message: '架空のgraph.jsonを読み取れません', commands: [],
    };
    const { fetcher } = hostFetcher(unreadable);
    const { root } = mount(fetcher, 'objectives');
    await flushMany();
    const text = collectText(screen(root, 'objectives'));
    expect(text).toContain('データを読み取れません');
    expect(text).toContain('架空のgraph.jsonを読み取れません');
    expect(text).toContain('0件ではありません');
    expect(text).toContain('再確認');
    expect(text).not.toContain('最初の登録');
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
    expect(projects).toContain('あなたのBrainbase/プロジェクトと関係者');
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

  it('opens a real Graph route from a source link target and shows the exact fixture entity', async () => {
    const { fetcher, calls } = hostFetcher(V2, {
      '/api/graph/search?limit=50': () => jsonResponse(200, UX06_GRAPH_SEARCH),
      '/api/graph/ontology': () => jsonResponse(200, UX06_GRAPH_ONTOLOGY),
      '/api/graph/entities/project-atlas': () => jsonResponse(200, graphEntityPayload()),
    });
    const { root, shell } = mount(fetcher, '#graph?entity_id=project-atlas');
    await flushMany();
    expect(shell.state.active).toBe('graph');
    expect(calls).toContain('/api/graph/entities/project-atlas');
    expect(collectText(screen(root, 'graph'))).toContain(UX06_GRAPH_ENTITY.name);
    expect(collectText(findAll(root, (node) => node.attributes?.['data-rail'] === 'graph')[0])).toContain(UX06_GRAPH_ENTITY.id);
  });

  it('only exposes the source link after the host confirms the source, and preserves unconfirmed states', async () => {
    const cases = [
      ['404', () => jsonResponse(404, { error: { code: 'entity_not_found' } }), '出典が見つかりません'],
      ['duplicate', () => jsonResponse(503, { error: { code: 'entity_id_ambiguous' } }), '同じIDの出典が複数あります'],
      ['forbidden', () => jsonResponse(403, { error: { code: 'authorization_denied' } }), '出典を読む権限がありません'],
      ['network', () => { throw new Error('fixture network failure'); }, '出典を確認できません'],
    ];

    for (const [label, entityRoute, expected] of cases) {
      const { fetcher, calls } = hostFetcher(V2, {
        '/api/value-proofs/home': () => jsonResponse(200, sourceBearingHome()),
        '/api/graph/entities/project-atlas': entityRoute,
      });
      const { root } = mount(fetcher, 'today');
      await flushMany(2);
      const rail = findAll(root, (node) => node.attributes?.['data-rail'] === 'today')[0];
      const item = findAll(rail, (node) => node.tagName === 'BUTTON' && String(node.className).includes('bb-vpr-item'))[0];
      expect(item, label).toBeTruthy();
      item.listeners.get('click')();
      await flushMany(2);
      expect(calls, label).toContain('/api/graph/entities/project-atlas');
      expect(findAll(rail, (node) => node.tagName === 'A'), label).toHaveLength(0);
      expect(collectText(rail), label).toContain(expected);
      expect(collectText(rail), label).toContain('未確認');
    }
  });

  it('exposes only a same-origin Graph hash link after a matching source read', async () => {
    const { fetcher } = hostFetcher(V2, {
      '/api/value-proofs/home': () => jsonResponse(200, sourceBearingHome()),
      '/api/graph/entities/project-atlas': () => jsonResponse(200, graphEntityPayload()),
    });
    const { root } = mount(fetcher, 'today');
    await flushMany(2);
    const rail = findAll(root, (node) => node.attributes?.['data-rail'] === 'today')[0];
    const item = findAll(rail, (node) => node.tagName === 'BUTTON' && String(node.className).includes('bb-vpr-item'))[0];
    item.listeners.get('click')();
    await flushMany(2);
    const links = findAll(rail, (node) => node.tagName === 'A');
    expect(links).toHaveLength(1);
    expect(links[0].attributes.href).toBe('#graph?entity_id=project-atlas');
    expect(links[0].attributes.href).not.toMatch(/^https?:/u);
  });

  it('does not expose links for source-free, digest-mismatched, or URL-shaped descriptors', async () => {
    const cases = [
      ['source-free', sourceFreeProof(), null],
      ['digest-mismatch', sourceBearingProof({ source: { kind: 'local_graph', entity_id: 'project-atlas', entity_type: 'project', digest: 'sha256:not-current' } }), '出典を確認できません'],
      ['url-shaped', sourceBearingProof({ source: { kind: 'url', url: 'https://outside.invalid/entity/project-atlas' } }), null],
    ];
    for (const [label, proof, expected] of cases) {
      const { fetcher } = hostFetcher(V2, {
        '/api/value-proofs/home': () => jsonResponse(200, sourceBearingHome(proof)),
        '/api/graph/entities/project-atlas': () => jsonResponse(200, graphEntityPayload()),
      });
      const { root } = mount(fetcher, 'today');
      await flushMany(2);
      const rail = findAll(root, (node) => node.attributes?.['data-rail'] === 'today')[0];
      const item = findAll(rail, (node) => node.tagName === 'BUTTON' && String(node.className).includes('bb-vpr-item'))[0];
      expect(item, label).toBeTruthy();
      item.listeners.get('click')();
      await flushMany(2);
      expect(findAll(rail, (node) => node.tagName === 'A'), label).toHaveLength(0);
      if (expected) expect(collectText(rail), label).toContain(expected);
    }
  });

  it('does not expose a link when the source version cannot be confirmed', async () => {
    const home = sourceBearingHome(sourceBearingProof({ source: { kind: 'local_graph', entity_id: 'project-atlas', entity_type: 'project', version: 'fixture-v2' } }));
    const { fetcher, calls } = hostFetcher(V2, {
      '/api/value-proofs/home': () => jsonResponse(200, home),
      '/api/graph/entities/project-atlas': () => jsonResponse(200, graphEntityPayload()),
    });
    const { root } = mount(fetcher, 'today');
    await flushMany(2);
    const rail = findAll(root, (node) => node.attributes?.['data-rail'] === 'today')[0];
    const item = findAll(rail, (node) => node.tagName === 'BUTTON' && String(node.className).includes('bb-vpr-item'))[0];
    item.listeners.get('click')();
    await flushMany(2);
    expect(calls).toContain('/api/graph/entities/project-atlas');
    expect(findAll(rail, (node) => node.tagName === 'A')).toHaveLength(0);
    expect(collectText(rail)).toContain('出典を確認できません');
    expect(collectText(rail)).toContain('未確認');
  });

  it('puts the selected judgment kind of 今日 and the selected objective of 目的と現状 in each screen\'s rail', async () => {
    const proof = {
      schema_version: 'brainbase-judgment-value-proof-v1', intent_id: 'intent-1', decision_attempt_id: 'attempt-1',
      recorded_at: '2026-09-20T00:00:00.000Z', state: 'unconfirmed',
      interruption: { resolution: 'continued_without_human', question_display_text: '合成の反映ですか？', reason_code: 'routine' },
      decision: { summary: '反映する', basis: [], judgment_kind: { key: 'release', label: '反映の判断' } },
      execution: { status: 'completed' }, outcome: { status: 'unconfirmed', evidence_refs: [] }, feedback: { status: 'none' },
    };
    const home = {
      status: 'available', root: '/journal',
      coverage: { saved: 1, rejected: 0, latest_recorded_at: proof.recorded_at, possibly_stalled: false },
      sections: { needs_human: [], blocked: [], continued: [{ proof, feedback_history: [] }], other: [] },
      delegation_map: {
        judged: 1, kind_recorded: 1, rated: 0, corrected_after_continue: [], continued_after_ask: [],
        rows: [{ key: 'kind:release', source: 'judgment_kind', label: '反映の判断', state: 'verifying', items: [{ intent_id: 'intent-1', decision_attempt_id: 'attempt-1' }], counts: { continued: 1 } }],
      },
      rejected: [],
    };
    const record = {
      digest: 'sha256:1',
      definition: { id: 'objective-focus', type: 'objective', revision: '1', meaning: '深い仕事の時間を確保する', criteria: [], adoptionState: 'draft', acl: { ownerId: 'self' } },
    };
    const { fetcher } = hostFetcher(V2, {
      '/api/value-proofs/home': () => jsonResponse(200, home),
      '/api/foundation/objectives': () => jsonResponse(200, { state: 'ready', records: [record], absence_confirmed: true }),
    });
    const originalFetcher = fetcher;
    const routed = async (path, init) => (path.startsWith('/api/foundation/objectives/objective-focus') ? jsonResponse(200, record) : originalFetcher(path, init));
    const { root, shell } = mount(routed, 'today');
    await flush();
    const rail = (id) => findAll(root, (node) => node.attributes?.['data-rail'] === id)[0];
    expect(collectText(rail('today'))).toContain('反映の判断');
    expect(collectText(rail('today'))).toContain('合成の反映ですか？');
    expect(collectText(screen(root, 'today'))).not.toContain('合成の反映ですか？');

    shell.show('objectives');
    await flush();
    expect(rail('today').hidden).toBe(true);
    expect(rail('objectives').hidden).toBe(false);
    expect(collectText(rail('objectives'))).toContain('深い仕事の時間を確保する');
    expect(collectText(rail('objectives'))).toContain('objective-focus@1');
    // The World Model view leaves the rail to the objective.
    expect(collectText(rail('objectives'))).not.toContain('現状と見通し');
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
    // The notice sits under the objectives, after the page head, not above the breadcrumb.
    expect(text.indexOf('読めない目的が2件')).toBeGreaterThan(text.indexOf('あなたのBrainbase'));
    expect(text.indexOf('読めない目的が2件')).toBeLessThan(text.indexOf('見方：変数とモデル'));
  });
});
