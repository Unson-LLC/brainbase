import { strict as assert } from 'node:assert';
import { test } from 'vitest';

import {
  createMeetingMinutesStorageExtension,
  createMeetingMinutesStorageUI,
  MEETING_MINUTES_STORAGE_UI_CONTRACT_VERSION,
  normalizeMeetingMinutesStoragePanel,
} from '../../ui/meeting-minutes-storage.js';
import { createMeetingMinutesUI } from '../../ui/meeting-minutes.js';
import { FakeDocument, FakeElement, collectText, findAll, waitFor } from './graph-ui-harness.mjs';

function byAttr(root, name, value) {
  return findAll(root, (node) => node.attributes?.[name] === value)[0];
}

test('normalizes external source metadata and keeps capabilities explicit', () => {
  const model = normalizeMeetingMinutesStoragePanel({
    placement: 'external',
    source_status: 'available',
    version: {
      version_id: 'version-1',
      source_ref: {
        provider: 'filesystem',
        locator: 'meetings/one.md',
        revision: 'sha256:revision',
        digest: 'sha256:digest',
      },
    },
    capabilities: {
      read: true,
      read_only: true,
      save: false,
      history: false,
      retention_delete: false,
      current_acl: 'injected',
    },
  });
  assert.equal(model.contractVersion, MEETING_MINUTES_STORAGE_UI_CONTRACT_VERSION);
  assert.equal(model.placement, 'external');
  assert.equal(model.sourceStatus, 'available');
  assert.equal(model.source.provider, 'filesystem');
  assert.equal(model.capabilities.history, false);
  assert.equal(model.capabilities.retention_delete, false);
});

test('renders unavailable and historical states without presenting a body as available', () => {
  const root = new FakeElement('main');
  let retries = 0;
  const controller = createMeetingMinutesStorageUI({
    root,
    document: new FakeDocument(),
    view: {
      placement: 'external',
      source_status: 'historical_unavailable',
      reason: '保存時点の版は外部保存先にありません',
      source_result: { capabilities: { read: true, read_only: true, history: false, save: false, retention_delete: false, current_acl: 'injected' } },
      body: 'この本文は表示されてはいけない',
    },
    onRetry: () => { retries += 1; },
  });
  const panel = root.children[0];
  assert.equal(panel.attributes['data-contract-version'], MEETING_MINUTES_STORAGE_UI_CONTRACT_VERSION);
  assert.equal(byAttr(panel, 'data-source-status', 'historical_unavailable')?.textContent, '保存時点の外部版を取得できません');
  assert.match(collectText(panel), /保存時点の版は外部保存先にありません/);
  assert.doesNotMatch(collectText(panel), /この本文は表示されてはいけない/);
  const retry = findAll(panel, (node) => node.tagName === 'BUTTON' && node.textContent === 'もう一度確認')[0];
  retry.dispatch('click');
  assert.equal(retries, 1);
});

test('renders native placement and sends an explicit placement change through the host hook', () => {
  const root = new FakeElement('main');
  let selected;
  createMeetingMinutesStorageUI({
    root,
    document: new FakeDocument(),
    view: { placement: 'native', source_status: 'native', placement_options: ['native', 'external'] },
    onPlacementChange: (value) => { selected = value; },
  });
  const select = findAll(root, (node) => node.tagName === 'SELECT')[0];
  select.value = 'external';
  select.dispatch('change');
  assert.equal(selected, 'external');
  assert.match(collectText(root), /Brainbase内蔵/);
});

test('mounts the version extension against the host route and keeps retry keys stable', async () => {
  const root = new FakeElement('main');
  const bodyRoot = new FakeElement('div');
  const requests = [];
  const extension = createMeetingMinutesStorageExtension({
    defaultExternal: { provider: 'filesystem', locator: 'minutes.md' },
  });
  const panel = extension.mount({
    root,
    bodyRoot,
    document: new FakeDocument(),
    detail: { meeting: { meeting_id: 'meeting-1' } },
    documentRecord: { minutes_id: 'minutes-1', revision: 7 },
    version: {
      version_id: 'version-2',
      source_ref: { provider: 'filesystem', locator: 'minutes.md', revision: 'sha256:r', digest: 'sha256:d' },
    },
    request: async (path, init = {}) => {
      requests.push({ path, init });
      return {
        placement: 'external',
        source_status: 'available',
        source_ref: { provider: 'filesystem', locator: 'minutes.md', revision: 'sha256:r', digest: 'sha256:d' },
        capabilities: { read: true, read_only: true, save: false, history: false, retention_delete: false, current_acl: 'injected' },
        version: { version_id: 'version-2' },
        body: '外部の議事録本文',
      };
    },
    refresh: async () => {},
    setStatus: () => {},
  });
  await waitFor(() => panel.state.sourceStatus === 'available');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].path, '/meeting-1/minutes/minutes-1/versions/version-2');
  assert.equal(panel.state.sourceStatus, 'available');
  assert.equal(collectText(bodyRoot), '外部の議事録本文');

  const select = findAll(root, (node) => node.tagName === 'SELECT')[0];
  select.value = 'native';
  select.dispatch('change');
  await waitFor(() => requests.length === 2);
  assert.equal(requests[1].path, '/meeting-1/minutes/minutes-1');
  assert.equal(requests[1].init.method, 'POST');
  assert.equal(requests[1].init.headers['Idempotency-Key'], 'meeting-minutes-storage-version-2-native');
  assert.deepEqual(JSON.parse(requests[1].init.body), {
    expected_revision: 7,
    placement: { kind: 'native' },
  });
  assert.equal(bodyRoot.children.length, 0);
});

test('clears the shared body slot when the current ACL can no longer read an external version', async () => {
  const root = new FakeElement('main');
  const bodyRoot = new FakeElement('div');
  let sourceStatus = 'available';
  let calls = 0;
  const extension = createMeetingMinutesStorageExtension();
  const panel = extension.mount({
    root,
    bodyRoot,
    document: new FakeDocument(),
    detail: { meeting: { meeting_id: 'meeting-1' } },
    documentRecord: { minutes_id: 'minutes-1', revision: 7 },
    version: {
      version_id: 'version-2',
      source_ref: { provider: 'filesystem', locator: 'minutes.md', revision: 'sha256:r', digest: 'sha256:d' },
    },
    request: async () => {
      calls += 1;
      return {
        placement: 'external',
        source_status: sourceStatus,
        source_ref: { provider: 'filesystem', locator: 'minutes.md', revision: 'sha256:r', digest: 'sha256:d' },
        ...(sourceStatus === 'available' ? { body: '権限確認済みの本文' } : { reason: '現在の権限では本文を読めません' }),
      };
    },
    refresh: async () => {},
    setStatus: () => {},
  });
  await waitFor(() => calls === 1 && collectText(bodyRoot) === '権限確認済みの本文');
  sourceStatus = 'denied';
  const retry = findAll(root, (node) => node.tagName === 'BUTTON' && node.textContent === 'もう一度確認')[0];
  assert.equal(retry, undefined);

  // Rebinding to the same selected version creates the same retryable host
  // check without bypassing the UI's request path.
  panel.update({
    placement: 'external',
    source_status: 'denied',
    source_ref: { provider: 'filesystem', locator: 'minutes.md', revision: 'sha256:r', digest: 'sha256:d' },
    reason: '現在の権限では本文を読めません',
    placement_options: ['native', 'external'],
  });
  const deniedRetry = findAll(root, (node) => node.tagName === 'BUTTON' && node.textContent === 'もう一度確認')[0];
  deniedRetry.dispatch('click');
  await waitFor(() => calls === 2 && panel.state.sourceStatus === 'denied');
  assert.equal(bodyRoot.children.length, 0);
  assert.doesNotMatch(collectText(bodyRoot), /権限確認済みの本文/);

  sourceStatus = 'unavailable';
  const unavailableRetry = findAll(root, (node) => node.tagName === 'BUTTON' && node.textContent === 'もう一度確認')[0];
  unavailableRetry.dispatch('click');
  await waitFor(() => calls === 3 && panel.state.sourceStatus === 'unavailable');
  assert.equal(bodyRoot.children.length, 0);
});

test('renders only the selected external version body in the shared core content area', async () => {
  const root = new FakeElement('main');
  const source = (revision) => ({
    provider: 'filesystem',
    locator: 'minutes.md',
    revision: `sha256:${revision}`,
    digest: `sha256:digest-${revision}`,
  });
  const detail = {
    meeting: { meeting_id: 'meeting-1', title: '外部ソース会議', scheduled_at: '2026-10-06T00:00:00.000Z', participant_ids: [] },
    minutes: [{ minutes_id: 'minutes-1', title: '議事録', current_version_id: 'version-1', revision: 1 }],
    versions: [
      { version_id: 'version-1', minutes_id: 'minutes-1', source_ref: source('one'), body: '応答前に表示してはいけない本文', created_at: '2026-10-06T00:00:00.000Z' },
      { version_id: 'version-2', minutes_id: 'minutes-1', source_ref: source('two'), created_at: '2026-10-06T00:01:00.000Z' },
    ],
    snapshot_revision: 1,
  };
  const bodies = { 'version-1': '外部版1の本文', 'version-2': '外部版2の本文' };
  const view = createMeetingMinutesUI({
    root,
    document: new FakeDocument(),
    fetcher: async (path) => {
      if (path === '/api/meeting-minutes') {
        return { ok: true, status: 200, json: async () => ({ absence_confirmed: true, meetings: [{ meeting: detail.meeting, minutes: detail.minutes }] }) };
      }
      if (path === '/api/meeting-minutes/meeting-1') {
        return { ok: true, status: 200, json: async () => detail };
      }
      const versionId = path.split('/').at(-1);
      return {
        ok: true,
        status: 200,
        json: async () => ({ placement: 'external', source_status: 'available', source_ref: source(versionId === 'version-1' ? 'one' : 'two'), body: bodies[versionId], version: { version_id: versionId } }),
      };
    },
    versionActionExtensions: [createMeetingMinutesStorageExtension()],
  });
  await view.openMeeting('meeting-1');
  await waitFor(() => collectText(root).includes('外部版1の本文'));
  assert.doesNotMatch(collectText(root), /応答前に表示してはいけない本文/);

  const versionButtons = findAll(root, (node) => node.tagName === 'BUTTON' && node.className.includes('bb-minutes-version'));
  versionButtons.find((node) => collectText(node).includes('第2版')).dispatch('click');
  await waitFor(() => collectText(root).includes('外部版2の本文'));
  assert.doesNotMatch(collectText(root), /外部版1の本文/);
});
