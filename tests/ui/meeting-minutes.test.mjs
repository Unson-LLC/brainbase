import { describe, expect, it } from 'vitest';
import { createMeetingMinutesUI } from '../../ui/meeting-minutes.js';

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.attributes = {};
    this.listeners = new Map();
    this.className = '';
    this.textContent = '';
    this.value = '';
    this.disabled = false;
  }

  append(...children) {
    for (const child of children) {
      if (!child) continue;
      child.parentNode = this;
      this.children.push(child);
    }
  }

  replaceChildren(...children) {
    this.children = [];
    this.append(...children);
  }

  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
}

class FakeDocument {
  createElement(tagName) { return new FakeElement(tagName); }
}

function collectText(node) {
  return `${node?.textContent ?? ''}${(node?.children ?? []).map(collectText).join('')}`;
}

function findAll(node, predicate) {
  const found = [];
  if (predicate(node)) found.push(node);
  for (const child of node?.children ?? []) found.push(...findAll(child, predicate));
  return found;
}

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function meetingList() {
  return {
    absence_confirmed: true,
    meetings: [{
      meeting: {
        meeting_id: 'meeting-1',
        title: '週次定例',
        scheduled_at: '2026-10-06T00:00:00.000Z',
        participant_ids: [],
      },
      minutes: [{ minutes_id: 'minutes-1' }],
    }],
  };
}

function meetingDetail() {
  return {
    meeting: meetingList().meetings[0].meeting,
    minutes: [{ minutes_id: 'minutes-1', title: '議事録', current_version_id: 'version-1', revision: 1 }],
    versions: [{ version_id: 'version-1', minutes_id: 'minutes-1', body: '保存済み本文', created_at: '2026-10-06T00:00:00.000Z' }],
    snapshot_revision: 1,
  };
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function deferred() {
  let resolve;
  const promise = new Promise((nextResolve) => { resolve = nextResolve; });
  return { promise, resolve };
}

function meetingRecord(meetingId, title) {
  return {
    meeting_id: meetingId,
    title,
    scheduled_at: '2026-10-06T00:00:00.000Z',
    participant_ids: [],
  };
}

function meetingListFor(...records) {
  return {
    absence_confirmed: true,
    meetings: records.map((meeting) => ({ meeting, minutes: [] })),
  };
}

function meetingDetailFor(meeting, body) {
  return {
    meeting,
    minutes: [{ minutes_id: `${meeting.meeting_id}-minutes`, title: '議事録', current_version_id: `${meeting.meeting_id}-version`, revision: 1 }],
    versions: [{ version_id: `${meeting.meeting_id}-version`, minutes_id: `${meeting.meeting_id}-minutes`, body, created_at: '2026-10-06T00:00:00.000Z' }],
    snapshot_revision: 1,
  };
}

describe('meeting minutes UI loading states', () => {
  it('keeps a failed list distinct from a confirmed empty list and offers retry', async () => {
    let attempts = 0;
    const root = new FakeElement('div');
    const view = createMeetingMinutesUI({
      root,
      document: new FakeDocument(),
      fetcher: async () => {
        attempts += 1;
        return attempts === 1
          ? jsonResponse(503, { error: { code: 'storage_unavailable', message: '一時的に保存先を読めません' } })
          : jsonResponse(200, meetingList());
      },
    });
    await flush();
    expect(view.state.meetings).toEqual([]);
    expect(collectText(root)).toContain('会議一覧を読み込めませんでした。理由: 一時的に保存先を読めません');
    expect(collectText(root)).toContain('再試行');
    expect(collectText(root)).not.toContain('保存された会議はありません');

    const retry = findAll(root, (node) => node.tagName === 'BUTTON' && node.textContent === '再試行')[0];
    retry.listeners.get('click')();
    await flush();
    expect(view.state.meetings).toHaveLength(1);
    expect(collectText(root)).toContain('週次定例');
    expect(collectText(root)).not.toContain('一時的に保存先を読めません');
  });

  it('keeps a successful detail through transient failure, but clears it after access denial', async () => {
    let detailAttempts = 0;
    const root = new FakeElement('div');
    const view = createMeetingMinutesUI({
      root,
      document: new FakeDocument(),
      fetcher: async (path) => {
        if (path === '/api/meeting-minutes') return jsonResponse(200, meetingList());
        detailAttempts += 1;
        if (detailAttempts === 2) return jsonResponse(503, { error: { code: 'storage_unavailable', message: '一時的な詳細障害' } });
        if (detailAttempts === 4) return jsonResponse(403, { error: { code: 'authorization_denied', message: 'この会議を読む権限がありません' } });
        return jsonResponse(200, meetingDetail());
      },
    });
    await flush();
    await view.openMeeting('meeting-1');
    expect(collectText(root)).toContain('保存済み本文');

    await view.openMeeting('meeting-1');
    expect(collectText(root)).toContain('保存済み本文');
    expect(collectText(root)).toContain('会議詳細を読み込めませんでした。理由: 一時的な詳細障害');
    const retry = findAll(root, (node) => node.tagName === 'BUTTON' && node.textContent === '再試行')[0];
    retry.listeners.get('click')();
    await flush();
    expect(collectText(root)).toContain('保存済み本文');
    expect(collectText(root)).not.toContain('一時的な詳細障害');

    await view.openMeeting('meeting-1');
    expect(collectText(root)).toContain('会議詳細を読み込めませんでした。理由: この会議を読む権限がありません');
    expect(collectText(root)).not.toContain('保存済み本文');
  });

  it('clears protected detail when a refreshed list is denied', async () => {
    let listAttempts = 0;
    const root = new FakeElement('div');
    const view = createMeetingMinutesUI({
      root,
      document: new FakeDocument(),
      fetcher: async (path) => {
        if (path === '/api/meeting-minutes') {
          listAttempts += 1;
          return listAttempts === 1
            ? jsonResponse(200, meetingList())
            : jsonResponse(403, { error: { code: 'authorization_denied', message: '会議一覧を読む権限がありません' } });
        }
        return jsonResponse(200, meetingDetail());
      },
    });
    await flush();
    await view.openMeeting('meeting-1');
    expect(collectText(root)).toContain('保存済み本文');

    await view.refresh();
    expect(collectText(root)).toContain('会議一覧を読み込めませんでした。理由: 会議一覧を読む権限がありません');
    expect(collectText(root)).toContain('会議一覧へのアクセスを確認できません');
    expect(collectText(root)).not.toContain('保存済み本文');
  });

  it('clears selected detail when a confirmed list no longer includes it', async () => {
    let listAttempts = 0;
    const root = new FakeElement('div');
    const view = createMeetingMinutesUI({
      root,
      document: new FakeDocument(),
      fetcher: async (path) => {
        if (path === '/api/meeting-minutes') {
          listAttempts += 1;
          return listAttempts === 1
            ? jsonResponse(200, meetingList())
            : jsonResponse(200, { absence_confirmed: true, meetings: [] });
        }
        return jsonResponse(200, meetingDetail());
      },
    });
    await flush();
    await view.openMeeting('meeting-1');
    expect(collectText(root)).toContain('保存済み本文');

    await view.refresh();
    expect(view.state.meetingId).toBeNull();
    expect(view.state.detail).toBeNull();
    expect(collectText(root)).toContain('選択中の会議は現在の一覧に含まれません');
    expect(collectText(root)).toContain('再試行');
    expect(collectText(root)).not.toContain('保存済み本文');
  });
});

describe('meeting minutes UI host extensions', () => {
  it('keeps create available when optional host extensions are omitted', async () => {
    const root = new FakeElement('div');
    const view = createMeetingMinutesUI({
      root,
      document: new FakeDocument(),
      fetcher: async () => jsonResponse(200, meetingList()),
    });
    await flush();

    const create = findAll(root, (node) => node.tagName === 'BUTTON' && node.textContent === '会議を作成')[0];
    expect(create.disabled).toBe(false);
    create.listeners.get('click')();
    expect(findAll(root, (node) => node.tagName === 'FORM' && node.className === 'bb-minutes-create-form')).toHaveLength(1);
  });

  it('renders a host-provided meeting label as text in the list and detail', async () => {
    const root = new FakeElement('div');
    const unsafeLabel = '<img src=x onerror=alert(1)>';
    const labelledMeetings = [];
    const view = createMeetingMinutesUI({
      root,
      document: new FakeDocument(),
      fetcher: async (path) => path === '/api/meeting-minutes'
        ? jsonResponse(200, meetingList())
        : jsonResponse(200, meetingDetail()),
      meetingLabel: (meeting) => {
        labelledMeetings.push(meeting.meeting_id);
        return unsafeLabel;
      },
    });
    await flush();

    let labels = findAll(root, (node) => node.className === 'bb-minutes-meeting-label');
    expect(labels).toHaveLength(1);
    expect(labels[0].textContent).toBe(unsafeLabel);
    expect(labels[0].children).toHaveLength(0);

    await view.openMeeting('meeting-1');
    labels = findAll(root, (node) => node.className === 'bb-minutes-meeting-label');
    expect(labels).toHaveLength(2);
    expect(labels.every((node) => node.textContent === unsafeLabel)).toBe(true);
    expect(labelledMeetings).toContain('meeting-1');
  });

  it('disables create and blocks the form when the host denies creation', async () => {
    const root = new FakeElement('div');
    const methods = [];
    const view = createMeetingMinutesUI({
      root,
      document: new FakeDocument(),
      fetcher: async (_path, init = {}) => {
        methods.push(init.method ?? 'GET');
        return jsonResponse(200, meetingList());
      },
      canCreateMeeting: false,
    });
    await flush();

    const create = findAll(root, (node) => node.tagName === 'BUTTON' && node.textContent === '会議を作成')[0];
    expect(create.disabled).toBe(true);
    expect(collectText(root)).toContain('この画面では会議を作成できません。');
    create.listeners.get('click')();
    expect(findAll(root, (node) => node.tagName === 'FORM' && node.className === 'bb-minutes-create-form')).toHaveLength(0);
    expect(methods).toEqual(['GET']);
    expect(view.state.meetings).toHaveLength(1);
  });

  it('rechecks a create callback before submit and allows it after a successful refresh', async () => {
    let allowed = false;
    const methods = [];
    const root = new FakeElement('div');
    const view = createMeetingMinutesUI({
      root,
      document: new FakeDocument(),
      fetcher: async (_path, init = {}) => {
        methods.push(init.method ?? 'GET');
        return jsonResponse(200, meetingList());
      },
      canCreateMeeting: () => allowed,
    });
    await flush();

    allowed = true;
    await view.refresh();
    const create = findAll(root, (node) => node.tagName === 'BUTTON' && node.textContent === '会議を作成')[0];
    expect(create.disabled).toBe(false);
    create.listeners.get('click')();
    const form = findAll(root, (node) => node.tagName === 'FORM' && node.className === 'bb-minutes-create-form')[0];
    expect(form).toBeTruthy();

    allowed = false;
    form.listeners.get('submit')({ preventDefault() {} });
    await flush();
    expect(methods).toEqual(['GET', 'GET']);
    expect(collectText(root)).toContain('この画面では会議を作成できません。');
  });
});

describe('meeting minutes UI request generations', () => {
  it('keeps the newest list refresh when an older response resolves later', async () => {
    let listCalls = 0;
    const refreshes = [];
    const root = new FakeElement('div');
    const olderList = meetingListFor(meetingRecord('meeting-old', '古い一覧'));
    const newerList = meetingListFor(meetingRecord('meeting-new', '新しい一覧'));
    const view = createMeetingMinutesUI({
      root,
      document: new FakeDocument(),
      fetcher: async (path) => {
        if (path !== '/api/meeting-minutes') return jsonResponse(404, {});
        listCalls += 1;
        if (listCalls === 1) return jsonResponse(200, meetingList());
        const request = deferred();
        refreshes.push(request);
        return request.promise;
      },
    });
    await flush();

    const olderRefresh = view.refresh();
    const newerRefresh = view.refresh();
    expect(refreshes).toHaveLength(2);

    refreshes[1].resolve(jsonResponse(200, newerList));
    await newerRefresh;
    expect(view.state.meetings[0].meeting.title).toBe('新しい一覧');

    refreshes[0].resolve(jsonResponse(200, olderList));
    await olderRefresh;
    expect(view.state.meetings[0].meeting.title).toBe('新しい一覧');
    expect(collectText(root)).toContain('新しい一覧');
    expect(collectText(root)).not.toContain('古い一覧');
  });

  it('keeps the newest opened meeting when an older detail response resolves later', async () => {
    const meetingOne = meetingRecord('meeting-1', '一つ目の会議');
    const meetingTwo = meetingRecord('meeting-2', '二つ目の会議');
    const detailRequests = [];
    const root = new FakeElement('div');
    const view = createMeetingMinutesUI({
      root,
      document: new FakeDocument(),
      fetcher: async (path) => {
        if (path === '/api/meeting-minutes') return jsonResponse(200, meetingListFor(meetingOne, meetingTwo));
        const request = deferred();
        detailRequests.push({ path, request });
        return request.promise;
      },
    });
    await flush();

    const olderOpen = view.openMeeting('meeting-1');
    const newerOpen = view.openMeeting('meeting-2');
    expect(detailRequests).toHaveLength(2);

    detailRequests[1].request.resolve(jsonResponse(200, meetingDetailFor(meetingTwo, '二つ目の本文')));
    await newerOpen;
    expect(view.state.detail.meeting.meeting_id).toBe('meeting-2');

    detailRequests[0].request.resolve(jsonResponse(200, meetingDetailFor(meetingOne, '一つ目の本文')));
    await olderOpen;
    expect(view.state.detail.meeting.meeting_id).toBe('meeting-2');
    expect(collectText(root)).toContain('二つ目の本文');
    expect(collectText(root)).not.toContain('一つ目の本文');
  });

  it('does not resurrect a detail excluded by a newer list refresh', async () => {
    let listCalls = 0;
    let listRefresh;
    let detailRequest;
    const meeting = meetingRecord('meeting-1', '絞り込み対象の会議');
    const root = new FakeElement('div');
    const view = createMeetingMinutesUI({
      root,
      document: new FakeDocument(),
      fetcher: async (path) => {
        if (path === '/api/meeting-minutes') {
          listCalls += 1;
          if (listCalls === 1) return jsonResponse(200, meetingListFor(meeting));
          listRefresh = deferred();
          return listRefresh.promise;
        }
        detailRequest = deferred();
        return detailRequest.promise;
      },
    });
    await flush();

    const opening = view.openMeeting('meeting-1');
    const refreshing = view.refresh();
    expect(detailRequest).toBeTruthy();
    expect(listRefresh).toBeTruthy();

    listRefresh.resolve(jsonResponse(200, meetingListFor()));
    await refreshing;
    expect(view.state.meetingId).toBeNull();
    expect(view.state.detail).toBeNull();
    expect(collectText(root)).toContain('選択中の会議は現在の一覧に含まれません');

    detailRequest.resolve(jsonResponse(200, meetingDetailFor(meeting, '古い詳細本文')));
    await opening;
    expect(view.state.detail).toBeNull();
    expect(collectText(root)).not.toContain('古い詳細本文');
  });

  it('keeps an in-flight detail when a refreshed list still includes the meeting', async () => {
    let listCalls = 0;
    let listRefresh;
    let detailRequest;
    const meeting = meetingRecord('meeting-1', '一覧に残る会議');
    const root = new FakeElement('div');
    const view = createMeetingMinutesUI({
      root,
      document: new FakeDocument(),
      fetcher: async (path) => {
        if (path === '/api/meeting-minutes') {
          listCalls += 1;
          if (listCalls === 1) return jsonResponse(200, meetingListFor(meeting));
          listRefresh = deferred();
          return listRefresh.promise;
        }
        detailRequest = deferred();
        return detailRequest.promise;
      },
    });
    await flush();

    const opening = view.openMeeting('meeting-1');
    const refreshing = view.refresh();
    expect(detailRequest).toBeTruthy();
    expect(listRefresh).toBeTruthy();

    listRefresh.resolve(jsonResponse(200, meetingListFor(meeting)));
    await refreshing;
    detailRequest.resolve(jsonResponse(200, meetingDetailFor(meeting, '再読込後も表示する本文')));
    await opening;
    expect(view.state.detail?.meeting?.meeting_id).toBe('meeting-1');
    expect(collectText(root)).toContain('再読込後も表示する本文');
  });
});

describe('meeting minutes UI editing guard', () => {
  it('hides version and document edit forms when editing is denied', async () => {
    const root = new FakeElement('div');
    const view = createMeetingMinutesUI({
      root,
      document: new FakeDocument(),
      fetcher: async (path) => path === '/api/meeting-minutes'
        ? jsonResponse(200, meetingList())
        : jsonResponse(200, meetingDetail()),
      canEditMinutes: false,
    });
    await flush();
    await view.openMeeting('meeting-1');

    expect(findAll(root, (node) => node.tagName === 'FORM' && node.className === 'bb-minutes-save-form')).toHaveLength(0);
    expect(findAll(root, (node) => node.tagName === 'FORM' && node.className === 'bb-minutes-create-form')).toHaveLength(0);
    const confirm = findAll(root, (node) => node.tagName === 'BUTTON' && node.textContent === 'この版を確認')[0];
    expect(confirm).toBeTruthy();
    expect(confirm.disabled).toBe(true);
    confirm.listeners.get('click')();
    await flush();
    expect(collectText(root)).toContain('この画面では議事録を編集できません。');
  });

  it('rechecks editing permission before saving a version or adding a document', async () => {
    let allowed = true;
    const methods = [];
    const root = new FakeElement('div');
    const view = createMeetingMinutesUI({
      root,
      document: new FakeDocument(),
      fetcher: async (path, init = {}) => {
        methods.push(init.method ?? 'GET');
        return path === '/api/meeting-minutes'
          ? jsonResponse(200, meetingList())
          : jsonResponse(200, meetingDetail());
      },
      canEditMinutes: () => allowed,
    });
    await flush();
    await view.openMeeting('meeting-1');

    const saveForm = findAll(root, (node) => node.tagName === 'FORM' && node.className === 'bb-minutes-save-form')[0];
    const createForm = findAll(root, (node) => node.tagName === 'FORM' && node.className === 'bb-minutes-create-form')[0];
    const confirm = findAll(root, (node) => node.tagName === 'BUTTON' && node.textContent === 'この版を確認')[0];
    expect(saveForm).toBeTruthy();
    expect(createForm).toBeTruthy();
    expect(confirm).toBeTruthy();
    expect(confirm.disabled).toBe(false);

    allowed = false;
    saveForm.listeners.get('submit')({ preventDefault() {} });
    createForm.listeners.get('submit')({ preventDefault() {} });
    confirm.listeners.get('click')();
    await flush();

    expect(methods).toEqual(['GET', 'GET']);
    expect(collectText(root)).toContain('この画面では議事録を編集できません。');
  });
});
