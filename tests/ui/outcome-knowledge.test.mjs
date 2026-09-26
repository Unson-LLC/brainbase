import { afterEach, describe, expect, it } from 'vitest';

import {
  buildKnowledgeItemsPath,
  createKnowledgeOutcomeController,
  fromLocalDateTimeValue,
  normalizeKnowledgeCollection,
  normalizeKnowledgeItem,
  renderCandidateReview,
  renderCommitState,
  renderDraftCapture,
  renderIsolatedPreview,
  renderKnowledgeDetail,
  renderKnowledgeDestination,
  renderKnowledgeList,
  renderLifecycle,
  toLocalDateTimeValue,
} from '../../ui/outcome-knowledge.js';

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

  appendChild(child) {
    this.append(child);
    return child;
  }

  replaceChildren(...children) {
    this.children = [];
    this.append(...children);
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === 'value') this.value = String(value);
    if (name === 'checked') this.checked = true;
    if (name === 'disabled') this.disabled = true;
  }

  addEventListener(name, callback) {
    this.listeners.set(name, callback);
  }

  dispatch(name, event = {}) {
    this.listeners.get(name)?.({ preventDefault() {}, target: this, ...event });
  }

  reportValidity() { return true; }

  get firstChild() { return this.children[0] ?? null; }
  get lastChild() { return this.children[this.children.length - 1] ?? null; }
}

class FakeDocument {
  createElement(tagName) { return new FakeElement(tagName); }
}

function collectText(node) {
  if (!node) return '';
  return `${node.textContent ?? ''}${(node.children ?? []).map(collectText).join('')}`;
}

function findAll(node, tagName) {
  const found = [];
  if (node?.tagName === String(tagName).toUpperCase()) found.push(node);
  for (const child of node?.children ?? []) found.push(...findAll(child, tagName));
  return found;
}

function destinationRegistration(overrides = {}) {
  return {
    organization_id: 'org-1',
    tenant_id: 'org-1',
    project_code: 'proj-1',
    source_class: 'owning_repo',
    content_type: 'team_document',
    repository_owner: 'Unson-LLC',
    repository_name: 'brainbase',
    branch: 'release',
    path_scope: 'knowledge',
    registration_status: 'active',
    revision: 8,
    ...overrides,
  };
}

const previousDocument = globalThis.document;
afterEach(() => {
  if (previousDocument === undefined) delete globalThis.document;
  else globalThis.document = previousDocument;
});

describe('outcome knowledge UI contract', () => {
  it('builds project-scoped discovery paths without leaking actor or tenant fields', () => {
    const path = buildKnowledgeItemsPath({ code: 'proj/一' }, { q: '期限', scope: 'all', status: 'active', limit: 20 });
    expect(path).toMatch(/^\/api\/projects\/proj%2F%E4%B8%80\/knowledge\/items\?/);
    expect(path).toContain('q=%E6%9C%9F%E9%99%90');
    expect(path).toContain('scope=all');
    expect(path).toContain('status=active');
    expect(path).toContain('limit=20');
    expect(path).not.toMatch(/actor|tenant|role/);
  });

  it('preserves canonical identifiers, versions, source state and applicability', () => {
    const item = normalizeKnowledgeItem({
      id: 'knowledge-7', type: 'decision', title: '判断', summary: '要旨', canonical_content: '正本の全文', scope: 'organization', owner: { id: 'person-4' },
      source: { pointer: 'https://example.test/source', kind: 'meeting', content_state: 'pointer_only' },
      applicability: { state: 'conditional', conditions: '初回提案時のみ' }, lifecycle: { status: 'active', effective_at: '2026-01-01' },
      version: 3, updated_at: '2026-09-17T02:00:00Z', relations: [{ id: 'knowledge-8' }],
    });
    expect(item).toMatchObject({ id: 'knowledge-7', type: 'decision', scope: 'organization', version: 3, updated_at: '2026-09-17T02:00:00Z' });
    expect(item.content).toBe('正本の全文');
    expect(item.owner).toEqual({ id: 'person-4' });
    expect(item.source).toMatchObject({ state: 'pointer_only', pointer: 'https://example.test/source' });
    expect(item.applicability).toMatchObject({ state: 'conditional', conditions: '初回提案時のみ' });
    expect(normalizeKnowledgeItem({ id: 'string-version', version: 'rev-2026-09-17' }).version).toBe('rev-2026-09-17');
  });

  it('preserves unchanged instants, emits ISO for edits and uses null only for explicit deletion', () => {
    const winter = '2026-01-15T09:30:00+09:00';
    const dstAmbiguous = '2026-11-01T01:30:00-04:00';
    expect(fromLocalDateTimeValue(toLocalDateTimeValue(winter), winter)).toBe(winter);
    expect(fromLocalDateTimeValue(toLocalDateTimeValue(dstAmbiguous), dstAmbiguous)).toBe(dstAmbiguous);
    expect(fromLocalDateTimeValue('2026-09-18T09:45', winter)).toMatch(/^2026-09-18T\d{2}:45:00\.000Z$/);
    expect(fromLocalDateTimeValue('', winter)).toBeNull();
  });

  it('renders revision with canonical content and constrained scope/people choices', () => {
    globalThis.document = new FakeDocument();
    const root = new FakeElement('div');
    const changes = [];
    renderLifecycle(root, normalizeKnowledgeItem({ id: 'k-1', version: 'v1', title: '判断', summary: '短い要旨', content: '保持すべき正本の全文', scope: 'project', owner_person_id: 'person-1', lifecycle: { effective_at: '2026-09-18T00:00:00Z' } }), {
      ownerCandidates: [{ id: 'person-1', name: '佐藤 圭吾' }, { id: 'person-2', name: '山田 花子' }],
      onRevision: (change) => changes.push(change),
    });
    const textarea = findAll(root, 'textarea').find((node) => node.attributes.name === 'content');
    expect(textarea.value).toBe('保持すべき正本の全文');
    expect(collectText(root)).toContain('このプロジェクト');
    expect(collectText(root)).toContain('組織共通');
    expect(collectText(root)).toContain('佐藤 圭吾');
    expect(collectText(root)).not.toContain('責任者ID');
    findAll(root, 'form')[0].dispatch('submit');
    expect(changes[0].content).toBe('保持すべき正本の全文');
    expect(changes[0].effective_at).toBe('2026-09-18T00:00:00Z');
    expect(changes[0]).not.toHaveProperty('summary');
  });

  it('does not invent a scope or owner when the canonical values are unknown', () => {
    globalThis.document = new FakeDocument();
    const root = new FakeElement('div');
    renderLifecycle(root, normalizeKnowledgeItem({ id: 'k-unknown', version: 'v1', title: '判断', content: '本文', scope: 'legacy-scope' }), {
      ownerCandidates: [{ id: 'person-1', name: '佐藤 圭吾' }], onRevision() {},
    });
    const scope = findAll(root, 'select').find((node) => node.attributes.name === 'scope');
    const owner = findAll(root, 'select').find((node) => node.attributes.name === 'owner_person_id');
    expect(scope.value).toBe('');
    expect(owner.value).toBe('');
    expect(collectText(scope)).toContain('現在値: legacy-scope');
  });

  it('keeps an explicit empty result distinct from an unknown result', () => {
    expect(normalizeKnowledgeCollection({ state: 'empty', records: [], absence_confirmed: false }).state).toBe('empty');
    expect(normalizeKnowledgeCollection({ state: 'results', records: [], absence_confirmed: false }).state).toBe('unknown');
    expect(normalizeKnowledgeCollection({ state: 'unknown', records: null }).state).toBe('unknown');
  });

  it('renders loading, empty, unknown and pointer-only source states as visible UI states', () => {
    globalThis.document = new FakeDocument();
    const root = new FakeElement('div');
    renderKnowledgeList(root, { state: 'loading', records: null });
    expect(collectText(root)).toContain('知識・判断');
    expect(findAll(root, 'div').some((node) => node.className.includes('knowledge-skeleton-row'))).toBe(true);

    renderKnowledgeList(root, { state: 'empty', records: [], absence_confirmed: false });
    expect(collectText(root)).toContain('この条件に一致する知識はありません');
    renderKnowledgeList(root, { state: 'results', records: [], absence_confirmed: false }, { onRetry() {} });
    expect(collectText(root)).toContain('空の一覧とは扱いません');

    const detail = new FakeElement('div');
    const normalized = normalizeKnowledgeItem({ id: 'k-1', title: '出典付き', version: 2, source: { pointer: 'https://example.test', kind: 'doc', content_state: 'pointer_only' } });
    renderKnowledgeDetail(detail, normalized);
    expect(collectText(detail)).toContain('参照先のみ（本文未取得）');

    renderKnowledgeDetail(detail, normalizeKnowledgeItem({ id: 'k-string', title: '文字列版', version: 'rev_01JZ', source: { kind: 'fixture', content_state: 'fetched' } }));
    expect(collectText(detail)).toContain('rev_01JZ');
  });

  it('keeps natural-language input in the capture form and exposes candidate comparison', () => {
    globalThis.document = new FakeDocument();
    const captureRoot = new FakeElement('div');
    const inputText = '長い入力\n改行を保持する';
    const captureForm = renderDraftCapture(captureRoot, { state: 'error_retryable', input_text: inputText, message: '失敗' }, { onRetry() {} });
    expect(captureForm.children.some((child) => child.tagName === 'LABEL')).toBe(true);
    expect(findAll(captureRoot, 'textarea').some((textarea) => textarea.value === inputText)).toBe(true);
    expect(collectText(captureRoot)).toContain('失敗');

    const reviewRoot = new FakeElement('div');
    renderCandidateReview(reviewRoot, { state: 'candidate', input_text: inputText, candidate: { type: 'decision', title: '候補', summary: '提案', scope: 'project', source: { content_state: 'unknown' } } });
    const reviewText = collectText(reviewRoot);
    expect(reviewText).toContain('入力原文');
    expect(reviewText).toContain('提案（未確定）');
    expect(reviewText).toContain('未確認');
  });

  it('renders an unconfigured knowledge destination without inventing repository defaults and preserves edits', () => {
    globalThis.document = new FakeDocument();
    const root = new FakeElement('div');
    const changes = [];
    renderKnowledgeDestination(root, {
      state: 'unregistered',
      draft: { repository_owner: 'Unson-LLC', repository_name: '', branch: '', path_scope: 'docs/knowledge' },
    }, { canEdit: true, onSave: (value) => changes.push(value) });

    expect(collectText(root)).toContain('保存先は未登録です');
    expect(findAll(root, 'input').find((node) => node.attributes.name === 'repository_owner').value).toBe('Unson-LLC');
    expect(findAll(root, 'input').find((node) => node.attributes.name === 'repository_name').value).toBe('');
    expect(findAll(root, 'input').find((node) => node.attributes.name === 'branch').value).toBe('');
    expect(collectText(root)).not.toContain('main');
    findAll(root, 'form')[0].dispatch('submit');
    expect(changes[0]).toEqual({ repository_owner: 'Unson-LLC', repository_name: '', branch: '', path_scope: 'docs/knowledge', expected_revision: null });
  });

  it('shows destination readback and keeps a conflict draft for retry', () => {
    globalThis.document = new FakeDocument();
    const root = new FakeElement('div');
    renderKnowledgeDestination(root, {
      state: 'conflict', revision: 4,
      registration: { repository_owner: 'Unson-LLC', repository_name: 'brainbase', branch: 'release', path_scope: 'docs' },
      draft: { repository_owner: 'Unson-LLC', repository_name: 'brainbase-next', branch: 'release', path_scope: 'knowledge' },
      message: '別の変更が先に保存されました。',
    }, { canEdit: true, onReload() {}, onSave() {} });

    expect(collectText(root)).toContain('版の競合');
    expect(collectText(root)).toContain('現在の登録: Unson-LLC / brainbase / release / docs');
    expect(findAll(root, 'input').find((node) => node.attributes.name === 'repository_name').value).toBe('brainbase-next');
  });

  it('uses a registered destination as the editable baseline when there is no pending draft', () => {
    globalThis.document = new FakeDocument();
    const root = new FakeElement('div');
    renderKnowledgeDestination(root, {
      state: 'ready', revision: 4, draft: {},
      registration: { repository_owner: 'Unson-LLC', repository_name: 'brainbase', branch: 'release', path_scope: 'docs', revision: 4 },
    }, { canEdit: true, onSave() {} });

    expect(findAll(root, 'input').find((node) => node.attributes.name === 'repository_owner').value).toBe('Unson-LLC');
    expect(findAll(root, 'input').find((node) => node.attributes.name === 'repository_name').value).toBe('brainbase');
    expect(findAll(root, 'input').find((node) => node.attributes.name === 'branch').value).toBe('release');
    expect(findAll(root, 'input').find((node) => node.attributes.name === 'path_scope').value).toBe('docs');
  });

  // A host whose destination API accepts a different set of users injects its
  // own rule. This one mirrors a host that accepts only project members with
  // specific roles, and never treats a wildcard grant as the project itself.
  const hostDestinationRule = (session, projectCode) => ['member', 'gm', 'ceo'].includes(String(session?.role ?? '').toLowerCase())
    && Array.isArray(session?.project_codes) && session.project_codes.includes(projectCode);
  const hasDestinationForm = (root) => {
    const destination = findAll(root, 'section').find((node) => node.className.includes('knowledge-destination-view'));
    return findAll(destination, 'form').some((node) => node.className.includes('knowledge-destination-form'));
  };

  it.each([
    ['member with the project', { role: 'member', project_codes: ['proj-1'] }, true],
    ['gm with the project', { role: 'GM', project_codes: ['proj-1'] }, true],
    ['ceo with the project', { role: 'ceo', project_codes: ['other', 'proj-1'] }, true],
    ['owner, which the host rule rejects', { role: 'owner', project_codes: ['proj-1'] }, false],
    ['admin, which the host rule rejects', { role: 'admin', project_codes: ['proj-1'] }, false],
    ['member without the project', { role: 'member', project_codes: ['other'] }, false],
    ['ceo without the project', { role: 'ceo', project_codes: ['other'] }, false],
    ['member with only a wildcard grant', { role: 'member', project_codes: ['*'] }, false],
    ['missing session', null, false],
  ])('offers destination registration through the host-injected rule: %s', (_label, session, expected) => {
    globalThis.document = new FakeDocument();
    const root = new FakeElement('div');
    createKnowledgeOutcomeController({ project: { code: 'proj-1' }, root, session: () => session, autoLoad: false, canEditDestination: hostDestinationRule });

    expect(hasDestinationForm(root)).toBe(expected);
  });

  it('passes the resolved session and project code to the destination rule', () => {
    globalThis.document = new FakeDocument();
    const root = new FakeElement('div');
    const calls = [];
    const session = { role: 'viewer', project_codes: ['proj-1'] };
    createKnowledgeOutcomeController({
      project: { code: 'proj-1' }, root, session: () => session, autoLoad: false,
      canEditDestination: (value, projectCode) => { calls.push([value, projectCode]); return 'yes'; },
    });

    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]).toEqual([session, 'proj-1']);
    // Only an explicit true grants the form; a truthy non-boolean does not.
    expect(hasDestinationForm(root)).toBe(false);
  });

  it('keeps the knowledge manager rule for the destination form when no host rule is injected', () => {
    for (const [session, expected] of [
      [{ role: 'owner' }, true],
      [{ role: 'admin' }, true],
      [{ role: 'member', project_codes: ['proj-1'] }, false],
    ]) {
      globalThis.document = new FakeDocument();
      const root = new FakeElement('div');
      createKnowledgeOutcomeController({ project: { code: 'proj-1' }, root, session: () => session, autoLoad: false });
      expect(hasDestinationForm(root)).toBe(expected);
    }
  });

  it('renders discovery as a master-detail workspace and keeps the inspector across focused modes', () => {
    globalThis.document = new FakeDocument();
    const root = new FakeElement('div');
    const controller = createKnowledgeOutcomeController({
      project: { code: 'proj-1' },
      root,
      session: { role: 'owner' },
      autoLoad: false,
    });

    const shell = root.firstChild;
    const header = findAll(shell, 'header')[0];
    const body = findAll(shell, 'div').find((node) => node.className.includes('knowledge-outcome-body'));
    const primary = findAll(body, 'main')[0];
    const inspector = findAll(body, 'aside')[0];
    const discovery = findAll(primary, 'section').find((node) => node.className.includes('knowledge-discovery-view'));

    expect(header.className).toBe('knowledge-outcome-head');
    expect(findAll(header, 'nav')[0].className).toBe('knowledge-outcome-nav');
    expect(body.attributes['data-view']).toBe('discovery');
    expect(primary.className).toContain('knowledge-master');
    expect(inspector.className).toContain('knowledge-inspector');
    expect(findAll(inspector, 'div').some((node) => node.className.includes('knowledge-inspector-heading'))).toBe(true);
    expect(findAll(inspector, 'div').some((node) => node.className.includes('knowledge-inspector-detail'))).toBe(true);
    expect(discovery.attributes['aria-labelledby']).toBe('knowledge-discovery-title');
    expect(findAll(discovery, 'div').some((node) => node.className.includes('knowledge-discovery-toolbar'))).toBe(true);
    expect(findAll(discovery, 'div').some((node) => node.className.includes('knowledge-discovery-list'))).toBe(true);
    expect(findAll(inspector, 'div').some((node) => node.className.includes('knowledge-inspector-lifecycle'))).toBe(true);

    const previewTab = findAll(header, 'button').find((node) => node.textContent === '公開前テスト');
    previewTab.dispatch('click');
    const focusedBody = findAll(root.firstChild, 'div').find((node) => node.className.includes('knowledge-outcome-body'));
    const focusedPrimary = findAll(focusedBody, 'main')[0];
    const preview = findAll(focusedPrimary, 'section').find((node) => node.className.includes('knowledge-preview-view'));

    expect(focusedBody.attributes['data-view']).toBe('preview');
    expect(preview.hidden).toBe(false);
    expect(findAll(focusedBody, 'aside')).toHaveLength(1);
    expect(controller.state.view).toBe('preview');
  });

  it('loads the confirmed project-scoped destination endpoint and treats a missing registration explicitly', async () => {
    globalThis.document = new FakeDocument();
    const calls = [];
    const notFound = Object.assign(new Error('not found'), { status: 404, code: 'knowledge_document_source_registration_not_found' });
    const controller = createKnowledgeOutcomeController({
      root: new FakeElement('div'), project: { code: 'proj-1' }, autoLoad: false,
      api: async (...args) => { calls.push(['get', ...args]); throw notFound; },
      apiMutation: async () => { throw new Error('mutation must not run'); },
    });

    const result = await controller.loadDestination();

    expect(calls).toEqual([['get', '/api/projects/proj-1/knowledge/document-source-registration', {}]]);
    expect(result).toMatchObject({ state: 'unregistered', registration: null, draft: {} });
  });

  it.each([
    ['empty 200 response', {}],
    ['error-shaped 200 response', { data: { error: { code: 'upstream_unavailable' } } }],
    ['missing registered status', { registration: destinationRegistration() }],
    ['different project', { status: 'registered', registration: destinationRegistration({ project_code: 'proj-2' }) }],
    ['missing tenant', { status: 'registered', registration: destinationRegistration({ tenant_id: undefined }) }],
    ['tenant and organization differ', { status: 'registered', registration: destinationRegistration({ tenant_id: 'org-2' }) }],
    ['missing revision', { status: 'registered', registration: destinationRegistration({ revision: undefined }) }],
    ['zero revision', { status: 'registered', registration: destinationRegistration({ revision: 0 }) }],
    ['empty repository owner', { status: 'registered', registration: destinationRegistration({ repository_owner: ' ' }) }],
    ['empty repository name', { status: 'registered', registration: destinationRegistration({ repository_name: '' }) }],
    ['empty branch', { status: 'registered', registration: destinationRegistration({ branch: '' }) }],
    ['empty path scope', { status: 'registered', registration: destinationRegistration({ path_scope: '' }) }],
    ['inactive registration', { status: 'registered', registration: destinationRegistration({ registration_status: 'inactive' }) }],
    ['different source class', { status: 'registered', registration: destinationRegistration({ source_class: 'other' }) }],
    ['different content type', { status: 'registered', registration: destinationRegistration({ content_type: 'source_document' }) }],
  ])('keeps malformed destination response unknown and preserves input (%s)', async (_label, payload) => {
    globalThis.document = new FakeDocument();
    const draft = { repository_owner: 'draft-owner', repository_name: 'draft-repo', branch: 'draft-branch', path_scope: 'draft-path', expected_revision: 3 };
    const controller = createKnowledgeOutcomeController({
      root: new FakeElement('div'), project: { code: 'proj-1' }, autoLoad: false,
      api: async () => payload, apiMutation: async () => { throw new Error('mutation must not run'); },
    });
    controller.state.destination.draft = draft;

    const result = await controller.loadDestination();

    expect(result).toMatchObject({ state: 'unknown', registration: null, revision: null, draft });
  });

  it('verifies a destination only after an exact GET readback on an explicitly configured path', async () => {
    globalThis.document = new FakeDocument();
    const calls = [];
    const registration = destinationRegistration();
    const controller = createKnowledgeOutcomeController({
      root: new FakeElement('div'), project: { code: 'proj-1' }, autoLoad: false,
      knowledgeDestinationPath: (code) => `/test/projects/${code}/knowledge/destination`,
      apiMutation: async (path, request) => { calls.push(['put', path, request]); return { status: 'registered', registration }; },
      api: async (path) => { calls.push(['get', path]); return { status: 'registered', registration }; },
    });

    const input = { repository_owner: registration.repository_owner, repository_name: registration.repository_name, branch: registration.branch, path_scope: registration.path_scope, expected_revision: 7 };
    const result = await controller.saveDestination(input);

    expect(calls.map(([method]) => method)).toEqual(['put', 'get']);
    expect(calls[0][1]).toBe('/test/projects/proj-1/knowledge/destination');
    expect(calls[0][2]).toMatchObject({ method: 'PUT', body: input });
    expect(result).toMatchObject({ state: 'verified', registration, revision: 8, draft: {} });
  });

  it.each([
    ['both revisions missing', destinationRegistration({ revision: undefined }), destinationRegistration({ revision: undefined })],
    ['mutation revision missing', destinationRegistration({ revision: undefined }), destinationRegistration()],
    ['readback revision missing', destinationRegistration(), destinationRegistration({ revision: undefined })],
    ['revision differs', destinationRegistration({ revision: 8 }), destinationRegistration({ revision: 9 })],
    ['mutation project differs', destinationRegistration({ project_code: 'proj-2' }), destinationRegistration()],
    ['readback project differs', destinationRegistration(), destinationRegistration({ project_code: 'proj-2' })],
    ['mutation tenant differs', destinationRegistration({ tenant_id: 'org-2' }), destinationRegistration()],
    ['readback tenant missing', destinationRegistration(), destinationRegistration({ tenant_id: undefined })],
    ['mutation inactive', destinationRegistration({ registration_status: 'inactive' }), destinationRegistration()],
    ['readback inactive', destinationRegistration(), destinationRegistration({ registration_status: 'inactive' })],
    ['readback owner empty', destinationRegistration(), destinationRegistration({ repository_owner: '' })],
  ])('does not verify a destination unless mutation and readback are valid matching contracts (%s)', async (_label, mutationRegistration, readbackRegistration) => {
    globalThis.document = new FakeDocument();
    const input = { repository_owner: 'Unson-LLC', repository_name: 'brainbase', branch: 'release', path_scope: 'knowledge', expected_revision: 7 };
    const controller = createKnowledgeOutcomeController({
      root: new FakeElement('div'), project: { code: 'proj-1' }, autoLoad: false,
      knowledgeDestinationPath: '/test/projects/proj-1/knowledge/destination',
      apiMutation: async () => ({ status: 'registered', registration: mutationRegistration }),
      api: async () => ({ status: 'registered', registration: readbackRegistration }),
    });

    const result = await controller.saveDestination(input);

    expect(result).toMatchObject({ state: 'unknown', registration: null, revision: null, draft: input });
  });

  it('keeps destination edits when an explicitly configured save conflicts', async () => {
    globalThis.document = new FakeDocument();
    const conflict = Object.assign(new Error('destination_revision_conflict'), { status: 409, code: 'destination_revision_conflict' });
    const controller = createKnowledgeOutcomeController({
      root: new FakeElement('div'), project: { code: 'proj-1' }, autoLoad: false,
      knowledgeDestinationPath: '/test/projects/proj-1/knowledge/destination',
      apiMutation: async () => { throw conflict; }, api: async () => ({}),
    });
    const input = { repository_owner: 'Unson-LLC', repository_name: 'brainbase-next', branch: 'release', path_scope: 'knowledge', expected_revision: 4 };

    const result = await controller.saveDestination(input);

    expect(result).toMatchObject({ state: 'conflict', draft: input, error: 'destination_revision_conflict' });
  });

  it('shows an AI proposal as unapproved with its accepted and excluded evidence', () => {
    globalThis.document = new FakeDocument();
    const root = new FakeElement('div');
    renderCandidateReview(root, { state: 'candidate', canonical: false, persisted: false, readback: { state: 'proposal_only' }, input_text: '原文', proposal: { type: 'decision', title: '候補', summary: '提案', scope: 'project' }, evidence: [{ id: 'dec-1', version: '3', source_ref: 'graph:dec-1:3' }], exclusions: [{ id: 'dec-2', version: '1', reason: 'not_found' }] });
    const rendered = collectText(root);
    expect(rendered).toContain('未承認・未保存の提案');
    expect(rendered).toContain('graph:dec-1:3');
    expect(rendered).toContain('除外: dec-2 / not_found');
  });

  it('does not promote a save response to verified without canonical readback', () => {
    globalThis.document = new FakeDocument();
    const root = new FakeElement('div');
    renderCommitState(root, { state: 'saved_unverified', item_id: 'k-1', version: 4, search_index_state: 'unknown' }, { onReadback() {} });
    const rendered = collectText(root);
    expect(rendered).toContain('保存済み・未確認');
    expect(rendered).toContain('検索反映');
    expect(rendered).not.toContain('正本と関係のreadbackが一致しました');
  });

  it('renders opaque string versions returned by the canonical service', () => {
    globalThis.document = new FakeDocument();
    const root = new FakeElement('div');
    renderCommitState(root, { state: 'verified', item_id: 'k-1', version: 'rev_01JZ' });
    expect(collectText(root)).toContain('rev_01JZ');
  });

  it('keeps fixed preview examples separate from executed results and records adoption/version', () => {
    globalThis.document = new FakeDocument();
    const root = new FakeElement('div');
    renderIsolatedPreview(root, {
      state: 'ready', isolated: true, question: '何を確認するか',
      answer_text: '実行回答', example_answer: '固定例',
      results: [{ id: 'k-1', title: '採用判断', version: 4, adopted: true }, { id: 'k-2', title: '除外判断', version: 2, adopted: false, excluded_reason: '適用外' }],
    });
    const rendered = collectText(root);
    expect(rendered).toContain('隔離実行');
    expect(rendered).toContain('実行結果の回答');
    expect(rendered).toContain('固定の回答例（実行結果とは別）');
    expect(rendered).toContain('回答へ採用');
    expect(rendered).toContain('除外理由: 適用外');
    expect(rendered).toContain('版: 4');
  });

  it('renders the latest preview response candidates, citations, evidence, exclusions and stale draft version', () => {
    globalThis.document = new FakeDocument();
    const root = new FakeElement('div');
    renderIsolatedPreview(root, {
      state: 'ready', isolation: 'draft_only', answer: '実行回答', draft_version: 'v2', item_version: 'v3',
      candidates: [{ id: 'draft-1', title: '下書き', version: 'v2' }, { id: 'dec-1', title: '現行判断', version: 'v7' }, { id: 'dec-2', title: '除外判断', version: 'v1' }],
      citations: [{ id: 'dec-1', version: 'v7' }], evidence: [{ id: 'dec-1', version: 'v7', source_ref: 'graph:dec-1:v7' }], exclusions: [{ id: 'dec-2', version: 'v1', reason: 'not_found' }],
    });
    const rendered = collectText(root);
    expect(rendered).toContain('回答へ採用');
    expect(rendered).toContain('取得根拠: graph:dec-1:v7');
    expect(rendered).toContain('除外理由: not_found');
    expect(rendered).toContain('この試験は旧版です（試験: v2 / 現在: v3）');
  });

  it('previews an already fetched canonical item with its exact full content without creating an AI proposal', async () => {
    globalThis.document = new FakeDocument();
    const root = new FakeElement('div');
    const mutations = [];
    const controller = createKnowledgeOutcomeController({
      root, project: { code: 'proj-1' }, api: async () => ({ records: [] }), autoLoad: false,
      apiMutation: async (path, init) => { mutations.push({ path, init }); return { isolation: 'draft_only', answer: '回答', draft_version: 'k7' }; },
    });
    controller.state.selected = normalizeKnowledgeItem({ id: 'k-1', version: 'k7', title: '判断', summary: '短い要旨', content: '長い正本本文。要旨にない条件も含む。', applicability: { conditions: '条件A' } });
    controller.state.preview = { state: 'idle', item_id: 'k-1', item_version: 'k7' };
    await controller.runPreview({ question: '条件は？' });
    expect(mutations).toHaveLength(1);
    expect(mutations[0].path).toBe('/api/projects/proj-1/knowledge/preview');
    expect(mutations[0].init.body.draft).toMatchObject({ id: 'k-1', version: 'k7', summary: '短い要旨', content: '長い正本本文。要旨にない条件も含む。' });
    expect(mutations[0].init.body.draft_version).toBe('k7');
  });

  it.each([
    [1, '1'],
    ['rev:opaque/01', 'rev:opaque/01'],
  ])('serializes preview version %s as the exact opaque string %s', async (revision, expectedVersion) => {
    globalThis.document = new FakeDocument();
    const mutations = [];
    const controller = createKnowledgeOutcomeController({
      root: new FakeElement('div'), project: { code: 'proj-1' }, autoLoad: false,
      api: async () => ({ records: [] }),
      serializePreview: (input, candidate) => ({ question: input.question, draft_version: candidate.version, draft: candidate.candidate ?? candidate }),
      apiMutation: async (path, init) => { mutations.push({ path, init }); return { isolation: 'draft_only', answer: '回答', draft_version: expectedVersion }; },
    });
    controller.state.draft = { draft_id: 'draft-1', revision, content: '保存済み本文' };
    controller.state.candidate = { draft_id: 'draft-1', candidate: { title: '判断', summary: '要旨', content: '保存済み本文' } };
    await controller.runPreview({ question: '条件は？' });
    expect(mutations).toHaveLength(1);
    expect(mutations[0].init.body.draft_version).toBe(expectedVersion);
    expect(mutations[0].init.body.draft.version).toBe(expectedVersion);
  });

  it('does not preview a canonical item when only its summary is available', async () => {
    globalThis.document = new FakeDocument();
    const root = new FakeElement('div');
    const mutations = [];
    const controller = createKnowledgeOutcomeController({ root, project: { code: 'proj-1' }, api: async () => ({ records: [] }), apiMutation: async (...args) => { mutations.push(args); }, autoLoad: false });
    controller.state.selected = normalizeKnowledgeItem({ id: 'k-1', version: 'k7', title: '判断', summary: '要旨だけ' });
    controller.state.preview = { state: 'idle', item_id: 'k-1', item_version: 'k7' };
    expect(await controller.runPreview({ question: '条件は？' })).toBeNull();
    expect(mutations).toHaveLength(0);
    expect(controller.state.preview.message).toContain('要旨だけでは試験しません');
  });

  it('uses injected API callbacks, expected versions and canonical readback for mutations', async () => {
    globalThis.document = new FakeDocument();
    const root = new FakeElement('div');
    const mutations = [];
    const api = async (path) => {
      if (path.endsWith('/items/k-1')) return { item: { id: 'k-1', title: '正本', summary: '確定本文', version: '2', content_hash: 'sha256:ok', source: { content_state: 'fetched' } }, canonical_saved: true, graph_saved: true, content_hash: 'sha256:ok' };
      return { state: 'results', records: [] };
    };
    const apiMutation = async (path, init) => {
      mutations.push({ path, init });
      if (path.endsWith('/capture/proposal')) return { state: 'proposed', canonical: false, persisted: false, proposal: { kind: 'decision', title: '候補', summary: '提案', scope: 'project', owner_candidate: 'per-ai' }, evidence: [{ id: 'dec-1', version: '3' }], readback: { state: 'proposal_only' } };
      if (path.endsWith('/drafts')) return { draft_id: 'draft-1', revision: 1 };
      if (path.endsWith('/save')) return { canonical: { id: 'k-1', version: '2' }, expected_version: '2', canonical_content_hash: 'sha256:ok', persistence: { event_saved: true, graph_saved: true, readback_verified: true } };
      return { draft_id: 'draft-1', revision: 2 };
    };
    const controller = createKnowledgeOutcomeController({ root, project: { code: 'proj-1' }, api, apiMutation, session: { role: 'member' }, resolveDecisionDomain: () => 'knowledge-canonical', autoLoad: false });
    await controller.createDraft({ input_text: '登録したい判断', source: { pointer: 'https://example.test' } });
    expect(mutations[0].path).toBe('/api/projects/proj-1/knowledge/capture/proposal');
    expect(mutations[0].init.body).toEqual({ content: '登録したい判断', source: { pointer: 'https://example.test' } });
    expect(mutations[0].init.body).not.toHaveProperty('actor');
    expect(controller.state.candidate.draft_id).toBeNull();
    expect(controller.state.candidate.proposal_applied).toBe(false);
    expect(controller.state.candidate.candidate.owner_candidate).toBe('per-ai');
    controller.applyProposal();
    await controller.saveCandidate({ type: 'decision', title: '候補', summary: '提案', scope: 'project', applicability: { conditions: '条件A' }, owner_id: null, relations: [] });
    expect(mutations[1].path).toBe('/api/projects/proj-1/knowledge/drafts');
    expect(mutations[1].init.method).toBe('POST');
    expect(mutations[1].init.body).toMatchObject({ kind: 'decision', type: 'decision', title: '候補', content: '登録したい判断', summary: '提案', applicability: { scope: 'project', conditions: '条件A' }, owner_id: null, relations: [], source_pointer: { uri: 'https://example.test' } });
    expect(controller.state.candidate.candidate.applicability).toEqual({ conditions: '条件A' });
    expect(controller.state.candidate.draft_id).toBe('draft-1');
    const commit = await controller.commitCandidate({ type: 'decision', title: '候補', summary: '提案', scope: 'project', selection: 'create' });
    expect(mutations.at(-1).path).toBe('/api/projects/proj-1/knowledge/drafts/draft-1/save');
    expect(mutations.at(-1).init.body.revision).toBe(2);
    expect(mutations.at(-1).init.body.decision_domain).toBe('knowledge-canonical');
    expect(commit.state).toBe('verified');
    expect(controller.state.selected.id).toBe('k-1');
  });

  it('keeps capture source kind and pointer in the proposal request', async () => {
    globalThis.document = new FakeDocument();
    const mutations = [];
    const controller = createKnowledgeOutcomeController({
      root: new FakeElement('div'), project: { code: 'proj-1' }, autoLoad: false,
      api: async () => ({}),
      apiMutation: async (path, init) => { mutations.push({ path, init }); return { state: 'proposed', proposal: {} }; },
    });
    await controller.createDraft({ input_text: '判断', source: { kind: 'url', pointer: 'https://example.test/source' } });
    expect(mutations[0].init.body).toEqual({ content: '判断', source: { kind: 'url', pointer: 'https://example.test/source' } });
  });

  it('converts ontology relation meaning and target ids into backend relation objects', () => {
    globalThis.document = new FakeDocument();
    const root = new FakeElement('div');
    let submitted;
    renderCandidateReview(root, {
      state: 'candidate', proposal_applied: true, selection: 'create', decision_domains: ['knowledge-canonical'],
      input_text: '原文', candidate: { type: 'decision', title: '判断', summary: '本文', scope: 'project', decision_domain: 'knowledge-canonical' },
    }, { onCommit: (value) => { submitted = value; } });
    const controls = findAll(root, 'input');
    const relationTargets = controls.find((input) => input.attributes.name === 'relations');
    const selects = findAll(root, 'select');
    selects.find((select) => select.attributes.name === 'relation_type').value = 'references';
    relationTargets.value = 'k-1, k-2';
    findAll(root, 'button').find((button) => button.textContent === '確認して正本へ保存').dispatch('click');
    expect(submitted.relations).toEqual([
      { relation: 'references', to_id: 'k-1' },
      { relation: 'references', to_id: 'k-2' },
    ]);
  });

  it('routes reuse to the reuse endpoint with canonical id and verifies relation readback', async () => {
    globalThis.document = new FakeDocument();
    const mutations = [];
    const api = async (path) => path.endsWith('/items/k-1') ? {
      item: { id: 'k-1', version: '2', content_hash: 'sha256:ok', source: { content_state: 'fetched' }, relations: [
        { from_id: 'k-1', relation: 'references', to_id: 'k-source', payload: { section: 'intro' } },
        { from_id: 'k-1', relation: 'belongs_to_project', to_id: 'proj-1' },
      ] },
      canonical_saved: true, graph_saved: true, content_hash: 'sha256:ok',
    } : {};
    const apiMutation = async (path, init) => {
      mutations.push({ path, init });
      if (path.endsWith('/reuse')) return { canonical: { id: 'k-1', version: '2' }, expected_version: '2', canonical_content_hash: 'sha256:ok', persistence: { graph_saved: true, readback_verified: true } };
      return { draft_id: 'draft-1', revision: '2' };
    };
    const controller = createKnowledgeOutcomeController({ root: new FakeElement('div'), project: { code: 'proj-1' }, api, apiMutation, autoLoad: false, resolveDecisionDomain: () => 'knowledge-canonical' });
    controller.state.draft = { id: 'draft-1', revision: '1', input_text: '判断' };
    controller.state.candidate = { draft_id: 'draft-1', version: '1', proposal_applied: true, candidate: {} };
    const result = await controller.commitCandidate({ title: '判断', summary: '本文', scope: 'project', selection: 'reuse', canonical_id: 'k-1', canonical_version: '2', relations: [{ relation: 'references', to_id: 'k-source', payload: { section: 'intro' } }] });
    expect(mutations.at(-1).path).toBe('/api/projects/proj-1/knowledge/drafts/draft-1/reuse');
    expect(mutations.at(-1).init.body.canonical_id).toBe('k-1');
    expect(mutations.at(-1).init.body.expected_version).toBe('2');
    expect(result).toMatchObject({ state: 'verified', relations_match: true });
  });

  it('keeps a canonical save unverified when relation readback differs', async () => {
    globalThis.document = new FakeDocument();
    const api = async () => ({ item: { id: 'k-1', version: '2', content_hash: 'sha256:ok', source: { content_state: 'fetched' }, relations: [] }, canonical_saved: true, graph_saved: true, content_hash: 'sha256:ok' });
    const apiMutation = async (path) => path.endsWith('/save')
      ? { canonical: { id: 'k-1', version: '2' }, expected_version: '2', canonical_content_hash: 'sha256:ok', persistence: { event_saved: true, graph_saved: true, readback_verified: true } }
      : { draft_id: 'draft-1', revision: '2' };
    const controller = createKnowledgeOutcomeController({ root: new FakeElement('div'), project: { code: 'proj-1' }, api, apiMutation, autoLoad: false, resolveDecisionDomain: () => 'knowledge-canonical' });
    controller.state.draft = { id: 'draft-1', revision: '1', input_text: '判断' };
    controller.state.candidate = { draft_id: 'draft-1', version: '1', proposal_applied: true, candidate: {} };
    const result = await controller.commitCandidate({ title: '判断', summary: '本文', scope: 'project', selection: 'create', relations: [{ relation: 'references', to_id: 'k-source' }] });
    expect(result).toMatchObject({ state: 'saved_unverified', relations_match: false });
  });

  it('sends and renders sample answers separately from generated answers', async () => {
    globalThis.document = new FakeDocument();
    const root = new FakeElement('div');
    const mutations = [];
    const controller = createKnowledgeOutcomeController({ root, project: { code: 'proj-1' }, autoLoad: false, api: async () => ({}), apiMutation: async (path, init) => { mutations.push({ path, init }); return { isolated: true, answer: '生成回答', sample_answer: '比較回答' }; } });
    controller.state.draft = { id: 'draft-1', revision: '1', content: '判断本文' };
    controller.state.candidate = { draft_id: 'draft-1', version: '1', candidate: { title: '判断', content: '判断本文' } };
    await controller.runPreview({ question: '質問', sample_answer: '比較回答' });
    expect(mutations[0].init.body.sample_answer).toBe('比較回答');
    expect(collectText(root)).toContain('比較用の回答（実行結果とは別）');
    expect(collectText(root)).toContain('比較回答');
  });

  it('resumes a saved draft by ID and preserves its exact revision after reload', async () => {
    globalThis.document = new FakeDocument();
    const calls = [];
    const controller = createKnowledgeOutcomeController({
      root: new FakeElement('div'), project: { code: 'proj-1' }, autoLoad: false,
      api: async (path) => { calls.push(path); return { draft_id: 'draft-7', revision: 'r3', title: '保存済み判断', content: '元の入力', summary: '要旨' }; },
      apiMutation: async () => ({}),
    });
    await controller.resumeDraft('draft-7');
    expect(calls).toEqual(['/api/projects/proj-1/knowledge/drafts/draft-7']);
    expect(controller.state.draft).toMatchObject({ draft_id: 'draft-7', revision: 'r3', input_text: '元の入力' });
    expect(controller.state.candidate).toMatchObject({ draft_id: 'draft-7', version: 'r3', proposal_applied: true });
  });

  it('discards a saved draft with its revision and clears input only after success', async () => {
    globalThis.document = new FakeDocument();
    const mutations = [];
    const controller = createKnowledgeOutcomeController({ root: new FakeElement('div'), project: { code: 'proj-1' }, api: async () => ({}), apiMutation: async (path, init) => { mutations.push({ path, init }); return { status: 'discarded', revision: 'r4' }; }, autoLoad: false });
    controller.state.draft = { state: 'candidate', draft_id: 'draft-7', revision: 'r3', input_text: '元の入力' };
    controller.state.candidate = { state: 'candidate', draft_id: 'draft-7', version: 'r3', candidate: { title: '判断' } };
    await controller.discardDraft();
    expect(mutations[0]).toMatchObject({ path: '/api/projects/proj-1/knowledge/drafts/draft-7/discard', init: { method: 'POST', body: { revision: 'r3' } } });
    expect(controller.state.draft.input_text).toBe('');
    expect(controller.state.candidate.state).toBe('idle');
  });

  it('shows a project-bound resume link after save and resumes it without mutating', async () => {
    globalThis.document = new FakeDocument();
    const root = new FakeElement('div');
    const reads = []; const mutations = [];
    const location = { href: 'https://brainbase.example/app?view=outcomes' };
    const controller = createKnowledgeOutcomeController({
      root, project: { code: 'proj-1' }, location, autoLoad: false,
      api: async (path) => { reads.push(path); return { draft_id: 'draft-link', revision: 'r8', content: '再開本文', title: '再開判断' }; },
      apiMutation: async (...args) => { mutations.push(args); return { draft_id: 'draft-link', revision: 'r8' }; },
    });
    controller.state.draft = { state: 'candidate', input_text: '保存本文' };
    controller.state.candidate = { state: 'candidate', proposal_applied: true, candidate: { title: '判断' } };
    await controller.saveCandidate({ title: '判断', summary: '要旨' });
    expect(controller.state.draft.resume_url).toBe('https://brainbase.example/app?view=outcomes&knowledge_project=proj-1&knowledge_draft=draft-link');
    expect(collectText(root)).toContain('この下書きの再開リンク');

    createKnowledgeOutcomeController({
      root: new FakeElement('div'), project: { code: 'proj-1' },
      location: { href: controller.state.draft.resume_url }, autoLoad: false,
      api: async (path) => { reads.push(path); return { draft_id: 'draft-link', revision: 'r8', content: '再開本文' }; },
      apiMutation: async (...args) => { mutations.push(args); },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reads.at(-1)).toBe('/api/projects/proj-1/knowledge/drafts/draft-link');
    expect(mutations).toHaveLength(1);
  });

  it.each([
    [403, 'permission_denied', 'permission_denied'],
    [404, 'knowledge_draft_not_found', 'unknown'],
  ])('keeps current input when resume GET returns %s', async (status, code, expectedState) => {
    globalThis.document = new FakeDocument();
    const controller = createKnowledgeOutcomeController({
      root: new FakeElement('div'), project: { code: 'proj-1' }, autoLoad: false,
      api: async () => { throw Object.assign(new Error(code), { status, code }); },
      apiMutation: async () => { throw new Error('mutation must not run'); },
    });
    controller.state.draft = { state: 'idle', input_text: '消してはいけない本文', resume_id: 'draft-missing' };
    await controller.resumeDraft('draft-missing');
    expect(controller.state.draft).toMatchObject({ state: expectedState, input_text: '消してはいけない本文', resume_id: 'draft-missing' });
  });

  it('keeps saved draft input and revision when discard conflicts', async () => {
    globalThis.document = new FakeDocument();
    const conflict = Object.assign(new Error('knowledge_draft_revision_conflict'), { status: 409, code: 'knowledge_draft_revision_conflict' });
    const controller = createKnowledgeOutcomeController({ root: new FakeElement('div'), project: { code: 'proj-1' }, api: async () => ({}), apiMutation: async () => { throw conflict; }, autoLoad: false });
    controller.state.draft = { state: 'candidate', draft_id: 'draft-7', revision: 'r3', input_text: '消してはいけない入力' };
    controller.state.candidate = { state: 'candidate', draft_id: 'draft-7', version: 'r3', candidate: { title: '判断' } };
    await controller.discardDraft();
    expect(controller.state.draft).toMatchObject({ state: 'conflict', draft_id: 'draft-7', revision: 'r3', input_text: '消してはいけない入力' });
    expect(controller.state.candidate.draft_id).toBe('draft-7');
  });

  it('keeps an older or pointer-only canonical readback unverified', async () => {
    globalThis.document = new FakeDocument();
    const root = new FakeElement('div');
    let mode = 'old';
    const api = async (path) => path.endsWith('/items/k-1') ? {
      item: { id: 'k-1', version: mode === 'old' ? 'v1' : 'v2', content_hash: 'sha256:ok', source: { content_state: mode === 'old' ? 'fetched' : 'pointer_only' } },
      canonical_saved: true, graph_saved: true, content_hash: 'sha256:ok',
    } : { records: [] };
    const apiMutation = async (path) => path.endsWith('/capture/proposal')
      ? { state: 'proposed', proposal: { kind: 'decision', title: '判断', summary: '本文', scope: 'project' } }
      : path.endsWith('/drafts') ? { draft_id: 'draft-1', revision: 'd1' }
        : path.endsWith('/save') ? { canonical: { id: 'k-1', version: 'v2' }, expected_version: 'v2', canonical_content_hash: 'sha256:ok', persistence: { event_saved: true, graph_saved: true, readback_verified: true } } : { draft_id: 'draft-1', revision: 'd2' };
    const controller = createKnowledgeOutcomeController({ root, project: { code: 'proj-1' }, api, apiMutation, resolveDecisionDomain: () => 'knowledge-canonical', autoLoad: false });
    await controller.createDraft({ input_text: '登録' });
    controller.applyProposal();
    await controller.saveCandidate({ title: '判断', summary: '本文', scope: 'project' });
    expect((await controller.commitCandidate({ title: '判断', summary: '本文' })).state).toBe('saved_unverified');
    mode = 'pointer';
    expect((await controller.readbackCommit()).state).toBe('saved_unverified');
  });

  it('retries a partial save with the same body and key without patching the draft again', async () => {
    globalThis.document = new FakeDocument();
    const root = new FakeElement('div');
    const mutations = [];
    let saveAttempts = 0;
    const api = async (path) => path.endsWith('/items/k-1') ? {
      item: { id: 'k-1', version: 'v1', content_hash: 'sha256:ok', source: { content_state: 'fetched' } },
      canonical_saved: true, graph_saved: true, content_hash: 'sha256:ok',
    } : { records: [] };
    const apiMutation = async (path, init) => {
      mutations.push({ path, init });
      if (path.endsWith('/capture/proposal')) return { state: 'proposed', proposal: { kind: 'decision', title: '判断', summary: '本文', scope: 'project' } };
      if (path.endsWith('/drafts')) return { draft_id: 'draft-1', revision: 'd1' };
      if (path.endsWith('/save')) {
        saveAttempts += 1;
        if (saveAttempts === 1) throw Object.assign(new Error('upstream_unavailable'), { code: 'upstream_unavailable' });
        return { canonical: { id: 'k-1', version: 'v1' }, expected_version: 'v1', canonical_content_hash: 'sha256:ok', persistence: { event_saved: true, graph_saved: true, readback_verified: true } };
      }
      return { draft_id: 'draft-1', revision: 'd2' };
    };
    const controller = createKnowledgeOutcomeController({ root, project: { code: 'proj-1' }, api, apiMutation, resolveDecisionDomain: () => 'knowledge-canonical', autoLoad: false });
    await controller.createDraft({ input_text: '登録' });
    controller.applyProposal();
    await controller.saveCandidate({ title: '判断', summary: '本文', scope: 'project' });
    expect((await controller.commitCandidate({ title: '判断', summary: '本文' })).state).toBe('error_retryable');
    const firstSave = mutations.find((entry) => entry.path.endsWith('/save'));
    expect((await controller.retryPendingSave()).state).toBe('verified');
    const saves = mutations.filter((entry) => entry.path.endsWith('/save'));
    const patches = mutations.filter((entry) => entry.init.method === 'PATCH');
    expect(saves).toHaveLength(2);
    expect(patches).toHaveLength(1);
    expect(saves[1].init.key).toBe(firstSave.init.key);
    expect(saves[1].init.body).toEqual(firstSave.init.body);
  });

  it('keeps the patched revision and prevents a second commit while retry or verified state owns the save', async () => {
    globalThis.document = new FakeDocument();
    const root = new FakeElement('div');
    const mutations = [];
    let failSave = true;
    const api = async (path) => path.endsWith('/items/k-1') ? {
      item: { id: 'k-1', version: 'k2', content_hash: 'sha256:ok', source: { content_state: 'fetched' } },
      canonical_saved: true, graph_saved: true, content_hash: 'sha256:ok',
    } : { records: [] };
    const apiMutation = async (path, init) => {
      mutations.push({ path, init });
      if (path.endsWith('/capture/proposal')) return { state: 'proposed', proposal: { kind: 'decision', title: '判断', summary: '本文', scope: 'project' } };
      if (path.endsWith('/drafts')) return { draft_id: 'draft-1', revision: 'd1' };
      if (path.endsWith('/save')) {
        if (failSave) { failSave = false; throw Object.assign(new Error('temporary'), { code: 'upstream_unavailable' }); }
        return { canonical: { id: 'k-1', version: 'k2' }, expected_version: 'k2', canonical_content_hash: 'sha256:ok', persistence: { event_saved: true, graph_saved: true, readback_verified: true } };
      }
      return { draft_id: 'draft-1', revision: 'd2', candidate: { title: '判断', summary: '本文' } };
    };
    const controller = createKnowledgeOutcomeController({ root, project: { code: 'proj-1' }, api, apiMutation, resolveDecisionDomain: () => 'knowledge-canonical', autoLoad: false });
    await controller.createDraft({ input_text: '登録' });
    const values = { title: '判断', summary: '本文' };
    controller.applyProposal();
    await controller.saveCandidate({ ...values, scope: 'project' });
    expect((await controller.commitCandidate(values)).state).toBe('error_retryable');
    expect(controller.state.candidate.version).toBe('d2');
    expect(controller.state.draft.revision).toBe('d2');
    const countAfterFailure = mutations.length;
    expect((await controller.commitCandidate(values)).state).toBe('error_retryable');
    expect(mutations).toHaveLength(countAfterFailure);
    expect((await controller.retryPendingSave()).state).toBe('verified');
    const countAfterVerified = mutations.length;
    expect((await controller.commitCandidate(values)).state).toBe('verified');
    expect(mutations).toHaveLength(countAfterVerified);
  });

  it('keeps a revision unverified when the exact returned revision content is not read back', async () => {
    globalThis.document = new FakeDocument();
    const controller = createKnowledgeOutcomeController({
      project: { code: 'project-1' },
      root: new FakeElement('div'),
      session: { role: 'owner' },
      apiMutation: async () => ({ record: { id: 'k-1', version: 'v2', title: '判断', summary: '更新要旨', content: '更新本文', scope: 'project', owner: 'person-1', canonical_content_hash: 'sha256:v2' } }),
      api: async () => ({ item: { id: 'k-1', version: 'v2', title: '判断', summary: '更新要旨', content: '別の本文', scope: 'project', owner: 'person-1', canonical_content_hash: 'sha256:v2' } }),
      autoLoad: false,
    });
    controller.state.selected = normalizeKnowledgeItem({ id: 'k-1', version: 'v1', title: '判断', summary: '旧本文' });
    const result = await controller.reviseItem({ content: '更新本文', reason: '更新', expected_version: 'v1' });
    expect(result.state).toBe('saved_unverified');
    expect(result.expected_version).toBe('v2');
  });

  it('sends lifecycle scope, owner and validity fields and verifies their exact readback', async () => {
    globalThis.document = new FakeDocument();
    let sent;
    const revised = { id: 'k-1', version: 'v2', title: '判断', summary: '更新要旨', content: '更新本文', scope: 'organization', owner_person_id: 'person-2',
      lifecycle: { status: 'active', effective_at: '2026-09-18T00:00:00.000Z', expires_at: '2026-10-01T00:00:00.000Z' }, canonical_content_hash: 'sha256:v2' };
    const controller = createKnowledgeOutcomeController({
      project: { code: 'project-1' }, root: new FakeElement('div'), session: { role: 'owner' },
      apiMutation: async (_path, request) => { sent = request.body; return { record: revised }; },
      api: async () => ({ item: revised }), autoLoad: false,
    });
    controller.state.selected = normalizeKnowledgeItem({ id: 'k-1', version: 'v1', title: '判断', summary: '旧本文', scope: 'project', owner_person_id: 'person-1' });
    const result = await controller.reviseItem({ title: '判断', content: '更新本文', reason: '適用範囲変更', expected_version: 'v1',
      scope: 'organization', owner_person_id: 'person-2', effective_at: '2026-09-18T00:00:00.000Z', expires_at: '2026-10-01T00:00:00.000Z' });
    expect(sent).toMatchObject({ content: '更新本文', scope: 'organization', owner_person_id: 'person-2', effective_at: '2026-09-18T00:00:00.000Z', expires_at: '2026-10-01T00:00:00.000Z' });
    expect(result.state).toBe('verified');
    expect(result.item.owner).toBe('person-2');
  });

  it('keeps all revision inputs after a retryable save failure and clears them after success', async () => {
    globalThis.document = new FakeDocument();
    const root = new FakeElement('div');
    let fail = true;
    const revised = { id: 'k-1', version: 'v2', title: '変更後', content: '変更後の全文', scope: 'organization', owner_person_id: 'person-2', lifecycle: { effective_at: '2026-09-20T00:00:00.000Z', expires_at: null }, canonical_content_hash: 'sha256:v2' };
    const controller = createKnowledgeOutcomeController({
      project: { code: 'project-1', owner: { id: 'person-1', name: '佐藤' }, members: { items: [{ id: 'person-2', name: '山田' }] } }, root, session: { role: 'owner' },
      apiMutation: async () => { if (fail) throw Object.assign(new Error('temporary'), { code: 'upstream_unavailable' }); return { record: revised }; },
      api: async () => ({ item: revised }), autoLoad: false,
    });
    controller.state.selected = normalizeKnowledgeItem({ id: 'k-1', version: 'v1', title: '変更前', content: '変更前の全文', scope: 'project', owner_person_id: 'person-1' });
    const change = { title: '変更後', content: '変更後の全文', scope: 'organization', owner_person_id: 'person-2', effective_at: '2026-09-20T00:00:00.000Z', expires_at: null, reason: '更新理由', expected_version: 'v1' };
    expect((await controller.reviseItem(change)).state).toBe('error_retryable');
    const lifecycleForm = findAll(root, 'form').find((node) => node.className === 'knowledge-lifecycle-form');
    const named = (name) => [...findAll(lifecycleForm, 'input'), ...findAll(lifecycleForm, 'textarea'), ...findAll(lifecycleForm, 'select')].find((node) => node.attributes.name === name);
    expect(named('title').value).toBe('変更後');
    expect(named('content').value).toBe('変更後の全文');
    expect(named('scope').value).toBe('organization');
    expect(named('owner_person_id').value).toBe('person-2');
    expect(named('reason').value).toBe('更新理由');
    fail = false;
    expect((await controller.reviseItem(controller.state.lifecycle.revisionDraft)).state).toBe('verified');
    expect(controller.state.lifecycle).not.toHaveProperty('revisionDraft');
  });

  it('supersedes a selected listed decision and verifies both canonical records', async () => {
    globalThis.document = new FakeDocument();
    const replacement = { id: 'new', version: 'v3', title: '新判断', lifecycle: { effective_at: '2026-10-01T00:00:00.000Z' }, relations: [{ relation: 'supersedes', from_id: 'new', to_id: 'old', effective_at: '2026-10-01T00:00:00.000Z' }] };
    const superseded = { id: 'old', version: 'v5', title: '旧判断', lifecycle: { expires_at: '2026-10-01T00:00:00.000Z' }, relations: [] };
    let sent;
    const controller = createKnowledgeOutcomeController({
      project: { code: 'project-1' }, root: new FakeElement('div'), session: { role: 'owner' }, autoLoad: false,
      apiMutation: async (path, request) => { sent = { path, request }; return { status: 'superseded', replacement, superseded }; },
      api: async (path) => path.endsWith('/items/new') ? { item: replacement } : { item: superseded },
    });
    controller.state.selected = normalizeKnowledgeItem({ id: 'new', version: 'v2', title: '新判断' });
    const result = await controller.supersedeItem({ superseded_id: 'old', replacement_expected_version: 'v2', superseded_expected_version: 'v4', effective_at: '2026-10-01T00:00:00.000Z', reason: '新方針' });
    expect(sent.path).toBe('/api/projects/project-1/knowledge/items/new/supersessions');
    expect(sent.request.body).toEqual({ superseded_id: 'old', replacement_expected_version: 'v2', superseded_expected_version: 'v4', effective_at: '2026-10-01T00:00:00.000Z', reason: '新方針' });
    expect(result).toMatchObject({ state: 'verified', item_id: 'new', superseded_item_id: 'old' });
    expect(result).not.toHaveProperty('supersessionDraft');
  });

  it('keeps supersession input on failure and never offers a free-text canonical id', async () => {
    globalThis.document = new FakeDocument();
    const root = new FakeElement('div');
    const controller = createKnowledgeOutcomeController({ project: { code: 'project-1' }, root, session: { role: 'owner' }, api: async () => ({}), apiMutation: async () => { throw Object.assign(new Error('temporary'), { code: 'upstream_unavailable' }); }, autoLoad: false });
    controller.state.selected = normalizeKnowledgeItem({ id: 'new', version: 'v2', title: '新判断' });
    controller.state.list = { state: 'ready', records: [controller.state.selected, normalizeKnowledgeItem({ id: 'old', version: 'v4', title: '旧判断' })] };
    const change = { superseded_id: 'old', replacement_expected_version: 'v2', superseded_expected_version: 'v4', effective_at: '2026-10-01T00:00:00.000Z', reason: '新方針' };
    expect((await controller.supersedeItem(change)).state).toBe('error_retryable');
    const form = findAll(root, 'form').find((node) => node.className === 'knowledge-supersession-form');
    const target = findAll(form, 'select').find((node) => node.attributes.name === 'superseded_id');
    expect(target.value).toBe('old');
    expect(findAll(form, 'input').some((node) => node.attributes.name === 'superseded_id')).toBe(false);
    expect(controller.state.lifecycle.supersessionDraft).toEqual(change);
  });
});
