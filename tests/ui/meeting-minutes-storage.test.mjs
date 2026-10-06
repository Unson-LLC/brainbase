import { strict as assert } from 'node:assert';
import { test } from 'vitest';

import {
  createMeetingMinutesStorageExtension,
  createMeetingMinutesStorageUI,
  MEETING_MINUTES_STORAGE_UI_CONTRACT_VERSION,
  normalizeMeetingMinutesStoragePanel,
} from '../../ui/meeting-minutes-storage.js';
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
  const requests = [];
  const extension = createMeetingMinutesStorageExtension({
    defaultExternal: { provider: 'filesystem', locator: 'minutes.md' },
  });
  const panel = extension.mount({
    root,
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
      };
    },
    refresh: async () => {},
    setStatus: () => {},
  });
  await waitFor(() => panel.state.sourceStatus === 'available');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].path, '/meeting-1/minutes/minutes-1/versions/version-2');
  assert.equal(panel.state.sourceStatus, 'available');

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
});
