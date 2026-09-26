import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'vitest';

import {
  MANA_EXECUTION_PROFILES,
  OUTCOME_DELEGATION_CONTRACT_VERSION,
  completionState,
  createManaOutcomeUI,
  createManaPaths,
  executionProfileReadiness,
  normalizeApprovalTarget,
  normalizeContract,
  normalizeRun,
  profileInputValidationReasons,
  statusLabel,
  triggerLabel,
} from '../../ui/outcome-mana.js';
import { OUTCOME_MANA_VISUAL_FIXTURE } from '../outcome-mana-visual-fixture.mjs';

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.attributes = {};
    this.listeners = new Map();
    this._text = '';
    this.value = '';
    this.checked = false;
    this.disabled = false;
  }

  set textContent(value) {
    this._text = String(value ?? '');
    this.children = [];
  }

  get textContent() {
    return this._text + this.children.map((child) => child?.textContent ?? '').join('');
  }

  append(...items) {
    this.children.push(...items.filter(Boolean));
  }

  replaceChildren(...items) {
    this.children = [];
    this.append(...items);
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  hasAttribute(name) {
    return Object.hasOwn(this.attributes, name);
  }

  addEventListener(type, handler) {
    this.listeners.set(type, handler);
  }

  dispatchEvent(event) {
    this.listeners.get(event.type)?.(event);
  }

  click() {
    this.listeners.get('click')?.({ preventDefault() {} });
  }

  reportValidity() { return true; }
  focus() {}
}

const fakeDocument = {
  createElement: (tagName) => new FakeElement(tagName),
  createDocumentFragment: () => new FakeElement('fragment'),
};

function contract(status = 'draft') {
  return {
    id: 'contract-1',
    schemaVersion: OUTCOME_DELEGATION_CONTRACT_VERSION,
    version: 3,
    project: 'project-1',
    status,
    outcome: '週次レポートを保存する',
    scope: 'project-1',
    artifactDestination: { adapterId: 'drive', location: 'isolated:/reports', environment: 'isolated' },
    completionCriteria: [{ id: 'criteria-1', description: '本文を含む', kind: 'content_includes', expected: '週次' }],
    owner: { actorId: 'actor-1' },
    limits: { maxAttempts: 2, timeoutMs: 1000, budgetUnits: 10 },
  };
}

function elements(root, predicate) {
  const matches = [];
  const visit = (node) => {
    if (!node) return;
    if (predicate(node)) matches.push(node);
    node.children?.forEach(visit);
  };
  visit(root);
  return matches;
}

test('normalizes the versioned contract and keeps unknown completion unverified', () => {
  const normalized = normalizeContract({ contract: contract() });
  assert.equal(normalized.schemaVersion, OUTCOME_DELEGATION_CONTRACT_VERSION);
  assert.equal(normalized.contractId, 'contract-1');
  assert.equal(normalized.version, 3);
  assert.equal(normalized.completionCriteria[0].expected, '週次');
  assert.equal(completionState({ state: 'accepted', test_id: 'test-1' }), 'unexecuted');
  assert.equal(completionState({ run_id: 'run-1', status: 'running' }), 'completion_unverified');
  assert.equal(completionState({ run_id: 'run-1', status: 'completed_verified' }), 'completed_verified');
  assert.equal(completionState({ run_id: 'run-1', status: 'running', readback_verified: true }), 'completion_unverified');
  assert.equal(completionState({ run_id: 'run-1', status: 'failed', readback_verified: true }), 'failed');
});

test('uses only exact contract-version and profile preflight to determine execution readiness', () => {
  const profileId = 'meeting_minutes_github_v1';
  const saved = { ...contract(), version: 5, profileId };
  const matching = { run: {
    run_id: 'run-ready', contract_id: 'contract-1', contract_version: 5, profile_id: profileId,
    preflight: { available: true, checks: [] },
  } };
  const notMatching = { run: {
    run_id: 'run-stale', contract_id: 'contract-1', contract_version: 4, profile_id: profileId,
    preflight: { available: true, checks: [] },
  } };
  assert.equal(executionProfileReadiness(profileId, saved, [notMatching]).status, 'unknown');
  assert.equal(executionProfileReadiness('project_report_google_drive_v1', saved, [matching]).status, 'unknown');
  assert.equal(executionProfileReadiness(profileId, saved, [matching]).status, 'available');
  assert.equal(executionProfileReadiness(profileId, saved, [{ run: { ...matching.run, preflight: { available: false } } }]).status, 'unavailable');
  assert.equal(executionProfileReadiness(profileId, { ...saved, profileId: '' }, [matching]).status, 'unknown');
  // A profile the host does not offer has no readiness.
  assert.equal(executionProfileReadiness(profileId, saved, [matching], []).status, 'unknown');
});

test('rejects hidden incompatible resources and requires an exact GitHub commit for project reports', () => {
  const profile = MANA_EXECUTION_PROFILES.find((item) => item.id === 'project_report_google_drive_v1');
  const resources = [
    { id: 'github:repo:one', connectorId: 'github' },
    { id: 'drive:folder:one', connectorId: 'drive' },
  ];
  assert.deepEqual(
    profileInputValidationReasons(profile, [{ id: 'drive:folder:one', version: 'a'.repeat(40) }], resources),
    [
      'GitHubの接続確認済み入力資料を1つ以上選んでください。',
      '選んだ仕事で利用できない入力資料が含まれています。入力資料を選び直してください。',
    ],
  );
  assert.deepEqual(
    profileInputValidationReasons(profile, [{ id: 'github:repo:one' }], resources),
    ['プロジェクト報告のGitHub資料は40文字のコミットSHAで版を固定してください。'],
  );
  assert.deepEqual(
    profileInputValidationReasons(profile, [{ id: 'github:repo:one', version: 'a'.repeat(40) }], resources),
    [],
  );
});

test('rejects a whole repository as meeting-minutes input and directs the user to project reporting', () => {
  const profile = MANA_EXECUTION_PROFILES.find((item) => item.id === 'meeting_minutes_github_v1');
  const resources = [{ id: 'github:repo:example/meeting-notes', connectorId: 'github' }];
  assert.deepEqual(
    profileInputValidationReasons(profile, [{ id: resources[0].id, version: 'a'.repeat(40) }], resources),
    ['会議録には文字起こしファイルを選んでください。リポジトリ全体の整理には「プロジェクト報告」を選んでください。'],
  );
});

test('keeps the free-text contract form and loads no connections when no execution profiles are offered', async () => {
  const root = new FakeElement('main');
  const calls = [];
  const ui = createManaOutcomeUI({
    document: fakeDocument, root, project: { code: 'project-1' }, session: { role: 'owner' }, autoLoad: false,
    paths: { connectors: '/connectors' },
    api: async (path) => { calls.push(path); return { connectors: [] }; },
  });
  ui.state.contract.status = 'ready';
  ui.render();
  elements(root, (node) => node.textContent === '新しい委任を作成')[0].click();
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(calls, []);
  const named = (name) => elements(root, (node) => node.attributes?.name === name);
  assert.equal(named('inputRefs')[0].tagName, 'TEXTAREA');
  assert.equal(named('adapterId')[0].attributes.type, undefined);
  assert.equal(named('location').length, 1);
  assert.equal(named('profileId').length, 0);
  assert.equal(named('allowedResources').length, 0);
  assert.equal(elements(root, (node) => node.attributes?.['data-picker']).length, 0);
  assert.doesNotMatch(root.textContent, /委任する仕事/);
});

test('saves the free-text contract form without profile or allowed-resource fields', async () => {
  const bodies = [];
  const root = new FakeElement('main');
  const ui = createManaOutcomeUI({
    document: fakeDocument, root, project: { code: 'project-1' }, session: { role: 'owner' }, autoLoad: false,
    api: async () => ({ contract: { ...contract(), version: 4 } }),
    apiMutation: async (_path, request) => { bodies.push(request.body); return { contract: { ...contract(), version: 4 } }; },
  });
  ui.state.contract.status = 'ready';
  ui.state.contract.detail = normalizeContract({ contract: contract() });
  ui.state.contract.selectedId = 'contract-1';
  ui.render();
  elements(root, (node) => node.attributes?.['aria-label'] === '成果契約の下書きを保存')[0].click();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(bodies.length, 1);
  assert.equal(Object.hasOwn(bodies[0], 'profileId'), false);
  assert.equal(Object.hasOwn(bodies[0], 'allowedResources'), false);
  assert.deepEqual(bodies[0].artifactDestination, contract().artifactDestination);
});

test('keeps a registered project resource selectable while host authentication remains unconfirmed', () => {
  const root = new FakeElement('main');
  const githubProfile = MANA_EXECUTION_PROFILES[0];
  const ui = createManaOutcomeUI({
    document: fakeDocument, root, project: { code: 'project-1' }, session: { role: 'owner' }, autoLoad: false,
    executionProfiles: MANA_EXECUTION_PROFILES,
  });
  ui.state.contract.status = 'ready';
  ui.state.contract.detail = normalizeContract({ contract: { ...contract(), profileId: githubProfile.id } });
  ui.state.contract.selectedId = 'contract-1';
  ui.state.connections.records = [
    { id: 'github', label: 'GitHub', status: 'connected', resources: [{ id: 'github:repo:one', name: 'repo-one', status: 'verified' }] },
    { id: 'drive', label: 'Google Drive', status: 'unconfirmed', resources: [{ id: 'drive:folder:one', name: 'reports' }] },
  ];
  ui.state.runs.records = [normalizeRun({ run: {
    contract_id: 'contract-1', contract_version: 3, profile_id: githubProfile.id,
    preflight: { available: true, checks: [] },
  } })];
  ui.render();

  assert.match(root.textContent, /入力: この委任で選んだ会議資料 → Manaが生成: 決定事項・担当・期限をまとめた会議録 → 保存先: この契約で選ぶGitHubリポジトリ/);
  assert.match(root.textContent, /GitHub: 接続確認済み/);
  assert.match(root.textContent, /Google Drive: プロジェクト資源登録済み・接続未確認/);
  assert.match(root.textContent, /事前確認: 実行可能/);
  assert.match(root.textContent, /事前確認: 未確認/);
  const destinationRadios = elements(root, (node) => node.attributes?.['data-picker'] === 'artifact-destination');
  assert.deepEqual(destinationRadios.map((node) => node.attributes.value), ['github:repo:one', 'drive:folder:one']);
});

test('offers only the execution profiles the host passes', () => {
  const root = new FakeElement('main');
  const [onlyProfile] = MANA_EXECUTION_PROFILES;
  const ui = createManaOutcomeUI({
    document: fakeDocument, root, project: { code: 'project-1' }, session: { role: 'owner' }, autoLoad: false,
    executionProfiles: [onlyProfile],
  });
  ui.state.contract.status = 'ready';
  ui.setActiveStage('contract');

  const radios = elements(root, (node) => node.attributes?.name === 'manaExecutionProfile');
  assert.deepEqual(radios.map((node) => node.attributes.value), [onlyProfile.id]);
});

test('project report uses GitHub only for input and Google Drive only for destination', () => {
  const root = new FakeElement('main');
  const profile = MANA_EXECUTION_PROFILES.find((item) => item.id === 'project_report_google_drive_v1');
  const ui = createManaOutcomeUI({
    document: fakeDocument, root, project: { code: 'project-1' }, session: { role: 'owner' }, autoLoad: false,
    executionProfiles: MANA_EXECUTION_PROFILES,
  });
  ui.state.contract.status = 'ready';
  ui.state.contract.detail = normalizeContract({ contract: { ...contract(), profileId: profile.id } });
  ui.state.contract.selectedId = 'contract-1';
  ui.state.connections.records = [
    { id: 'github', label: 'GitHub', status: 'connected', resources: [{ id: 'github://example/project/docs/report.md', name: 'report.md', status: 'verified', version: '0123456789abcdef0123456789abcdef01234567' }] },
    { id: 'drive', label: 'Google Drive', status: 'connected', resources: [{ id: 'drive:folder:reports', name: 'reports', status: 'verified' }] },
  ];
  ui.render();

  const visibleChoices = elements(root, (node) => node.className === 'outcome-mana-resource-choice' && node.hidden !== true);
  const visibleInputs = visibleChoices.flatMap((choice) => choice.children.filter((node) => node.attributes?.['data-picker'] === 'input-reference'));
  const visibleDestinations = visibleChoices.flatMap((choice) => choice.children.filter((node) => node.attributes?.['data-picker'] === 'artifact-destination'));
  assert.deepEqual(visibleInputs.map((node) => node.attributes.value), ['github://example/project/docs/report.md']);
  assert.deepEqual(visibleDestinations.map((node) => node.attributes.value), ['drive:folder:reports']);
  assert.match(root.textContent, /0123456789abcdef0123456789abcdef01234567/);
  assert.match(root.textContent, /入力 GitHub: 接続確認済み/);
  assert.match(root.textContent, /保存先 Google Drive: 接続確認済み/);
});

test('keeps the stable resource ids from the runtime contract', () => {
  const normalized = normalizeContract({ contract: {
    ...contract(),
    allowed_resources: ['github:repo:example/project', { resource_id: 'drive:folder:reports' }],
  } });
  assert.deepEqual(normalized.allowedResources, [
    'github:repo:example/project',
    { resource_id: 'drive:folder:reports' },
  ]);
});

test('normalizes structured preflight recovery without losing reason, action, or resume point', () => {
  const normalized = normalizeRun({ run: {
    run_id: 'run-preflight', status: 'failed',
    preflight: { available: false, checks: [{
      check_id: 'artifact_adapter', status: 'failed', reason_code: 'adapter_missing',
      required_action: 'register_artifact_adapter', resume_from: 'preflight',
    }] },
  } });
  assert.deepEqual(normalized.preflight, {
    available: false,
    checks: [{
      id: 'artifact_adapter', status: 'failed', reason: 'adapter_missing',
      action: 'register_artifact_adapter', resumeFrom: 'preflight',
    }],
  });
});

test('preserves the runtime failure code and message for safe-test diagnosis', () => {
  const normalized = normalizeRun({ run: {
    run_id: 'run-failed', status: 'failed',
    error_code: 'artifact_save_failed', error_message: 'github_destination_unavailable',
  } });
  assert.equal(normalized.errorCode, 'artifact_save_failed');
  assert.equal(normalized.errorMessage, 'github_destination_unavailable');
});

test('preserves runtime failure details from the safe-test execution envelope', () => {
  const normalized = normalizeRun({
    test_id: 'test-failed', status: 'failed',
    execution: {
      runId: 'run-failed', status: 'failed',
      errorCode: 'generation_failed', errorMessage: 'invalid_profile_input',
    },
  });
  assert.equal(normalized.id, 'run-failed');
  assert.equal(normalized.errorCode, 'generation_failed');
  assert.equal(normalized.errorMessage, 'invalid_profile_input');
});

test('renders the runtime failure reason in the safe-test result', () => {
  const root = new FakeElement('main');
  const ui = createManaOutcomeUI({
    document: fakeDocument, root, project: { code: 'project-1' }, session: { role: 'owner' }, autoLoad: false,
  });
  ui.state.contract.status = 'ready';
  ui.state.contract.detail = normalizeContract({ contract: contract() });
  ui.state.safeTest.status = 'failed';
  ui.state.safeTest.result = { run: {
    run_id: 'run-failed', status: 'failed', contract_version: 2,
    error_code: 'artifact_save_failed', error_message: 'github_destination_unavailable',
  } };
  ui.render();
  assert.match(root.textContent, /artifact_save_failed/);
  assert.match(root.textContent, /github_destination_unavailable/);
});

test('renders preflight recovery as user-facing Japanese guidance', () => {
  const root = new FakeElement('main');
  const ui = createManaOutcomeUI({
    document: fakeDocument, root, project: { code: 'project-1' }, session: { role: 'owner' }, autoLoad: false,
  });
  ui.setActiveView('runs');
  ui.state.runs.status = 'ready';
  ui.state.runs.selectedId = 'run-preflight';
  ui.state.runs.detail = normalizeRun({ run: {
    run_id: 'run-preflight', status: 'failed',
    preflight: { available: false, checks: [{
      check_id: 'generator', status: 'unavailable', reason_code: 'generator_missing',
      required_action: 'configure_generator', resume_from: 'generate',
    }] },
  } });
  ui.render();
  assert.match(root.textContent, /利用不可/);
  assert.match(root.textContent, /成果を生成する機能が設定されていません/);
  assert.match(root.textContent, /生成機能を設定/);
  assert.match(root.textContent, /成果生成/);
  assert.doesNotMatch(root.textContent, /configure_generator/);
});

test('shows failed preflight checks for the same isolated test run without a new submission', () => {
  const root = new FakeElement('main');
  const ui = createManaOutcomeUI({
    document: fakeDocument, root, project: { code: 'project-1' }, session: { role: 'owner' }, autoLoad: false,
  });
  ui.setActiveView('safe_test');
  ui.state.contract.status = 'ready';
  ui.state.contract.detail = normalizeContract({ contract: contract() });
  ui.state.safeTest.status = 'failed';
  ui.state.safeTest.runId = 'run-preflight-safe';
  ui.state.safeTest.result = { run: {
    run_id: 'run-preflight-safe', status: 'failed', mode: 'safe_test', contract_version: 2,
    error_code: 'configuration_incomplete', error_message: 'preflight_failed',
    preflight: { available: false, checks: [{
      check_id: 'artifact_destination', status: 'unavailable', reason_code: 'google_drive_mcp_not_configured',
    }] },
  } };
  ui.render();
  assert.match(root.textContent, /run-preflight-safe/);
  assert.match(root.textContent, /実行前チェック/);
  assert.match(root.textContent, /artifact_destination/);
  assert.match(root.textContent, /google_drive_mcp_not_configured/);
});

test('lets a contract select only connected resources and preserves existing unknown references', () => {
  const root = new FakeElement('main');
  const ui = createManaOutcomeUI({
    document: fakeDocument, root, project: { code: 'project-1' }, session: { role: 'owner' }, autoLoad: false,
    executionProfiles: MANA_EXECUTION_PROFILES,
  });
  ui.state.contract.status = 'ready';
  ui.state.contract.detail = normalizeContract({ contract: {
    ...contract(),
    input_refs: [{ id: 'legacy:input:keep', version: 'v2' }],
    allowed_resources: ['legacy:resource:keep'],
  } });
  ui.state.contract.selectedId = 'contract-1';
  ui.state.connections.records = [
    { id: 'github', label: 'GitHub', status: 'connected', resources: [
      { id: 'github:repo:one', name: 'repo-one', status: 'verified' },
      { id: 'github:repo:hidden', name: 'repo-hidden', status: 'failed' },
    ] },
    { id: 'drive', label: 'Google Drive', status: 'unconfirmed', resources: [{ id: 'drive:folder:hidden', name: 'hidden', status: 'failed' }] },
  ];
  ui.render();

  const choices = elements(root, (node) => node.attributes['data-picker'] === 'allowed-resource');
  assert.deepEqual(choices.map((node) => node.attributes.value), ['github:repo:one']);
  const inputChoices = elements(root, (node) => node.attributes['data-picker'] === 'input-reference');
  assert.deepEqual(inputChoices.map((node) => node.attributes.value), ['github:repo:one']);
  const destinations = elements(root, (node) => node.attributes['data-picker'] === 'artifact-destination');
  assert.deepEqual(destinations.map((node) => node.attributes.value), ['github:repo:one']);
  assert.match(root.textContent, /既存の入力参照を保持（現在は未確認）: legacy:input:keep/);
  assert.match(root.textContent, /既存参照を保持（現在は未確認）: legacy:resource:keep/);
  assert.doesNotMatch(root.textContent, /drive:folder:hidden/);
  assert.doesNotMatch(root.textContent, /github:repo:hidden/);
});

test('saves an existing contract with its unlisted destination unchanged', async () => {
  const root = new FakeElement('main');
  const original = {
    ...contract(),
    profileId: 'meeting_minutes_github_v1',
    inputRefs: [{ id: 'github://example/repo/transcript.txt', version: null }],
    allowedResources: ['github:repo:example/repo'],
    artifactDestination: { adapterId: 'github', location: 'github://example/repo/meetings', environment: 'isolated' },
  };
  const mutations = [];
  const ui = createManaOutcomeUI({
    document: fakeDocument, root, project: { code: 'project-1' }, session: { role: 'owner' }, autoLoad: false,
    executionProfiles: MANA_EXECUTION_PROFILES,
    api: async () => ({ contract: { ...original, ...mutations[0], version: 4 } }),
    apiMutation: async (_path, request) => {
      mutations.push(request.body);
      return { contract: { ...original, ...request.body, version: 4 } };
    },
  });
  ui.state.contract.status = 'ready';
  ui.state.contract.detail = normalizeContract({ contract: original });
  ui.state.contract.selectedId = 'contract-1';
  ui.state.connections.records = [{ id: 'github', label: 'GitHub', status: 'connected', resources: [
    { id: 'github://example/repo/transcript.txt', adapterId: 'github', status: 'verified' },
    { id: 'github:repo:example/repo', adapterId: 'github', status: 'verified' },
  ] }];
  ui.render();

  const environment = elements(root, (node) => node.attributes?.name === 'environment')[0];
  const form = elements(root, (node) => node.attributes?.['aria-label'] === '成果契約の編集')[0];
  form.children.find = undefined; // HTMLCollection in a browser has no find method.
  environment.value = 'production';
  elements(root, (node) => node.attributes?.['aria-label'] === '成果契約の下書きを保存')[0].click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(mutations.length, 0, 'changing an unlisted destination environment must require reselecting a destination');
  assert.match(root.textContent, /GitHubの保存先を選んでください/);
  elements(root, (node) => node.attributes?.['aria-label'] === '成果契約の下書きを保存')[0].click();
  assert.equal(elements(root, (node) => node.attributes?.['data-profile-form-error'] === 'true').length, 1);
  environment.value = 'isolated';
  const timeout = elements(root, (node) => node.attributes?.name === 'timeoutMs')[0];
  timeout.value = '300000';
  elements(root, (node) => node.attributes?.['aria-label'] === '成果契約の下書きを保存')[0].click();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(mutations.length, 1);
  assert.deepEqual(mutations[0].artifactDestination, original.artifactDestination);
  assert.equal(mutations[0].profileId, 'meeting_minutes_github_v1');
  assert.deepEqual(mutations[0].allowedResources, ['github:repo:example/repo']);
  assert.equal(mutations[0].limits.timeoutMs, 300000);
  assert.equal(ui.state.contract.status, 'ready');
  assert.deepEqual(ui.state.contract.detail.artifactDestination, original.artifactDestination);
});

test('offers first authority creation only after the server confirms an explicit empty matrix', () => {
  const root = new FakeElement('main');
  const ui = createManaOutcomeUI({
    document: fakeDocument, root, project: { code: 'project-1' }, session: { role: 'owner' }, autoLoad: false,
  });
  ui.state.contract.status = 'ready';
  ui.state.contract.detail = normalizeContract({ contract: contract() });
  ui.state.contract.selectedId = 'contract-1';
  ui.state.authority = { status: 'empty', matrix: [] };
  ui.setActiveStage('authority');
  assert.match(root.textContent, /最初の権限を追加/);

  ui.state.authority = { status: 'unknown', matrix: [] };
  ui.render();
  assert.doesNotMatch(root.textContent, /最初の権限を追加/);
});

test('loads authority when the authority workflow stage is opened for the first time', async () => {
  const root = new FakeElement('main');
  const calls = [];
  const ui = createManaOutcomeUI({
    document: fakeDocument,
    root,
    project: { code: 'project-1' },
    session: { role: 'owner' },
    autoLoad: false,
    api: async (path) => {
      calls.push(path);
      return { authorities: [] };
    },
  });
  ui.state.contract.status = 'ready';
  ui.state.contract.detail = normalizeContract({ contract: contract() });
  ui.state.contract.selectedId = 'contract-1';
  ui.setActiveStage('triggers');

  const authorityStage = elements(root, (node) => node.tagName === 'BUTTON' && node.attributes['aria-label'] === '権限 / 待機中')[0];
  authorityStage.click();
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(calls, ['/api/outcome-delegations/contract-1/authority?project_code=project-1&contractVersion=3']);
  assert.equal(ui.state.authority.status, 'empty');
  assert.match(root.textContent, /最初の権限を追加/);
});

test('clears authority on contract changes and ignores a late response for the previous contract', async () => {
  const root = new FakeElement('main');
  let resolveAuthority;
  const authorityResponse = new Promise((resolve) => { resolveAuthority = resolve; });
  const ui = createManaOutcomeUI({
    document: fakeDocument,
    root,
    project: { code: 'project-1' },
    session: { role: 'owner' },
    autoLoad: false,
    api: async (path) => {
      if (path.includes('/authority')) return authorityResponse;
      const id = path.includes('contract-2') ? 'contract-2' : 'contract-1';
      return { contract: { ...contract(), contract_id: id } };
    },
  });
  ui.state.contract.status = 'ready';
  ui.state.contract.detail = normalizeContract({ contract: contract() });
  ui.state.contract.selectedId = 'contract-1';
  ui.state.authority = { status: 'ready', matrix: [{ operation: 'old-operation' }] };

  const pending = ui.loadAuthority('contract-1');
  await ui.loadContractDetail('contract-2');
  assert.equal(ui.state.authority.status, 'idle');
  assert.deepEqual(ui.state.authority.matrix, []);

  resolveAuthority({ authorities: [{ operation: 'late-operation' }] });
  await pending;
  assert.equal(ui.state.authority.status, 'idle');
  assert.deepEqual(ui.state.authority.matrix, []);
});

test('clears cached authority when the same contract id refreshes to a new version', async () => {
  const root = new FakeElement('main');
  const ui = createManaOutcomeUI({
    document: fakeDocument,
    root,
    project: { code: 'project-1' },
    session: { role: 'owner' },
    autoLoad: false,
    api: async () => ({ contract: { ...contract(), version: 4 } }),
  });
  ui.state.contract.status = 'ready';
  ui.state.contract.detail = normalizeContract({ contract: { ...contract(), version: 3 } });
  ui.state.contract.selectedId = 'contract-1';
  ui.state.authority = { status: 'ready', matrix: [{ operation: 'stale-operation' }] };

  await ui.loadContractDetail('contract-1');

  assert.equal(ui.state.contract.detail.version, 4);
  assert.equal(ui.state.authority.status, 'idle');
  assert.deepEqual(ui.state.authority.matrix, []);
});

test('does not reload or accept old authority while the selected contract detail is loading', async () => {
  const root = new FakeElement('main');
  let resolveDetail;
  let resolveAuthority;
  const detailResponse = new Promise((resolve) => { resolveDetail = resolve; });
  const authorityResponse = new Promise((resolve) => { resolveAuthority = resolve; });
  const calls = [];
  const ui = createManaOutcomeUI({
    document: fakeDocument,
    root,
    project: { code: 'project-1' },
    session: { role: 'owner' },
    autoLoad: false,
    api: async (path) => {
      calls.push(path);
      if (path.includes('/authority')) return authorityResponse;
      if (path.includes('contract-2')) return detailResponse;
      return { contract: contract() };
    },
  });
  ui.state.contract.status = 'ready';
  ui.state.contract.detail = normalizeContract({ contract: contract() });
  ui.state.contract.records = [normalizeContract({ contract: contract() }), normalizeContract({ contract: { ...contract(), contract_id: 'contract-2' } })];
  ui.state.contract.selectedId = 'contract-1';

  const oldAuthority = ui.loadAuthority('contract-1');
  const newDetail = ui.loadContractDetail('contract-2');
  ui.setActiveStage('triggers');
  const authorityStage = elements(root, (node) => node.tagName === 'BUTTON' && node.attributes['aria-label'] === '権限 / 待機中')[0];
  authorityStage.click();
  assert.equal(calls.filter((path) => path.includes('/authority')).length, 1);

  resolveAuthority({ authorities: [{ operation: 'late-operation' }] });
  await oldAuthority;
  assert.equal(ui.state.authority.status, 'idle');
  assert.deepEqual(ui.state.authority.matrix, []);

  resolveDetail({ contract: { ...contract(), contract_id: 'contract-2' } });
  await newDetail;
  assert.equal(ui.state.contract.detail.contractId, 'contract-2');
  assert.equal(ui.state.authority.status, 'idle');
});

test('ignores a late contract-detail error after a newer contract has loaded', async () => {
  const root = new FakeElement('main');
  let rejectOldDetail;
  const oldDetail = new Promise((resolve, reject) => { rejectOldDetail = reject; });
  const ui = createManaOutcomeUI({
    document: fakeDocument,
    root,
    project: { code: 'project-1' },
    session: { role: 'owner' },
    autoLoad: false,
    api: async (path) => path.includes('contract-1')
      ? oldDetail
      : { contract: { ...contract(), contract_id: 'contract-2' } },
  });
  ui.state.contract.status = 'ready';
  ui.state.contract.detail = normalizeContract({ contract: contract() });
  ui.state.contract.selectedId = 'contract-1';

  const staleRequest = ui.loadContractDetail('contract-1');
  await ui.loadContractDetail('contract-2');
  rejectOldDetail(new Error('late contract failure'));
  await staleRequest;

  assert.equal(ui.state.contract.status, 'ready');
  assert.equal(ui.state.contract.detail.contractId, 'contract-2');
  assert.equal(ui.state.contract.error, null);
});

test('ignores the first authority response after switching away and back to the same contract', async () => {
  const root = new FakeElement('main');
  let resolveFirstAuthority;
  const firstAuthority = new Promise((resolve) => { resolveFirstAuthority = resolve; });
  let authorityCalls = 0;
  const ui = createManaOutcomeUI({
    document: fakeDocument,
    root,
    project: { code: 'project-1' },
    session: { role: 'owner' },
    autoLoad: false,
    api: async (path) => {
      if (path.includes('/authority')) {
        authorityCalls += 1;
        if (authorityCalls === 1) return firstAuthority;
        return { authorities: [{ operation: 'current-operation' }] };
      }
      const id = path.includes('contract-2') ? 'contract-2' : 'contract-1';
      return { contract: { ...contract(), contract_id: id } };
    },
  });
  ui.state.contract.status = 'ready';
  ui.state.contract.detail = normalizeContract({ contract: contract() });
  ui.state.contract.selectedId = 'contract-1';

  const staleAuthority = ui.loadAuthority('contract-1');
  await ui.loadContractDetail('contract-2');
  await ui.loadContractDetail('contract-1');
  await ui.loadAuthority('contract-1');
  resolveFirstAuthority({ authorities: [{ operation: 'stale-operation' }] });
  await staleAuthority;

  assert.equal(ui.state.authority.status, 'ready');
  assert.deepEqual(ui.state.authority.matrix.map((entry) => entry.operation), ['current-operation']);
});

test('explains budget units as external provider calls rather than money', () => {
  const root = new FakeElement('main');
  const ui = createManaOutcomeUI({
    document: fakeDocument,
    root,
    project: { code: 'project-1', name: 'Project' },
    session: { role: 'owner', actorId: 'actor-1' },
    autoLoad: false,
  });
  ui.state.contract.status = 'ready';
  ui.state.contract.detail = normalizeContract({ contract: contract() });
  ui.state.contract.selectedId = 'contract-1';
  ui.render();

  assert.match(root.textContent, /外部処理の実行上限/);
  assert.match(root.textContent, /AI生成・保存・外部送信を新しく開始するたびに1回として数えます。1回の処理に含まれる保存確認などは追加で数えません。読み取り・確認、完了済み処理の再開は数えません。/);
  assert.doesNotMatch(root.textContent, /予算単位/);
  assert.doesNotMatch(root.textContent, /[¥￥$]/);
});

test('presents one active workflow stage and lets the user move between stages accessibly', () => {
  const root = new FakeElement('main');
  const ui = createManaOutcomeUI({
    document: fakeDocument,
    root,
    project: { code: 'project-1', name: 'Project' },
    session: { role: 'owner', actorId: 'actor-1' },
    autoLoad: false,
  });
  ui.state.contract.status = 'ready';
  ui.state.contract.detail = normalizeContract({ contract: contract() });
  ui.state.contract.selectedId = 'contract-1';
  ui.render();

  const stageButtons = elements(root, (node) => node.tagName === 'BUTTON' && node.attributes['aria-controls'] === 'outcome-mana-stage-workspace');
  assert.equal(stageButtons.length, 5);
  assert.equal(stageButtons.filter((node) => node.attributes['aria-current'] === 'step').length, 1);
  assert.equal(stageButtons.filter((node) => node.attributes['aria-current'] === 'false').length, 4);
  assert.equal(elements(root, (node) => node.tagName === 'SECTION' && node.attributes['data-stage'] === 'contract').length, 1);

  stageButtons.find((node) => node.textContent.includes('安全試験')).click();

  assert.equal(ui.state.activeStage, 'safe_test');
  assert.equal(elements(root, (node) => node.tagName === 'SECTION' && node.attributes['data-stage'] === 'safe_test').length, 1);
  assert.equal(elements(root, (node) => node.tagName === 'SECTION' && node.attributes['data-stage'] === 'contract').length, 0);
  assert.equal(elements(root, (node) => node.tagName === 'BUTTON' && node.attributes['aria-current'] === 'step' && node.textContent.includes('安全試験')).length, 1);
});

test('separates Mana operations into overview, connections, runs, settings, and delegation settings', async () => {
  const root = new FakeElement('main');
  const normalized = normalizeContract({ contract: { ...contract(), trigger: { type: 'manual' }, next_action: '安全試験を実行' } });
  const ui = createManaOutcomeUI({
    document: fakeDocument,
    root,
    project: {
      code: 'project-1', name: 'Project',
      connections: [{ id: 'github', status: 'active', account: 'Unson/project' }],
      mana: { settings: { defaults: { timeout: '30m' }, safety_limits: { attempts: 2 }, notifications: { channel: 'ops' }, audit: { retention: '90d' } } },
    },
    session: { role: 'owner', actorId: 'actor-1' },
    api: async (path) => path.includes('/settings')
      ? { settings: { defaults: { timeout: '30m' }, safety_limits: { attempts: 2 }, notifications: { channel: 'ops' }, audit: { retention: '90d' } } }
      : { contracts: [] },
    autoLoad: false,
  });
  ui.state.contract.status = 'ready';
  ui.state.contract.records = [normalized];
  ui.state.contract.selectedId = 'contract-1';
  ui.state.contract.detail = normalized;
  ui.render();

  const tabs = elements(root, (node) => node.tagName === 'BUTTON' && ['委任一覧', '接続状態', '実行履歴', 'Mana設定'].includes(node.textContent));
  assert.equal(tabs.length, 4);
  assert.equal(tabs.filter((node) => node.attributes['aria-current'] === 'page').length, 1);
  const runningKpi = elements(root, (node) => node.attributes['data-kpi'] === 'running-count')[0];
  assert.match(runningKpi.textContent, /未確認/);
  assert.match(root.textContent, /週次レポートを保存する/);
  assert.match(root.textContent, /次の操作: 安全試験を実行/);

  tabs.find((node) => node.textContent === '接続状態').click();
  assert.match(root.textContent, /組織接続と、選択中の委任が利用できる資源/);
  assert.match(root.textContent, /Unson\/project/);
  assert.match(root.textContent, /Google Drive[\s\S]*未確認/);
  assert.doesNotMatch(root.textContent, /Codex|Claude Code/);
  const connectorIcons = elements(root, (node) => node.tagName === 'IMG' && node.className === 'outcome-mana-connector-icon');
  assert.equal(connectorIcons.length, 6);
  assert.deepEqual(
    [...new Set(connectorIcons.map((node) => node.attributes.src))],
    [
      '/icons/mana/brand-github.svg',
      '/icons/mana/brand-google-drive.svg',
      '/icons/mana/brand-slack.svg',
      '/icons/mana/affiliate.svg',
      '/icons/mana/cpu.svg',
    ],
  );
  assert.ok(connectorIcons.every((node) => node.attributes.alt === ''));

  ui.setActiveView('runs');
  ui.loadRuns();
  assert.equal(ui.state.activeView, 'runs');
  assert.match(root.textContent, /成果生成から保存、readback、完了判定/);

  ui.setActiveView('settings');
  await ui.loadManaSettings();
  assert.match(root.textContent, /実効権限は各委任契約の版で決まります/);
  const settingsInput = (name) => elements(root, (node) => node.tagName === 'INPUT' && node.attributes.name === name)[0]?.value;
  assert.equal(settingsInput('timeout'), '30m');
  assert.equal(settingsInput('maxAttempts'), '2');
  assert.equal(settingsInput('retention'), '90d');

  ui.setActiveView('delegation_settings');
  const detailTabState = elements(root, (node) => node.tagName === 'BUTTON' && ['委任一覧', '接続状態', '実行履歴', 'Mana設定'].includes(node.textContent));
  assert.equal(detailTabState.filter((node) => node.attributes['aria-current'] === 'page').length, 1);
  assert.equal(detailTabState.find((node) => node.textContent === '委任一覧').attributes['aria-current'], 'page');
  assert.match(root.textContent, /保存、安全試験、有効化を別々に確認/);
  assert.equal(elements(root, (node) => node.tagName === 'BUTTON' && node.attributes['aria-controls'] === 'outcome-mana-stage-workspace').length, 5);
});

test('renders the five formal Mana screens against the 1586x992 structural fixture', () => {
  assert.deepEqual(OUTCOME_MANA_VISUAL_FIXTURE.viewport, { width: 1586, height: 992 });
  assert.deepEqual(OUTCOME_MANA_VISUAL_FIXTURE.screens.map((screen) => screen.id), [
    'overview', 'connections', 'settings', 'delegation', 'runs',
  ]);

  const root = new FakeElement('main');
  const normalized = normalizeContract({ contract: { ...contract(), trigger: { type: 'manual' } } });
  const run = normalizeRun({
    id: 'run-1',
    contract_id: 'contract-1',
    contract_version: 3,
    status: 'running',
    trigger: { type: 'manual' },
    config_hash: 'config-123',
    stage: 'artifact_readback',
    resume_point: 'artifact_readback',
    artifacts: [{ id: 'artifact-1', state: 'verified' }],
    artifact_readback: { state: 'verified' },
    judgment: { state: 'sufficient', reason: 'criteria matched' },
    judgment_reason: 'criteria matched',
    updated_at: '2026-09-17T10:00:00Z',
  });
  const ui = createManaOutcomeUI({
    document: fakeDocument,
    root,
    project: {
      code: 'project-1',
      name: 'Project',
      connections: [{ id: 'github', status: 'unknown', account: 'Unson/project', resources: ['repo:read'] }],
    },
    session: { role: 'owner', actorId: 'actor-1' },
    autoLoad: false,
  });
  ui.state.contract.status = 'ready';
  ui.state.contract.records = [normalized];
  ui.state.contract.selectedId = 'contract-1';
  ui.state.contract.detail = normalized;
  ui.state.runs = { status: 'ready', records: [run], selectedId: 'run-1', detail: run, error: null };
  ui.state.manaSettings = {
    status: 'ready',
    data: { defaults: { timeout: '30m' }, safety_limits: { attempts: 2 }, notifications: { channel: 'ops' }, audit: { retention: '90d' } },
    error: null,
    draft: null,
    saveStatus: 'idle',
    saveError: null,
  };

  const viewForScreen = (id) => id === 'delegation' ? 'delegation_settings' : id;
  for (const screen of OUTCOME_MANA_VISUAL_FIXTURE.screens) {
    ui.setActiveView(viewForScreen(screen.id));
    for (const selector of screen.requiredSelectors) {
      const className = selector.slice(1);
      assert.ok(elements(root, (node) => String(node.className ?? '').split(/\s+/).includes(className)).length > 0, `${screen.id} requires ${selector}`);
    }
  }
  assert.match(root.textContent, /設定ハッシュ/);
  assert.match(root.textContent, /成果物readback/);
  assert.match(root.textContent, /再開地点/);
});

test('keeps the initial contract load on the delegation overview', async () => {
  const root = new FakeElement('main');
  const ui = createManaOutcomeUI({
    document: fakeDocument,
    root,
    project: { code: 'project-1', name: 'Project' },
    session: { role: 'owner', actorId: 'actor-1' },
    api: async (path) => path.includes('/contract-1')
      ? { contract: { ...contract(), trigger: { type: 'manual' } } }
      : { contracts: [{ ...contract(), trigger: { type: 'manual' } }] },
    autoLoad: false,
  });

  await ui.loadContracts();

  assert.equal(ui.state.activeView, null);
  assert.match(root.textContent, /委任一覧/);
  assert.match(root.textContent, /週次レポートを保存する/);
});

test('shows registered foundation resources without claiming their connection is verified', () => {
  const root = new FakeElement('main');
  const ui = createManaOutcomeUI({
    document: fakeDocument,
    root,
    project: {
      code: 'project-1',
      name: 'Project',
      foundation_values: {
        github: [{ identifier: 'Unson/project' }],
        google_drive: 'drive-folder-1',
      },
    },
    session: { role: 'owner', actorId: 'actor-1' },
    autoLoad: false,
  });

  ui.setActiveView('connections');

  assert.match(root.textContent, /Unson\/project/);
  assert.match(root.textContent, /drive-folder-1/);
  assert.match(root.textContent, /GitHub[\s\S]*未確認/);
  assert.match(root.textContent, /Google Drive[\s\S]*未確認/);
});

test('checks all five Mana foundations and keeps each partial result visible', async () => {
  const root = new FakeElement('main');
  const calls = [];
  const results = {
    github: { kind: 'github', status: 'verified', resources: ['Unson/project'], verification: { state: 'verified', checked_at: '2026-09-19T12:00:00Z' } },
    drive: { status: 'unconfigured', verification: { state: 'unconfigured', reason: 'provider_check_url_missing' } },
    slack: { status: 'permission_denied', verification: { state: 'permission_denied', reason: 'provider_permission_denied' } },
    knowledge: { status: 'unregistered', verification: { state: 'unregistered', reason: 'connection_unregistered' } },
    mana: { status: 'timeout', verification: { state: 'timeout', reason: 'provider_timeout' } },
  };
  const ui = createManaOutcomeUI({
    document: fakeDocument,
    root,
    project: {
      code: 'project-1',
      foundation_values: { github: [{ identifier: 'Unson/project' }], google_drive: 'drive-folder-1' },
    },
    session: { role: 'owner', actorId: 'actor-1' },
    paths: {
      foundationCheck: (_unused, params = {}) => `/api/projects/project-1/foundations/${params.kind}/check`,
    },
    apiMutation: async (path) => {
      calls.push(path);
      const kind = path.split('/').at(-2);
      if (kind === 'github') return results[kind];
      const error = new Error('foundation check failed');
      error.status = kind === 'slack' ? 403 : 503;
      error.payload = results[kind];
      throw error;
    },
    autoLoad: false,
  });

  ui.setActiveView('connections');
  await ui.loadConnections();

  assert.deepEqual(calls, [
    '/api/projects/project-1/foundations/github/check',
    '/api/projects/project-1/foundations/drive/check',
    '/api/projects/project-1/foundations/slack/check',
    '/api/projects/project-1/foundations/knowledge/check',
    '/api/projects/project-1/foundations/mana/check',
  ]);
  assert.equal(ui.state.connections.status, 'ready');
  assert.deepEqual(ui.state.connections.records.map((item) => item.status), [
    'verified', 'unconfigured', 'permission_denied', 'unregistered', 'timeout',
  ]);
  assert.match(root.textContent, /接続確認済み/);
  assert.match(root.textContent, /確認設定なし/);
  assert.match(root.textContent, /権限不足/);
  assert.match(root.textContent, /未登録/);
  assert.match(root.textContent, /タイムアウト/);

  const connectionRows = elements(root, (node) => node.attributes.role === 'row' && node.tagName === 'BUTTON');
  connectionRows.find((node) => node.textContent.includes('Google Drive')).click();
  assert.match(root.textContent, /接続確認先のURLが設定されていません/);
  assert.doesNotMatch(root.textContent, /provider_check_url_missing/);
  connectionRows.find((node) => node.textContent.includes('Slack')).click();
  assert.match(root.textContent, /認証または権限が不足しています/);
});

test('explains that local preview results are not live connection evidence', async () => {
  const root = new FakeElement('main');
  const ui = createManaOutcomeUI({
    document: fakeDocument,
    root,
    project: { code: 'project-1' },
    paths: { foundationCheck: () => '/api/projects/project-1/foundations/github/check' },
    apiMutation: async () => {
      const error = new Error('preview only');
      error.payload = { status: 'failed', verification: { state: 'failed', reason: 'local_preview_only' } };
      throw error;
    },
    autoLoad: false,
  });

  ui.setActiveView('connections');
  await ui.loadConnections();

  assert.match(root.textContent, /ローカルプレビューでは実接続を確認できません/);
});

test('reads both the primary Drive folder and an additional artifact destination as project resources', () => {
  const root = new FakeElement('main');
  const ui = createManaOutcomeUI({
    document: fakeDocument, root,
    project: {
      code: 'project-1', name: 'Project',
      foundation_values: { drive: { identifier: 'project-root' }, drive_destination: { identifier: 'mana-output' } },
      resources: { drive: { items: [{ identifier: 'project-root', label: '共有フォルダ' }, { identifier: 'mana-output', label: 'Mana成果物' }] } },
    },
    session: { role: 'owner', actorId: 'actor-1' }, autoLoad: false,
  });
  ui.setActiveView('connections');
  assert.match(root.textContent, /共有フォルダ/);
  assert.match(root.textContent, /Mana成果物/);
});

// A host that manages connection authentication itself. It passes its own
// connector list and brand icons, reports only connection status, and names
// the source of each project resource.
const HOST_CONNECTORS = [
  { id: 'github', label: 'GitHub', description: 'コード・ドキュメントの参照', icon: '/host-icons/github.png' },
  { id: 'gmail', label: 'Gmail', description: 'メールの下書き作成', icon: '/host-icons/gmail.png' },
  { id: 'calendar', label: 'Google Calendar', description: '予定の参照', icon: '/host-icons/calendar.png' },
  { id: 'drive', label: 'Google Drive', description: 'ファイルの参照', icon: '/host-icons/drive.png' },
  { id: 'slack', label: 'Slack', description: '通知・承認・文書イベント', icon: '/host-icons/slack.png' },
  { id: 'brainbase', label: 'Brainbase Graph', description: '知識・判断の参照', icon: '/icons/mana/affiliate.svg' },
  { id: 'mana', label: 'Mana runtime', description: '委任の実行基盤', icon: '/icons/mana/cpu.svg' },
];
const HOST_CONNECTION_IDS = ['github', 'gmail', 'calendar', 'drive', 'slack'];
const HOST_CONNECTION_STATUS = [
  { id: 'github', status: 'connected', account: 'example-org' },
  { id: 'gmail', status: 'connected', account: 'owner@example.com' },
  { id: 'calendar', status: 'connected', account: 'owner@example.com' },
  { id: 'drive', status: 'connected', account: 'owner@example.com' },
  { id: 'slack', status: 'unconfirmed', reason: 'host_connection_pending' },
];

function hostCatalog(load, overrides = {}) {
  return {
    ids: HOST_CONNECTION_IDS,
    load,
    labels: { slack: 'Slack App' },
    sourceLabel: (id) => ({ github: 'GitHub App', slack: 'Slack App' })[id] ?? (HOST_CONNECTION_IDS.includes(id) ? HOST_CONNECTORS.find((item) => item.id === id).label : 'ホスト内部基盤'),
    reasonLabels: { host_connection_pending: 'ホストで接続を準備中です' },
    copy: {
      connectionsTitle: '1. チームの接続',
      connectionsDescription: 'チーム管理者が認証した外部サービスです。',
      resourcesDescription: 'チームの接続から選んだ資源です。',
      manageNote: '認証の変更はチームのアプリ管理で行います。',
      manageAction: 'アプリで接続・管理',
      noSelectableResources: 'チームの接続を先に確認してください。',
    },
    ...overrides,
  };
}

test('reads host connections separately from registered project resources', async () => {
  const root = new FakeElement('main');
  const calls = [];
  const loadContexts = [];
  let openedConnection = null;
  const ui = createManaOutcomeUI({
    document: fakeDocument,
    root,
    project: {
      code: 'project-1',
      foundation_values: { github: [{ identifier: 'example/project' }], google_drive: 'drive-folder-1' },
    },
    session: { role: 'owner', actorId: 'actor-1' },
    connectors: HOST_CONNECTORS,
    connectionCatalog: hostCatalog(async (context) => {
      loadContexts.push(context);
      calls.push('host-status');
      return HOST_CONNECTION_STATUS;
    }),
    paths: { foundationCheck: () => '/must-not-be-called' },
    apiMutation: async (path) => { calls.push(path); return {}; },
    onManageConnection: (connectorId) => { openedConnection = connectorId; },
    autoLoad: false,
  });

  ui.setActiveView('connections');
  await ui.loadConnections();

  assert.deepEqual(calls, ['host-status']);
  assert.equal(loadContexts[0].project.code, 'project-1');
  assert.equal(loadContexts[0].session.actorId, 'actor-1');
  assert.equal(ui.state.connections.status, 'ready');
  assert.deepEqual(ui.state.connections.records.map((item) => item.id), HOST_CONNECTION_IDS);
  assert.deepEqual(ui.state.connections.records.map((item) => item.status), [
    'connected', 'connected', 'connected', 'connected', 'unconfirmed',
  ]);
  assert.deepEqual(ui.state.connections.records.map((item) => item.account), [
    'example-org', 'owner@example.com', 'owner@example.com', 'owner@example.com', null,
  ]);
  assert.deepEqual(ui.state.connections.records.map((item) => item.resources.map((resource) => resource.id)), [
    ['github:repo:example/project'], [], [], ['drive:folder:drive-folder-1'], [],
  ]);
  assert.equal(ui.state.connections.records[4].label, 'Slack App');
  assert.match(root.textContent, /接続確認済み/);
  assert.match(root.textContent, /Gmail/);
  assert.match(root.textContent, /Google Calendar/);
  assert.match(root.textContent, /1\. チームの接続/);
  assert.match(root.textContent, /チーム管理者が認証した外部サービスです。/);
  assert.match(root.textContent, /2\. このプロジェクトで使う資源/);
  assert.match(root.textContent, /チームの接続から選んだ資源です。/);
  assert.match(root.textContent, /3\. 委任単位の許可範囲/);
  assert.match(root.textContent, /このプロジェクトで利用/);
  assert.match(root.textContent, /接続元GitHub App/);
  assert.match(root.textContent, /接続元ホスト内部基盤/);
  assert.match(root.textContent, /example\/project/);
  assert.match(root.textContent, /drive-folder-1/);
  assert.match(root.textContent, /owner@example\.com/);
  assert.match(root.textContent, /認証の変更はチームのアプリ管理で行います。/);
  assert.doesNotMatch(root.textContent, /1\. 接続/);
  assert.doesNotMatch(root.textContent, /確認設定なし/);
  const icons = elements(root, (node) => node.tagName === 'IMG' && node.className === 'outcome-mana-connector-icon');
  assert.deepEqual([...new Set(icons.map((node) => node.attributes.src))], HOST_CONNECTORS.map((item) => item.icon));

  elements(root, (node) => node.textContent === 'アプリで接続・管理')[0].click();
  assert.equal(openedConnection, 'github');

  const connectionRows = elements(root, (node) => node.attributes.role === 'row' && node.tagName === 'BUTTON');
  connectionRows.find((node) => node.textContent.includes('Slack App')).click();
  assert.match(root.textContent, /ホストで接続を準備中です/);
  assert.doesNotMatch(root.textContent, /host_connection_pending/);
});

test('keeps the default connection view and foundation checks without a host connection catalog', async () => {
  const root = new FakeElement('main');
  const calls = [];
  const ui = createManaOutcomeUI({
    document: fakeDocument, root, project: { code: 'project-1' }, session: { role: 'owner' },
    paths: { foundationCheck: (_unused, params = {}) => `/foundations/${params.kind}/check` },
    apiMutation: async (path) => { calls.push(path); return { status: 'verified' }; },
    onManageConnection: () => { throw new Error('must not be offered'); },
    autoLoad: false,
  });

  ui.setActiveView('connections');
  await ui.loadConnections();

  assert.equal(calls.length, 5);
  assert.match(root.textContent, /登録資源/);
  assert.doesNotMatch(root.textContent, /このプロジェクトで利用/);
  assert.doesNotMatch(root.textContent, /2\. このプロジェクトで使う資源/);
  assert.equal(elements(root, (node) => node.tagName === 'BUTTON' && node.textContent === '接続を管理').length, 0);
});

test('loads host connections before showing profile availability in a new delegation', async () => {
  const root = new FakeElement('main');
  const calls = [];
  const ui = createManaOutcomeUI({
    document: fakeDocument,
    root,
    project: {
      code: 'project-1',
      foundation_values: { github: [{ identifier: 'example/project' }], google_drive: 'drive-folder-1' },
    },
    session: { role: 'owner', actorId: 'actor-1' },
    connectors: HOST_CONNECTORS,
    connectionCatalog: hostCatalog(async () => { calls.push('host-status'); return { connections: HOST_CONNECTION_STATUS }; }),
    executionProfiles: MANA_EXECUTION_PROFILES,
    autoLoad: false,
  });
  ui.state.contract.status = 'ready';
  ui.render();

  const createButton = elements(root, (node) => node.textContent === '新しい委任を作成')[0];
  createButton.click();
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(calls, ['host-status']);
  assert.equal(ui.state.connections.status, 'ready');
  assert.match(root.textContent, /入力 GitHub: 接続確認済み/);
  assert.match(root.textContent, /保存先 Google Drive: 接続確認済み/);
  assert.doesNotMatch(root.textContent, /未登録のため利用不可/);
  const projectResources = elements(root, (node) => node.tagName === 'INPUT'
    && node.attributes.type === 'checkbox'
    && ['github:repo:example/project', 'drive:folder:drive-folder-1'].includes(node.attributes.value));
  assert.deepEqual([...new Set(projectResources.map((node) => node.attributes.value))].sort(), [
    'drive:folder:drive-folder-1',
    'github:repo:example/project',
  ]);
  assert.doesNotMatch(root.textContent, /接続済み資源がありません/);
});

test('uses the host wording when a profile form has no selectable connection resources', () => {
  const root = new FakeElement('main');
  const ui = createManaOutcomeUI({
    document: fakeDocument, root, project: { code: 'project-1' }, session: { role: 'owner' }, autoLoad: false,
    connectionCatalog: hostCatalog(async () => []),
    executionProfiles: MANA_EXECUTION_PROFILES,
  });
  ui.state.contract.status = 'ready';
  ui.setActiveStage('contract');
  assert.match(root.textContent, /チームの接続を先に確認してください。/);
  assert.doesNotMatch(root.textContent, /先に「接続状態」で接続とプロジェクト資源を確認してください。/);
});

test('keeps host connection failures unknown without inventing a verification time', async () => {
  const root = new FakeElement('main');
  const ui = createManaOutcomeUI({
    document: fakeDocument,
    root,
    project: { code: 'project-1' },
    connectors: HOST_CONNECTORS,
    connectionCatalog: hostCatalog(async () => {
      throw Object.assign(new Error('upstream unavailable'), { code: 'upstream_unavailable', status: 503 });
    }),
    autoLoad: false,
  });

  ui.setActiveView('connections');
  await ui.loadConnections();

  assert.equal(ui.state.connections.status, 'error');
  assert.deepEqual(ui.state.connections.records.map((item) => item.id), HOST_CONNECTION_IDS);
  assert.ok(ui.state.connections.records.every((item) => item.checkedAt === null && item.status === 'failed'));
  assert.equal(ui.state.connections.records[0].reason, 'upstream_unavailable');
  assert.match(root.textContent, /確認失敗/);
  assert.match(root.textContent, /未確認/);
  assert.match(root.textContent, /接続先へ到達できませんでした/);
});

test('shows host connections as unconfirmed before their status is loaded', () => {
  const root = new FakeElement('main');
  const ui = createManaOutcomeUI({
    document: fakeDocument, root, project: { code: 'project-1' }, autoLoad: false,
    connectors: HOST_CONNECTORS,
    connectionCatalog: hostCatalog(async () => HOST_CONNECTION_STATUS),
  });
  ui.setActiveView('connections');
  const rows = elements(root, (node) => node.attributes.role === 'row' && node.tagName === 'BUTTON');
  assert.equal(rows.length, HOST_CONNECTION_IDS.length);
  assert.match(root.textContent, /Slack App/);
  assert.doesNotMatch(root.textContent, /接続確認済み/);
});

test('builds the BFF-safe endpoint prefix with project query context', () => {
  const paths = createManaPaths({ projectCode: 'p/1' });
  assert.equal(paths.contractList, '/api/outcome-delegations?project_code=p%2F1');
  assert.equal(paths.settings, '/api/outcome-delegations/settings?project_code=p%2F1');
  assert.equal(paths.contractDetail('contract 1'), '/api/outcome-delegations/contract%201?project_code=p%2F1');
  assert.equal(paths.authority('contract 1', { contractVersion: 3 }), '/api/outcome-delegations/contract%201/authority?project_code=p%2F1&contractVersion=3');
  assert.equal(paths.runList('contract 1'), '/api/outcome-delegations/contract%201/runs?project_code=p%2F1');
  assert.equal(paths.runDetail('run 1'), '/api/outcome-delegations/runs/run%201?project_code=p%2F1');
  assert.equal(paths.triggerCatalog('document'), '/api/outcome-delegations/triggers?project_code=p%2F1&type=document');
});

test('Mana設定は専用APIから取得しprojectのMana参照ポインタを設定値として扱わない', async () => {
  const root = new FakeElement('main');
  const calls = [];
  const ui = createManaOutcomeUI({
    document: fakeDocument,
    root,
    project: { code: 'project-1', mana: { id: 'mana-runtime', source: 'graph' } },
    session: { role: 'owner' },
    paths: { settings: '/api/projects/project-1/delegations/settings' },
    api: async (path) => {
      calls.push(path);
      return { settings: {
        defaults: { timeout: '30m' },
        safety_limits: { attempts: 2 },
        notifications: { channel: 'ops' },
        audit: { retention: '90d' },
      } };
    },
    autoLoad: false,
  });

  assert.equal(ui.state.manaSettings.status, 'unknown');
  ui.setActiveView('settings');
  await ui.loadManaSettings();

  assert.deepEqual(calls, ['/api/projects/project-1/delegations/settings']);
  assert.equal(ui.state.manaSettings.status, 'ready');
  const inputValue = (name) => elements(root, (node) => node.tagName === 'INPUT' && node.attributes.name === name)[0]?.value;
  assert.equal(inputValue('timeout'), '30m');
  assert.equal(inputValue('retention'), '90d');
  assert.equal(elements(root, (node) => ['PRE', 'DETAILS'].includes(node.tagName)).length, 0);
});

test('Mana設定の構造化された試行回数を入力欄へ安全に表示する', async () => {
  const root = new FakeElement('main');
  const ui = createManaOutcomeUI({
    document: fakeDocument,
    root,
    project: { code: 'project-1' },
    session: { role: 'owner' },
    paths: { settings: '/api/projects/project-1/delegations/settings' },
    api: async () => ({ settings: {
      defaults: {},
      safety_limits: { attempts: { max: 3, reset: 'per_run' } },
      notifications: {},
      audit: {},
    } }),
    autoLoad: false,
  });

  ui.setActiveView('settings');
  await ui.loadManaSettings();

  const maxAttempts = elements(root, (node) => node.tagName === 'INPUT' && node.attributes.name === 'maxAttempts')[0];
  assert.equal(maxAttempts.value, '3');
  assert.doesNotMatch(root.textContent, /\[object Object\]/);
});

test('Mana設定の未知な構造を文字列化せず未確認として表示する', async () => {
  const root = new FakeElement('main');
  const ui = createManaOutcomeUI({
    document: fakeDocument,
    root,
    project: { code: 'project-1' },
    session: { role: 'owner' },
    paths: { settings: '/api/projects/project-1/delegations/settings' },
    api: async () => ({ settings: {
      defaults: {},
      safety_limits: { attempts: { policy: 'runtime_owned' } },
      notifications: {},
      audit: {},
    } }),
    autoLoad: false,
  });

  ui.setActiveView('settings');
  await ui.loadManaSettings();

  const maxAttempts = elements(root, (node) => node.tagName === 'INPUT' && node.attributes.name === 'maxAttempts')[0];
  assert.equal(maxAttempts.value, '');
  assert.doesNotMatch(root.textContent, /\[object Object\]/);
});

test('Mana設定の未知な試行回数値を空欄保存で破壊しない', async () => {
  const root = new FakeElement('main');
  const mutations = [];
  const settings = {
    defaults: {},
    safety_limits: { attempts: { max: null, policy: 'runtime_owned' } },
    notifications: {},
    audit: {},
  };
  const ui = createManaOutcomeUI({
    document: fakeDocument,
    root,
    project: { code: 'project-1' },
    session: { role: 'owner' },
    paths: {
      settings: '/api/projects/project-1/delegations/settings',
      settingsSave: '/api/projects/project-1/delegations/settings',
    },
    api: async () => ({ settings }),
    apiMutation: async (path, request) => {
      mutations.push(request.body.settings);
      return { settings: request.body.settings };
    },
    autoLoad: false,
  });

  ui.setActiveView('settings');
  await ui.loadManaSettings();
  const save = elements(root, (node) => node.tagName === 'BUTTON' && node.textContent === 'Mana設定を保存')[0];
  await save.listeners.get('click')({ preventDefault() {} });

  assert.deepEqual(mutations[0].safety_limits.attempts, { max: null, policy: 'runtime_owned' });
});

test('Mana設定APIの権限エラーを古いproject投影で隠さない', async () => {
  const root = new FakeElement('main');
  const error = new Error('forbidden');
  error.status = 403;
  const ui = createManaOutcomeUI({
    document: fakeDocument,
    root,
    project: { code: 'project-1', mana: { settings: { defaults: { timeout: 'old' } } } },
    session: { role: 'owner' },
    paths: { settings: '/api/projects/project-1/delegations/settings' },
    api: async () => { throw error; },
    autoLoad: false,
  });

  ui.setActiveView('settings');
  await ui.loadManaSettings();

  assert.equal(ui.state.manaSettings.status, 'permission_denied');
  assert.match(root.textContent, /権限がありません/);
  assert.doesNotMatch(root.textContent, /old/);
});

test('Mana設定APIが空なら古いproject投影を表示も保存もしない', async () => {
  const root = new FakeElement('main');
  const calls = [];
  const ui = createManaOutcomeUI({
    document: fakeDocument,
    root,
    project: { code: 'project-1', manaSettings: { defaults: { timeout: 'old' } } },
    session: { role: 'owner' },
    paths: {
      settings: '/api/projects/project-1/delegations/settings',
      settingsSave: '/api/projects/project-1/delegations/settings',
    },
    api: async (path, request) => {
      calls.push([path, request.method]);
      return {};
    },
    autoLoad: false,
  });

  ui.setActiveView('settings');
  await ui.loadManaSettings();

  assert.equal(ui.state.manaSettings.status, 'unknown');
  assert.match(root.textContent, /取得できるまで編集と保存はできません/);
  assert.doesNotMatch(root.textContent, /old/);
  assert.equal(elements(root, (node) => node.tagName === 'FORM').length, 0);

  await ui.saveManaSettings({ defaults: { timeout: 'overwritten' } });

  assert.deepEqual(calls, [['/api/projects/project-1/delegations/settings', 'GET']]);
  assert.equal(ui.state.manaSettings.draft, null);
  assert.equal(ui.state.manaSettings.saveStatus, 'unknown');
});

test('document trigger stays unavailable until the exact provider subscription is connected and enabled', async () => {
  const root = new FakeElement('main');
  const documentContract = { ...contract(), trigger: { type: 'document', subscriptionId: 'docusign-main', provider: 'docusign' } };
  const calls = [];
  const ui = createManaOutcomeUI({
    document: fakeDocument,
    root,
    project: { code: 'project-1', name: 'Project One' },
    session: { role: 'owner', actorId: 'actor-1' },
    api: async (path) => {
      calls.push(path);
      if (path.includes('/triggers')) return { schedules: [], subscriptions: [] };
      return { contract: documentContract };
    },
    apiMutation: async () => { throw new Error('activation_must_not_be_called'); },
    autoLoad: false,
  });
  ui.state.contract.detail = normalizeContract({ contract: documentContract });
  ui.state.contract.selectedId = 'contract-1';
  ui.state.safeTest.status = 'verified';
  ui.state.authority = { status: 'ready', matrix: [{ operation: 'write', target: 'report', policy: 'auto' }] };

  await ui.loadTriggerCatalog('document');

  assert.ok(calls.some((path) => path.includes('/triggers') && path.includes('type=document')));
  assert.match(root.textContent, /DocuSign.*購読接続が見つからないため、文書追加は利用できません/);
  const activate = elements(root, (node) => node.tagName === 'BUTTON' && node.textContent === '委任を有効化')[0];
  assert.equal(activate.disabled, true);
});

test('document trigger does not confuse a connected subscription with provider webhook readiness', async () => {
  const root = new FakeElement('main');
  const documentContract = { ...contract(), trigger: { type: 'document', subscriptionId: 'docusign-main', provider: 'docusign' } };
  const ui = createManaOutcomeUI({
    document: fakeDocument, root, project: { code: 'project-1' }, session: { role: 'owner' }, autoLoad: false,
    api: async () => ({ schedules: [], subscriptions: [{ id: 'docusign-main', provider: 'docusign', connected: true, enabled: true, source: 'document-ingestion', available: false, reason: 'document_event_authenticator_missing' }] }),
  });
  ui.state.contract.detail = normalizeContract({ contract: documentContract });
  ui.state.contract.selectedId = 'contract-1';
  ui.state.safeTest.status = 'verified';
  ui.state.authority = { status: 'ready', matrix: [{ operation: 'write', target: 'report', policy: 'auto' }] };

  await ui.loadTriggerCatalog('document');

  assert.match(root.textContent, /DocuSign.*文書イベントの署名検証が未接続のため、文書追加は利用できません/);
  assert.doesNotMatch(root.textContent, /利用準備確認済み/);
  const activate = elements(root, (node) => node.tagName === 'BUTTON' && node.textContent === '委任を有効化')[0];
  assert.equal(activate.disabled, true);
});

test('document trigger becomes activatable only after runtime reports provider readiness', async () => {
  const root = new FakeElement('main');
  const documentContract = { ...contract(), trigger: { type: 'document', subscriptionId: 'drive-main', provider: 'drive' } };
  const ui = createManaOutcomeUI({
    document: fakeDocument, root, project: { code: 'project-1' }, session: { role: 'owner' }, autoLoad: false,
    api: async () => ({ schedules: [], subscriptions: [{ id: 'drive-main', provider: 'drive', connected: true, enabled: true, available: true, source: 'document-ingestion' }] }),
  });
  ui.state.contract.detail = normalizeContract({ contract: documentContract });
  ui.state.contract.selectedId = 'contract-1';
  ui.state.safeTest.status = 'verified';
  ui.state.authority = { status: 'ready', matrix: [{ operation: 'write', target: 'report', policy: 'auto' }] };

  await ui.loadTriggerCatalog('document');

  assert.match(root.textContent, /利用準備確認済み/);
  const activate = elements(root, (node) => node.tagName === 'BUTTON' && node.textContent === '委任を有効化')[0];
  assert.equal(activate.disabled, false);
});

test('activation stays blocked when authority readback is unknown even after a verified safe test', async () => {
  const root = new FakeElement('main');
  let mutations = 0;
  const ui = createManaOutcomeUI({
    document: fakeDocument, root, project: { code: 'project-1' }, session: { role: 'owner' }, autoLoad: false,
    apiMutation: async () => { mutations += 1; return {}; },
  });
  ui.state.contract.detail = normalizeContract({ contract: { ...contract(), trigger: { type: 'manual' } } });
  ui.state.contract.selectedId = 'contract-1';
  ui.state.safeTest.status = 'verified';
  ui.state.authority = { status: 'unknown', matrix: [] };
  ui.render();

  const activate = elements(root, (node) => node.tagName === 'BUTTON' && node.textContent === '委任を有効化')[0];
  assert.equal(activate.disabled, true);
  assert.match(root.textContent, /有効化前に権限マトリクスのreadbackを確認してください/);
  await ui.activate('contract-1');
  assert.equal(mutations, 0);
  assert.match(root.textContent, /権限マトリクスを確認できていないため、委任を有効化できません/);
});

test('verified activation readback replaces draft status in both detail and contract list', async () => {
  const root = new FakeElement('main');
  const draft = normalizeContract({ contract: { ...contract('draft'), trigger: { type: 'manual' } } });
  const active = { ...contract('active'), version: 4, trigger: { type: 'manual' } };
  const ui = createManaOutcomeUI({
    document: fakeDocument, root, project: { code: 'project-1' }, session: { role: 'owner' }, autoLoad: false,
    apiMutation: async () => ({ contract: active, readback_verified: true }),
  });
  ui.state.contract.detail = draft;
  ui.state.contract.records = [draft];
  ui.state.contract.selectedId = 'contract-1';
  ui.state.safeTest.status = 'verified';
  ui.state.authority = { status: 'ready', matrix: [{ operation: 'write', target: 'report', policy: 'auto' }] };

  const result = await ui.activate('contract-1');

  assert.equal(result.status, 'verified');
  assert.equal(ui.state.contract.detail.status, 'active');
  assert.equal(ui.state.contract.records[0].status, 'active');
  assert.match(root.textContent, /有効化済み/);

  ui.setActiveStage('contract');
  assert.match(root.textContent, /v4有効/);

  ui.setActiveStage('triggers');
  assert.match(root.textContent, /起動条件と有効化.*有効/s);
  assert.doesNotMatch(root.textContent, /v4下書き/);
});

for (const [reason, expectedMessage] of [
  ['document_subscription_connection_unavailable', /drive.*購読接続を確認できないため、文書追加は利用できません/],
  ['document_subscription_disabled', /drive.*購読接続が無効なため、文書追加は利用できません/],
]) {
  test(`document trigger exposes runtime unavailability reason: ${reason}`, async () => {
    const root = new FakeElement('main');
    const documentContract = { ...contract(), trigger: { type: 'document', subscriptionId: 'drive-main', provider: 'drive' } };
    const disconnected = reason === 'document_subscription_connection_unavailable';
    const ui = createManaOutcomeUI({
      document: fakeDocument, root, project: { code: 'project-1' }, session: { role: 'owner' }, autoLoad: false,
      api: async () => ({ schedules: [], subscriptions: [{
        id: 'drive-main', provider: 'drive', connected: !disconnected, enabled: disconnected,
        available: false, reason, source: 'document-ingestion',
      }] }),
    });
    ui.state.contract.detail = normalizeContract({ contract: documentContract });
    ui.state.contract.selectedId = 'contract-1';
    ui.state.safeTest.status = 'verified';

    await ui.loadTriggerCatalog('document');

    assert.match(root.textContent, expectedMessage);
    const activate = elements(root, (node) => node.tagName === 'BUTTON' && node.textContent === '委任を有効化')[0];
    assert.equal(activate.disabled, true);
  });
}

test('GitHub document trigger explains webhook credential setup without exposing runtime details', async () => {
  const root = new FakeElement('main');
  const reason = 'github_document_ingress_credentials_missing';
  const webhookSecret = 'github-webhook-secret-must-not-render';
  const documentContract = { ...contract(), trigger: { type: 'document', subscriptionId: 'github-main', provider: 'github' } };
  const ui = createManaOutcomeUI({
    document: fakeDocument, root, project: { code: 'project-1' }, session: { role: 'owner' }, autoLoad: false,
    api: async () => ({ schedules: [], subscriptions: [{
      id: 'github-main', provider: 'github', connected: true, enabled: true, available: false,
      reason, webhookSecret, source: 'document-ingestion',
    }] }),
    apiMutation: async () => { throw new Error('activation_must_not_be_called'); },
  });
  ui.state.contract.detail = normalizeContract({ contract: documentContract });
  ui.state.contract.selectedId = 'contract-1';
  ui.state.safeTest.status = 'verified';

  await ui.loadTriggerCatalog('document');

  assert.match(root.textContent, /GitHubの文書取り込み用Webhook認証情報が未設定のため、文書追加は利用できません。Webhook用認証情報を設定するか、管理者に確認してください。/);
  assert.doesNotMatch(root.textContent, new RegExp(reason));
  assert.doesNotMatch(root.textContent, new RegExp(webhookSecret));
  const activate = elements(root, (node) => node.tagName === 'BUTTON' && node.textContent === '委任を有効化')[0];
  assert.equal(activate.disabled, true);
});

test('GitHub document trigger explains repository and callback configuration without exposing runtime details', async () => {
  const root = new FakeElement('main');
  const reason = 'github_document_ingress_configuration_missing';
  const documentContract = { ...contract(), trigger: { type: 'document', subscriptionId: 'github-main', provider: 'github' } };
  const ui = createManaOutcomeUI({
    document: fakeDocument, root, project: { code: 'project-1' }, session: { role: 'owner' }, autoLoad: false,
    api: async () => ({ schedules: [], subscriptions: [{
      id: 'github-main', provider: 'github', connected: true, enabled: true, available: false,
      reason, repository: 'acme/docs', ref: 'main', path: '/docs', callbackProvider: 'brainbase',
      source: 'document-ingestion',
    }] }),
    apiMutation: async () => { throw new Error('activation_must_not_be_called'); },
  });
  ui.state.contract.detail = normalizeContract({ contract: documentContract });
  ui.state.contract.selectedId = 'contract-1';
  ui.state.safeTest.status = 'verified';

  await ui.loadTriggerCatalog('document');

  assert.match(root.textContent, /GitHubのリポジトリ・参照先・取り込みパス・コールバック先の設定が未設定または不正なため、文書追加は利用できません。リポジトリ、参照先、取り込みパス、コールバック先を確認してください。/);
  assert.doesNotMatch(root.textContent, new RegExp(reason));
  assert.doesNotMatch(root.textContent, /github_document_ingress_credentials_missing/);
  assert.doesNotMatch(root.textContent, /認証情報が未設定/);
  const activate = elements(root, (node) => node.tagName === 'BUTTON' && node.textContent === '委任を有効化')[0];
  assert.equal(activate.disabled, true);
});

test('document trigger explains delegated scope mismatch without exposing runtime identifiers', async () => {
  const root = new FakeElement('main');
  const reason = 'document_subscription_scope_mismatch';
  const tenantId = 'tenant-secret-must-not-render';
  const principalId = 'principal-secret-must-not-render';
  const documentContract = { ...contract(), trigger: { type: 'document', subscriptionId: 'github-main', provider: 'github' } };
  const ui = createManaOutcomeUI({
    document: fakeDocument, root, project: { code: 'project-1' }, session: { role: 'owner' }, autoLoad: false,
    api: async () => ({ schedules: [], subscriptions: [{
      id: 'github-main', provider: 'github', connected: true, enabled: true, available: false,
      reason, tenantId, principalId, source: 'document-ingestion',
    }] }),
    apiMutation: async () => { throw new Error('activation_must_not_be_called'); },
  });
  ui.state.contract.detail = normalizeContract({ contract: documentContract });
  ui.state.contract.selectedId = 'contract-1';
  ui.state.safeTest.status = 'verified';

  await ui.loadTriggerCatalog('document');

  assert.match(root.textContent, /この接続の組織・プロジェクト・実行者が現在の委任と一致しないため利用できません。委任に対応する接続を選択してください。/);
  assert.doesNotMatch(root.textContent, new RegExp(reason));
  assert.doesNotMatch(root.textContent, new RegExp(tenantId));
  assert.doesNotMatch(root.textContent, new RegExp(principalId));
  assert.doesNotMatch(root.textContent, /未設定|不正/);
  const activate = elements(root, (node) => node.tagName === 'BUTTON' && node.textContent === '委任を有効化')[0];
  assert.equal(activate.disabled, true);
});

test('trigger save renders the read-back contract version and document availability', async () => {
  const root = new FakeElement('main');
  const ui = createManaOutcomeUI({
    document: fakeDocument, root, project: { code: 'project-1' }, session: { role: 'owner' }, autoLoad: false,
    api: async () => ({ schedules: [], subscriptions: [{
      id: 'github-main', provider: 'github', connected: true, enabled: true, available: false,
      reason: 'document_subscription_scope_mismatch', source: 'document-ingestion',
    }] }),
    apiMutation: async () => ({
      contract: { ...contract(), version: 4, trigger: { type: 'document', subscriptionId: 'github-main', provider: 'github' } },
      readback_verified: true,
    }),
  });
  ui.state.contract.detail = normalizeContract({ contract: contract() });
  ui.state.contract.selectedId = 'contract-1';
  ui.state.safeTest.status = 'verified';

  await ui.saveTriggers({ type: 'document', subscriptionId: 'github-main', provider: 'github' });

  assert.equal(ui.state.contract.detail.version, 4);
  assert.equal(ui.state.contract.detail.trigger.type, 'document');
  assert.match(root.textContent, /この接続の組織・プロジェクト・実行者が現在の委任と一致しないため利用できません/);
  const activate = elements(root, (node) => node.tagName === 'BUTTON' && node.textContent === '委任を有効化')[0];
  assert.equal(activate.disabled, true);
});

test('document trigger stays unavailable when the runtime catalog cannot be read', async () => {
  const root = new FakeElement('main');
  const documentContract = { ...contract(), trigger: { type: 'document', subscriptionId: 'drive-main', provider: 'drive' } };
  const error = Object.assign(new Error('mana catalog offline'), { code: 'upstream_unavailable' });
  const ui = createManaOutcomeUI({
    document: fakeDocument, root, project: { code: 'project-1' }, session: { role: 'owner' }, autoLoad: false,
    api: async () => { throw error; },
    apiMutation: async () => { throw new Error('activation_must_not_be_called'); },
  });
  ui.state.contract.detail = normalizeContract({ contract: documentContract });
  ui.state.contract.selectedId = 'contract-1';
  ui.state.safeTest.status = 'verified';

  await ui.loadTriggerCatalog('document');

  assert.equal(ui.state.triggers.catalogError?.code, 'upstream_unavailable');
  assert.match(root.textContent, /接続候補を確認できていないため、この起動方式は利用できません/);
  const activate = elements(root, (node) => node.tagName === 'BUTTON' && node.textContent === '委任を有効化')[0];
  assert.equal(activate.disabled, true);
});

test('reads authority and runs from the selected contract and verifies an exact authority save', async () => {
  const calls = [];
  const authorities = [{ operation: 'write', resource: 'report', effect: 'approval', actorId: 'actor-1' }];
  const controller = createManaOutcomeUI({
    document: fakeDocument,
    root: new FakeElement('div'),
    project: { code: 'project-1', name: 'Project' },
    session: { actorId: 'actor-1', role: 'owner' },
    paths: {
      contractList: '/contracts', contractDetail: (id) => `/contracts/${id}`,
      authority: (id, params) => `/contracts/${id}/authority?contractVersion=${params.contractVersion}`,
      runList: (id) => `/contracts/${id}/runs`,
    },
    api: async (path) => {
      calls.push(['GET', path]);
      if (path.includes('/authority')) return { authorities };
      if (path.endsWith('/runs')) return { runs: [{ id: 'run-1', contract_id: 'contract-1', contract_version: 3, status: 'running' }] };
      return { contract: contract() };
    },
    apiMutation: async (path, request) => { calls.push(['PUT', path, request.body]); return { ok: true }; },
    autoLoad: false,
  });
  // Authority is version-bound, so it is read only for a contract detail that
  // has finished loading.
  controller.state.contract.status = 'ready';
  controller.state.contract.detail = normalizeContract({ contract: contract() });
  controller.state.contract.selectedId = 'contract-1';
  const authorityReadback = await controller.loadAuthority();
  assert.equal(authorityReadback.state, 'ready');
  assert.equal(authorityReadback.status, 'ready');
  assert.equal((await controller.saveAuthority(authorities)).status, 'ready');
  assert.equal((await controller.loadRuns()).records[0].id, 'run-1');
  const authorityWrite = calls.find(([method]) => method === 'PUT');
  assert.equal(authorityWrite[2].actorId, undefined);
  assert.ok(calls.some(([method, path]) => method === 'GET' && path === '/contracts/contract-1/authority?contractVersion=3'));
  assert.ok(calls.some(([method, path]) => method === 'GET' && path === '/contracts/contract-1/runs'));
});

test('uses injected API callbacks and never treats an unexecuted safe test as success', async () => {
  const root = new FakeElement('main');
  const calls = [];
  const api = async (path, request) => {
    calls.push({ kind: 'api', path, request });
    if (path.includes('/runs/')) return { run: { id: 'run-1', status: 'waiting_approval', contract_id: 'contract-1', contract_version: 3,
      pending_approval: { approval_id: 'approval-1', operation: 'send', resource: 'weekly-report', payload_hash: 'sha256:abc', destination: 'slack:#reports', contract_version: 3, expires_at: '2026-09-18T00:00:00.000Z', diff: '週次レポートを1件送信' } } };
    if (path.includes('/contract-1')) return { contract: contract() };
    return { contracts: [contract()] };
  };
  const apiMutation = async (path, request) => {
    calls.push({ kind: 'mutation', path, request });
    if (path.includes('/tests')) return { test_id: 'test-1', state: 'accepted' };
    return { run: { id: 'run-1', status: 'running' }, readback_verified: true };
  };
  const ui = createManaOutcomeUI({
    document: fakeDocument,
    root,
    project: { code: 'project-1', name: 'Project One' },
    session: { role: 'owner', actorId: 'actor-1' },
    api,
    apiMutation,
    autoLoad: false,
  });

  await ui.loadContracts();
  const result = await ui.runSafeTest({ contractVersion: 3, sampleInput: 'sample' }, 'contract-1');
  assert.equal(result.status, 'unexecuted');
  assert.match(root.textContent, /成功とは扱いません/);
  const testCall = calls.find((call) => call.kind === 'mutation' && call.path.includes('/tests'));
  assert.deepEqual(testCall.request.body, {
    contract_version: 3,
    sample_input: 'sample',
    mode: 'isolated',
    external_send: false,
    production_writes: false,
  });

  await ui.loadRunDetail('run-1');
  await ui.approveRun('run-1');
  const decisionCall = calls.find((call) => call.kind === 'mutation' && call.path.includes('/decisions'));
  assert.equal(decisionCall.request.body.decision, 'approve');
  assert.equal(decisionCall.request.body.approvalId, 'approval-1');
  assert.equal(decisionCall.request.body.expected_version, undefined);
});

test('safe test follows one accepted run to a terminal result without another POST', async () => {
  const timers = [];
  const calls = [];
  let status = 'running';
  const ui = createManaOutcomeUI({
    document: fakeDocument, root: new FakeElement('main'), project: { code: 'project-1' },
    session: { role: 'owner' }, autoLoad: false,
    setTimeout: (callback) => { timers.push(callback); return timers.length; },
    clearTimeout: () => {},
    api: async (path) => {
      calls.push(['GET', path]);
      return { run: { runId: 'run-safe-1', contractId: 'contract-1', mode: 'safe_test', status,
        safeTest: { configHash: 'sha256:same', currentConfigHash: 'sha256:same' } } };
    },
    apiMutation: async (path) => { calls.push(['POST', path]); return { run: { runId: 'run-safe-1', status: 'queued' } }; },
  });
  ui.state.contract.detail = normalizeContract({ contract: contract() });
  ui.state.contract.selectedId = 'contract-1';
  await ui.runSafeTest({ contractVersion: 3, sampleInput: 'sample' });
  assert.equal(ui.state.safeTest.status, 'completion_unverified');
  assert.equal(timers.length, 1);
  status = 'completed_verified';
  await timers.shift()();
  assert.equal(ui.state.safeTest.status, 'verified');
  assert.equal(timers.length, 0);
  assert.equal(calls.filter(([method]) => method === 'POST').length, 1);
  assert.deepEqual(calls.filter(([method]) => method === 'GET').map(([, path]) => path),
    ['/api/outcome-delegations/runs/run-safe-1?project_code=project-1', '/api/outcome-delegations/runs/run-safe-1?project_code=project-1']);
});

test('safe test restores its scoped run ID and readback never creates a second test', async () => {
  const saved = new Map();
  const storage = {
    getItem: (key) => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, value),
  };
  let posts = 0;
  const options = {
    document: fakeDocument, root: new FakeElement('main'), project: { code: 'project-1' },
    session: { role: 'owner', actorId: 'actor-1' }, autoLoad: false, sessionStorage: storage,
    setTimeout: () => 1, clearTimeout: () => {},
    api: async (path) => path.includes('/runs/run-safe-1')
      ? { run: { runId: 'run-safe-1', contractId: 'contract-1', mode: 'safe_test', status: 'failed', errorCode: 'test_failed' } }
      : { contract: contract() },
    apiMutation: async () => { posts += 1; return { run: { runId: 'run-safe-1', status: 'queued' } }; },
  };
  const first = createManaOutcomeUI(options);
  first.state.contract.detail = normalizeContract({ contract: contract() });
  first.state.contract.selectedId = 'contract-1';
  await first.runSafeTest({ contractVersion: 3, sampleInput: 'sample' });
  const second = createManaOutcomeUI(options);
  await second.loadContractDetail('contract-1');
  assert.equal(second.state.safeTest.status, 'failed');
  await second.refreshSafeTestReadback();
  second.setActiveStage('safe_test');
  assert.equal(posts, 1);
  assert.match(options.root.textContent, /test_failed/);

  const otherProject = createManaOutcomeUI({ ...options, project: { code: 'project-2' } });
  await otherProject.loadContractDetail('contract-1');
  assert.equal(otherProject.state.safeTest.runId, null);
  const otherActor = createManaOutcomeUI({ ...options, session: { role: 'owner', actorId: 'actor-2' } });
  await otherActor.loadContractDetail('contract-1');
  assert.equal(otherActor.state.safeTest.runId, null);
});

test('safe test keeps the accepted ID but stops automatic readback on a GET failure', async () => {
  let posts = 0;
  const timers = [];
  const root = new FakeElement('main');
  let failReadback = true;
  const ui = createManaOutcomeUI({
    document: fakeDocument, root, project: { code: 'project-1' },
    session: { role: 'owner' }, autoLoad: false,
    setTimeout: (callback) => { timers.push(callback); return timers.length; }, clearTimeout: () => {},
    api: async () => {
      if (failReadback) throw Object.assign(new Error('readback unavailable'), { code: 'upstream_unavailable', status: 503 });
      return { run: { runId: 'run-safe-1', contractId: 'contract-1', mode: 'safe_test', status: 'failed', errorCode: 'test_failed' } };
    },
    apiMutation: async () => { posts += 1; return { run: { runId: 'run-safe-1', status: 'queued' } }; },
  });
  ui.state.contract.detail = normalizeContract({ contract: contract() });
  ui.state.contract.selectedId = 'contract-1';
  await ui.runSafeTest({ contractVersion: 3, sampleInput: 'sample' });
  assert.equal(ui.state.safeTest.runId, 'run-safe-1');
  assert.equal(ui.state.safeTest.status, 'unknown');
  assert.equal(timers.length, 0);
  assert.match(root.textContent, /upstream_unavailable/);
  assert.match(root.textContent, /503/);
  assert.match(root.textContent, /readback unavailable/);
  failReadback = false;
  await ui.refreshSafeTestReadback();
  assert.equal(posts, 1);
  assert.equal(ui.state.safeTest.status, 'failed');
  assert.equal(ui.state.safeTest.error, null);
  assert.match(root.textContent, /test_failed/);
});

test('binds the safe-test success label and activation gate to the server configuration hash', async () => {
  const root = new FakeElement('main');
  let currentHash = 'sha256:settings-v3';
  const ui = createManaOutcomeUI({
    document: fakeDocument,
    root,
    project: { code: 'project-1', name: 'Project One' },
    session: { role: 'owner', actorId: 'actor-1' },
    api: async (path) => path.includes('/runs/') ? { run: {
      runId: 'run-safe-1', contractId: 'contract-1', contractVersion: 3,
      mode: 'safe_test', status: 'completed_verified',
      safeTest: {
        configSnapshot: { outcome: '週次レポートを保存する' },
        configHash: 'sha256:settings-v3', currentConfigHash: currentHash,
        retestRequired: currentHash !== 'sha256:settings-v3',
        retestReason: currentHash !== 'sha256:settings-v3' ? 'configuration_changed' : null,
      },
    } } : { contract: contract() },
    apiMutation: async () => ({ run: { runId: 'run-safe-1', status: 'queued' } }),
    autoLoad: false,
  });
  ui.state.contract.detail = normalizeContract({ contract: contract() });
  ui.state.contract.selectedId = 'contract-1';

  await ui.runSafeTest({ contractVersion: 3, sampleInput: 'sample' }, 'contract-1');
  assert.equal(ui.state.safeTest.status, 'verified');
  assert.match(root.textContent, /この設定で試験済み/);
  assert.doesNotMatch(root.textContent, /設定変更のため再試験が必要/);

  ui.state.contract.detail = normalizeContract({ contract: { ...contract(), version: 4 } });
  ui.render();
  assert.match(root.textContent, /この設定で試験済み/);

  currentHash = 'sha256:settings-v4';
  await ui.runSafeTest({ contractVersion: 3, sampleInput: 'sample' }, 'contract-1');
  assert.equal(ui.state.safeTest.status, 'stale');
  assert.match(root.textContent, /設定変更のため再試験が必要/);
  assert.doesNotMatch(root.textContent, /この設定で試験済み/);

  ui.setActiveStage('triggers');
  assert.match(root.textContent, /有効化前に隔離試験を実行/);
});

test('explains when a verified safe-test readback omits the server configuration hash', async () => {
  const root = new FakeElement('main');
  const ui = createManaOutcomeUI({
    document: fakeDocument, root, project: { code: 'project-1' }, session: { role: 'owner' }, autoLoad: false,
    api: async () => ({ run: {
      runId: 'run-safe-no-hash', contractId: 'contract-1', contractVersion: 3,
      mode: 'safe_test', status: 'completed_verified',
      safeTest: { retestRequired: true, retestReason: 'configuration_snapshot_missing' },
    } }),
    apiMutation: async () => ({ run: { runId: 'run-safe-no-hash', status: 'queued' } }),
  });
  ui.state.contract.detail = normalizeContract({ contract: contract() });
  ui.state.contract.selectedId = 'contract-1';

  const result = await ui.runSafeTest({ contractVersion: 3, sampleInput: 'sample' }, 'contract-1');
  assert.equal(result.status, 'configuration_snapshot_missing');
  assert.doesNotMatch(root.textContent, /この設定で試験済み/);
  assert.match(root.textContent, /試験時の設定記録が不足/);
  assert.match(root.textContent, /再試験が必要/);
});

test('explains a safe-test whose completion is still unverified', async () => {
  const root = new FakeElement('main');
  const ui = createManaOutcomeUI({
    document: fakeDocument, root, project: { code: 'project-1' }, session: { role: 'owner' }, autoLoad: false,
    api: async () => ({ run: {
      runId: 'run-safe-unverified', contractId: 'contract-1', contractVersion: 3,
      mode: 'safe_test', status: 'completion_unverified',
      safeTest: { configHash: 'sha256:same', currentConfigHash: 'sha256:same' },
    } }),
    apiMutation: async () => ({ run: { runId: 'run-safe-unverified', status: 'queued' } }),
  });
  ui.state.contract.detail = normalizeContract({ contract: contract() });
  ui.state.contract.selectedId = 'contract-1';

  const result = await ui.runSafeTest({ contractVersion: 3, sampleInput: 'sample' }, 'contract-1');
  assert.equal(result.status, 'completion_unverified');
  assert.doesNotMatch(root.textContent, /この設定で試験済み/);
  assert.match(root.textContent, /完了条件の検証結果を確認できていません/);
});

test('shows the raw safe-test state and diagnostic fields without another POST', async () => {
  const root = new FakeElement('main');
  let posts = 0;
  let readbackState = 'running';
  const ui = createManaOutcomeUI({
    document: fakeDocument, root, project: { code: 'project-1' }, session: { role: 'owner' }, autoLoad: false,
    setTimeout: () => 1, clearTimeout: () => {},
    api: async () => ({ run: {
      runId: 'run-safe-diagnostic', contractId: 'contract-1', contractVersion: 3,
      mode: 'safe_test', status: readbackState, stage: 'generate',
      errorCode: readbackState === 'completion_unverified' ? 'completion_not_verified' : '',
      errorMessage: readbackState === 'completion_unverified' ? 'artifact_readback_missing' : '',
    } }),
    apiMutation: async () => { posts += 1; return { run: { runId: 'run-safe-diagnostic', status: 'queued' } }; },
  });
  ui.state.contract.detail = normalizeContract({ contract: contract() });
  ui.state.contract.selectedId = 'contract-1';

  await ui.runSafeTest({ contractVersion: 3, sampleInput: 'sample' }, 'contract-1');
  assert.match(root.textContent, /Mana実行状態実行中/);
  assert.match(root.textContent, /現在の段階成果生成/);
  readbackState = 'completion_unverified';
  await ui.refreshSafeTestReadback();
  assert.match(root.textContent, /Mana実行状態完了未確認/);
  assert.match(root.textContent, /completion_not_verified/);
  assert.match(root.textContent, /artifact_readback_missing/);
  assert.equal(posts, 1);
});

test('shows Mana criteria and artifact readback without exposing observed content', async () => {
  const root = new FakeElement('main');
  let posts = 0;
  const ui = createManaOutcomeUI({
    document: fakeDocument, root, project: { code: 'project-1' }, session: { role: 'owner' }, autoLoad: false,
    api: async () => ({ run: {
      runId: 'run-safe-criteria', contractId: 'contract-1', contractVersion: 3,
      mode: 'safe_test', status: 'completion_unverified',
      artifact: {
        saveReceipt: { artifactId: 'isolated-artifact-1' },
        readback: { artifactId: 'isolated-artifact-1', verified: true, content: 'private generated report' },
      },
      criteria: [{ id: 'required-heading', status: 'failed', reason: 'expected_content_not_found', observed: 'private generated report' }],
    } }),
    apiMutation: async () => { posts += 1; return { run: { runId: 'run-safe-criteria', status: 'queued' } }; },
  });
  ui.state.contract.detail = normalizeContract({ contract: contract() });
  ui.state.contract.selectedId = 'contract-1';

  await ui.runSafeTest({ contractVersion: 3, sampleInput: 'sample' }, 'contract-1');
  assert.match(root.textContent, /隔離成果物の読戻し検証済み/);
  assert.match(root.textContent, /isolated-artifact-1/);
  assert.match(root.textContent, /required-heading/);
  assert.match(root.textContent, /expected_content_not_found/);
  assert.doesNotMatch(root.textContent, /private generated report/);
  assert.equal(posts, 1);
});

test('restores the latest server safe-test state when run history is loaded', async () => {
  const root = new FakeElement('main');
  const ui = createManaOutcomeUI({
    document: fakeDocument, root, project: { code: 'project-1' }, session: { role: 'owner' }, autoLoad: false,
    api: async () => ({ runs: [{
      runId: 'run-safe-latest', contractId: 'contract-1', contractVersion: 2,
      mode: 'safe_test', status: 'completed_verified',
      safeTest: { configHash: 'sha256:same', currentConfigHash: 'sha256:same', retestRequired: false },
    }] }),
    apiMutation: async () => ({}),
  });
  ui.state.contract.detail = normalizeContract({ contract: contract() });
  ui.state.contract.selectedId = 'contract-1';

  await ui.loadRuns('contract-1');
  assert.equal(ui.state.safeTest.status, 'verified');

  ui.setActiveStage('safe_test');
  assert.match(root.textContent, /この設定で試験済み/);
});

test('selects the latest run by creation time even when an older run was updated later', async () => {
  const root = new FakeElement('main');
  const runs = [
    { runId: 'run-old', contractId: 'contract-1', status: 'running', createdAt: '2026-09-20T01:00:00Z', updatedAt: '2026-09-20T03:00:00Z' },
    { runId: 'run-new', contractId: 'contract-1', status: 'queued', createdAt: '2026-09-20T02:00:00Z', updatedAt: '2026-09-20T02:00:00Z' },
  ];
  const ui = createManaOutcomeUI({
    document: fakeDocument, root, project: { code: 'project-1' }, session: { role: 'owner' }, autoLoad: false,
    api: async (path) => path.includes('/contract-1/runs') ? { runs } : { run: runs.find((run) => path.includes(run.runId)) },
    apiMutation: async () => ({}),
  });

  await ui.loadRuns('contract-1');
  assert.equal(ui.state.runs.selectedId, 'run-new');
  assert.equal(ui.state.runs.detail.id, 'run-new');
});

test('normalizes the exact approval target without substituting missing values', () => {
  assert.deepEqual(normalizeApprovalTarget({
    approval_id: 'approval-1', operation: 'send', resource: 'weekly-report',
    payload_hash: 'sha256:abc', destination: { adapter_id: 'slack', location: '#reports' },
    contract_version: 3, expires_at: '2026-09-18T00:00:00.000Z', diff: '本文を1件送信',
  }), {
    approvalId: 'approval-1', operation: 'send', resource: 'weekly-report', payloadHash: 'sha256:abc',
    destination: { adapter_id: 'slack', location: '#reports' }, contractVersion: 3,
    expiresAt: '2026-09-18T00:00:00.000Z', diff: '本文を1件送信', complete: true,
  });
  assert.equal(normalizeApprovalTarget({ approval_id: 'approval-1' }).complete, false);
});

test('normalizes the actual runtime pendingApproval projection with nested effect payload', () => {
  assert.deepEqual(normalizeApprovalTarget({
    approvalId: 'approval-runtime-1',
    operation: 'external.send',
    resource: 'slack:#reports',
    payloadHash: 'a'.repeat(64),
    contractVersion: 6,
    expiresAt: 1_800_000_000_000,
    effect: {
      operation: 'external.send',
      resource: 'slack:#reports',
      payload: { destination: { adapterId: 'slack', location: '#reports' }, text: '週次レポート' },
    },
  }), {
    approvalId: 'approval-runtime-1', operation: 'external.send', resource: 'slack:#reports',
    payloadHash: 'a'.repeat(64), destination: { adapterId: 'slack', location: '#reports' },
    contractVersion: 6, expiresAt: 1_800_000_000_000,
    diff: { destination: { adapterId: 'slack', location: '#reports' }, text: '週次レポート' },
    complete: true,
  });
});

test('approves an actual runtime run projection only after rendering its nested effect payload', async () => {
  const root = new FakeElement('main');
  const calls = [];
  const runtimeRun = { run: {
    runId: 'run-runtime-1', status: 'waiting_approval', contractVersion: 6,
    pendingApproval: {
      approvalId: 'approval-runtime-1', operation: 'external.send', resource: 'slack:#reports',
      payloadHash: 'a'.repeat(64), contractVersion: 6, expiresAt: 1_800_000_000_000,
      effect: { operation: 'external.send', resource: 'slack:#reports', payload: { destination: 'slack:#reports', text: '週次レポート' } },
    },
  } };
  const ui = createManaOutcomeUI({
    document: fakeDocument, root, project: { code: 'project-1' }, session: { role: 'owner' }, autoLoad: false,
    api: async () => runtimeRun,
    apiMutation: async (path, request) => { calls.push({ path, request }); return runtimeRun; },
  });
  await ui.loadRunDetail('run-runtime-1');
  const result = await ui.approveRun('run-runtime-1');
  assert.equal(result.status, 'verified');
  assert.equal(calls[0].request.body.approvalId, 'approval-runtime-1');
  assert.match(root.textContent, /週次レポート/);
});

test('renders every stage from the actual runtime projection and does not offer retry for a stopped run', async () => {
  const root = new FakeElement('main');
  const mutationCalls = [];
  const runtimeRun = { run: {
    runId: 'run-runtime-stopped', status: 'stopped', contractVersion: 6,
    triggerReason: 'manual', attempt: 1, maxAttempts: 3,
    createdAt: 1_800_000_000_000, updatedAt: 1_800_000_001_000,
    stages: [
      { id: 'preflight', status: 'completed', attempt: 1, startedAt: 1_800_000_000_000, completedAt: 1_800_000_000_100 },
      { id: 'knowledge_retrieval', status: 'failed', attempt: 1, startedAt: 1_800_000_000_101, completedAt: 1_800_000_000_200, errorCode: 'configuration_incomplete' },
    ],
  } };
  const normalized = normalizeRun(runtimeRun);
  assert.equal(normalized.stages.length, 2);
  assert.deepEqual(normalized.stages.map(({ id, status }) => ({ id, status })), [
    { id: 'preflight', status: 'completed' },
    { id: 'knowledge_retrieval', status: 'failed' },
  ]);

  const ui = createManaOutcomeUI({
    document: fakeDocument, root, project: { code: 'project-1' }, session: { role: 'owner' }, autoLoad: false,
    api: async () => runtimeRun, apiMutation: async (...args) => { mutationCalls.push(args); return runtimeRun; },
  });
  await ui.loadRunDetail('run-runtime-stopped');
  assert.match(root.textContent, /処理段階/);
  assert.match(root.textContent, /preflight/);
  assert.match(root.textContent, /knowledge_retrieval/);
  assert.match(root.textContent, /configuration_incomplete/);
  assert.match(root.textContent, /完了/);
  assert.match(root.textContent, /失敗/);
  assert.doesNotMatch(root.textContent, /失敗地点から再開/);
  assert.equal((await ui.retryRun('run-runtime-stopped')).status, 'unknown');
  assert.equal(mutationCalls.length, 0);
  assert.equal((root.textContent.match(/停止した実行は再開できません。/g) ?? []).length, 2);
  assert.doesNotMatch(root.textContent, /runtime契約上/);
});

test('maps run trigger reasons and lifecycle statuses to user-facing labels in list and detail', async () => {
  const root = new FakeElement('main');
  const runs = [
    { id: 'run-manual', status: 'stopped', triggerReason: 'manual', contract_version: 6 },
    { id: 'run-schedule', status: 'failed', trigger_reason: 'schedule', contract_version: 6 },
    { id: 'run-document', status: 'queued', reason: 'document', contract_version: 6 },
    { id: 'run-unknown', status: 'running', triggerReason: 'operator_custom', contract_version: 6 },
  ];
  const ui = createManaOutcomeUI({
    document: fakeDocument, root, project: { code: 'project-1' }, session: { role: 'owner' }, autoLoad: false,
    api: async (path) => path.includes('/runs') && !path.includes('/runs/') ? { runs } : { run: runs[0] },
    apiMutation: async () => ({}),
  });

  assert.equal(triggerLabel('manual'), '手動');
  assert.equal(triggerLabel('schedule'), '定期実行');
  assert.equal(triggerLabel('document'), '文書追加');
  assert.equal(triggerLabel('operator_custom'), '未確認');
  assert.equal(triggerLabel(), '未確認');
  assert.equal(statusLabel('loading'), '読み込み中');
  assert.equal(statusLabel('idle'), '待機中');
  assert.equal(statusLabel('ready'), '取得済み');

  await ui.loadRuns('contract-1');
  assert.match(root.textContent, /手動/);
  assert.match(root.textContent, /定期実行/);
  assert.match(root.textContent, /文書追加/);
  assert.match(root.textContent, /未確認/);
  assert.doesNotMatch(root.textContent, /operator_custom/);

  await ui.loadRunDetail('run-manual');
  assert.match(root.textContent, /起動理由手動/);
  assert.doesNotMatch(root.textContent, /triggerReason/);
});

test('shows the approval diff and external target values in the run detail', async () => {
  const root = new FakeElement('main');
  const ui = createManaOutcomeUI({
    document: fakeDocument, root, project: { code: 'project-1' }, session: { role: 'owner' }, autoLoad: false,
    api: async () => ({ run: { id: 'run-1', status: 'waiting_approval', contract_version: 3, pending_approval: {
      approval_id: 'approval-1', operation: 'send', resource: 'weekly-report', payload_hash: 'sha256:abc',
      destination: 'slack:#reports', contract_version: 3, expires_at: '2026-09-18T00:00:00.000Z', diff: '本文を1件送信',
    } } }), apiMutation: async () => ({}),
  });
  await ui.loadRunDetail('run-1');
  assert.match(root.textContent, /承認対象の差分/);
  assert.match(root.textContent, /本文を1件送信/);
  assert.match(root.textContent, /slack:#reports/);
  assert.match(root.textContent, /sha256:abc/);
});

test('marks a missing approval diff unknown and blocks approval mutation', async () => {
  const root = new FakeElement('main');
  const calls = [];
  const ui = createManaOutcomeUI({
    document: fakeDocument, root, project: { code: 'project-1' }, session: { role: 'owner' }, autoLoad: false,
    api: async () => ({ run: { id: 'run-1', status: 'waiting_approval', contract_version: 3, pending_approval: {
      approval_id: 'approval-1', operation: 'send', resource: 'weekly-report', payload_hash: 'sha256:abc',
      destination: 'slack:#reports', contract_version: 3, expires_at: '2026-09-18T00:00:00.000Z',
    } } }), apiMutation: async (...args) => { calls.push(args); return {}; },
  });
  await ui.loadRunDetail('run-1');
  const result = await ui.approveRun('run-1');
  assert.equal(result.status, 'unknown');
  assert.equal(calls.length, 0);
  assert.match(root.textContent, /差分を取得できないため承認できません/);
});

test('finishes contract loading with an explicit empty state', async () => {
  const root = new FakeElement('div');
  const controller = createManaOutcomeUI({
    document: fakeDocument,
    root,
    project: { code: 'proj-1', name: 'Project' },
    session: { actorId: 'person-1', role: 'owner' },
    api: async () => ({ contracts: [] }),
    apiMutation: async () => ({}),
    autoLoad: false,
  });
  const result = await controller.loadContracts();
  assert.equal(result.status, 'empty');
  assert.equal(result.records.length, 0);
  assert.match(root.textContent, /成果と責任者/);
  assert.match(root.textContent, /資源と起動条件/);
  assert.match(root.textContent, /安全試験と有効化/);
  const createButton = elements(root, (node) => node.tagName === 'BUTTON' && node.textContent === '成果契約を入力する')[0];
  assert.ok(createButton);
  createButton.click();
  assert.equal(controller.state.activeView, 'delegation_settings');
  const overviewTab = elements(root, (node) => node.tagName === 'BUTTON' && node.textContent === '委任一覧')[0];
  assert.equal(overviewTab.attributes['aria-current'], 'page');
  assert.match(root.textContent, /成果契約/);
});

test('does not turn an unconfirmed contract list into an empty-state creation flow', async () => {
  const root = new FakeElement('main');
  const controller = createManaOutcomeUI({
    document: fakeDocument,
    root,
    project: { code: 'proj-1', name: 'Project' },
    session: { actorId: 'person-1', role: 'owner' },
    api: async () => ({}),
    autoLoad: false,
  });
  const result = await controller.loadContracts();
  assert.equal(result.status, 'unknown');
  assert.match(root.textContent, /状態を確認できません/);
  assert.doesNotMatch(root.textContent, /委任はありません|成果契約を入力する/);
});

test('styles the profile, resource, preflight, and project-resource markup', () => {
  const css = readFileSync(new URL('../../ui/outcome-mana.css', import.meta.url), 'utf8');
  for (const selector of [
    '.outcome-mana-profile-picker',
    '.outcome-mana-profile-card',
    '.outcome-mana-profile-statuses',
    '.outcome-mana-resource-picker',
    '.outcome-mana-resource-choices',
    '.outcome-mana-resource-choice',
    '.outcome-mana-resource-version',
    '.outcome-mana-resource-preserved',
    '.outcome-mana-resource-picker-value[hidden]',
    '.outcome-mana-preflight-list',
    '.outcome-mana-preflight-item',
    '.outcome-mana-resource-section',
    '.outcome-mana-project-resource-grid',
    '.outcome-mana-project-resource-card',
  ]) {
    assert.ok(css.includes(`${selector} {`) || css.includes(`${selector},`), `${selector} should be styled`);
  }
});

test('stacks Mana detail rails below 920px so medium-width screens retain access', () => {
  const css = readFileSync(new URL('../../ui/outcome-mana.css', import.meta.url), 'utf8');
  const responsive = css.match(/@media \(max-width: 920px\) \{([\s\S]*?)\n\}/)?.[1];
  assert.ok(responsive, '920px responsive layout rule should exist');
  for (const selector of [
    '.outcome-mana-overview-layout',
    '.outcome-mana-connection-detail-layout',
    '.outcome-mana-delegation-layout',
    '.outcome-mana-settings-layout',
    '.outcome-mana-inspector',
    '.outcome-mana-connection-inspector',
    '.outcome-mana-resource-panel',
    '.outcome-mana-settings-rail',
  ]) assert.ok(responsive.includes(selector), `${selector} should adapt below 920px`);
  assert.match(responsive, /grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(responsive, /position:\s*static/);
});

test('keeps a saved contract unverified when exact readback identity, version, or content differs', async () => {
  const saved = { ...contract(), version: 4 };
  const cases = [
    ['different contract', { ...saved, id: 'contract-other' }],
    ['stale version', { ...saved, version: 3 }],
    ['different content', { ...saved, outcome: '別の成果' }],
  ];
  for (const [name, readback] of cases) {
    const controller = createManaOutcomeUI({
      document: fakeDocument,
      root: new FakeElement('div'),
      project: { code: 'project-1', name: 'Project' },
      session: { actorId: 'actor-1', role: 'owner' },
      api: async () => ({ contract: readback }),
      apiMutation: async () => ({ contract: saved }),
      autoLoad: false,
    });
    const result = await controller.saveContractDraft(contract(), { create: true });
    assert.equal(result.status, 'saved_unverified', name);
  }
});

test('keeps a saved contract unverified when allowed resource readback differs', async () => {
  const requested = { ...contract(), allowed_resources: ['github:repo:expected'] };
  const saved = { ...requested, version: 4 };
  const readback = { ...saved, allowed_resources: ['github:repo:different'] };
  const controller = createManaOutcomeUI({
    document: fakeDocument,
    root: new FakeElement('div'),
    project: { code: 'project-1', name: 'Project' },
    session: { actorId: 'actor-1', role: 'owner' },
    api: async () => ({ contract: readback }),
    apiMutation: async () => ({ contract: saved }),
    autoLoad: false,
  });
  const result = await controller.saveContractDraft(requested, { create: true });
  assert.equal(result.status, 'saved_unverified');
});

test('persists profileId and verifies that the same profile returns on contract readback', async () => {
  const profileId = 'meeting_minutes_github_v1';
  const requested = {
    ...contract(),
    profileId,
    inputRefs: [{ id: 'github:repo:meeting-notes', version: null }],
    allowedResources: ['github:repo:meeting-notes'],
    artifactDestination: { adapterId: 'github', location: 'github:repo:meeting-notes', environment: 'isolated' },
  };
  const saved = { ...requested, version: 4 };
  let mutationBody;
  const ui = createManaOutcomeUI({
    document: fakeDocument,
    root: new FakeElement('div'),
    project: { code: 'project-1', name: 'Project' },
    session: { actorId: 'actor-1', role: 'owner' },
    api: async () => ({ contract: saved }),
    apiMutation: async (_path, request) => {
      mutationBody = request.body;
      return { contract: saved, readback_verified: true };
    },
    autoLoad: false,
  });
  const result = await ui.saveContractDraft(requested, { create: true });
  assert.equal(result.status, 'ready');
  assert.equal(mutationBody.profileId, profileId);
  assert.equal(ui.state.contract.detail.profileId, profileId);
});

test('keeps the profile and allowed resources when a trigger save sends the whole contract', async () => {
  let body;
  const current = { ...contract(), profileId: 'meeting_minutes_github_v1', allowedResources: ['github:repo:example/project'] };
  const ui = createManaOutcomeUI({
    document: fakeDocument, root: new FakeElement('div'), project: { code: 'project-1' }, session: { role: 'owner' }, autoLoad: false,
    api: async () => ({ schedules: [], subscriptions: [] }),
    apiMutation: async (_path, request) => { body = request.body; return { contract: { ...current, version: 4 }, readback_verified: true }; },
  });
  ui.state.contract.status = 'ready';
  ui.state.contract.detail = normalizeContract({ contract: current });
  ui.state.contract.selectedId = 'contract-1';
  await ui.saveTriggers({ type: 'manual' });
  assert.equal(body.contract.profileId, 'meeting_minutes_github_v1');
  assert.deepEqual(body.contract.allowedResources, ['github:repo:example/project']);
});

test('reuses the same idempotency key after a contract create response is lost', async () => {
  const keys = [];
  let attempts = 0;
  const saved = { ...contract(), version: 4 };
  const controller = createManaOutcomeUI({
    document: fakeDocument,
    root: new FakeElement('div'),
    project: { code: 'project-1', name: 'Project' },
    session: { actorId: 'actor-1', role: 'owner' },
    api: async () => ({ contract: saved }),
    apiMutation: async (_path, request) => {
      keys.push(request.key);
      attempts += 1;
      if (attempts === 1) throw new Error('response lost');
      return { contract: saved };
    },
    autoLoad: false,
  });
  assert.equal((await controller.saveContractDraft(contract(), { create: true })).status, 'error_retryable');
  assert.equal((await controller.saveContractDraft(contract(), { create: true })).status, 'ready');
  assert.equal(keys.length, 2);
  assert.equal(keys[0], keys[1]);
});
