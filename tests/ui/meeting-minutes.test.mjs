import { readFileSync } from 'node:fs';
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
    this.focusCalls = [];
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
  focus(options) { this.focusCalls.push(options); }
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
    const listPane = findAll(root, (node) => node.className === 'bb-minutes-list-pane')[0];
    expect(listPane.attributes.tabindex).toBe('-1');
    expect(listPane.focusCalls).toEqual([]);
    expect(collectText(root)).toContain('会議一覧を読み込めませんでした。理由: 一時的に保存先を読めません');
    expect(collectText(root)).toContain('再試行');
    expect(collectText(root)).not.toContain('保存された会議はありません');

    const retry = findAll(root, (node) => node.tagName === 'BUTTON' && node.textContent === '再試行')[0];
    retry.listeners.get('click')();
    await flush();
    expect(view.state.meetings).toHaveLength(1);
    expect(listPane.focusCalls).toEqual([{ preventScroll: true }]);
    expect(collectText(root)).toContain('週次定例');
    expect(collectText(root)).not.toContain('一時的に保存先を読めません');

    await view.refresh();
    expect(listPane.focusCalls).toEqual([{ preventScroll: true }]);
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

    expect(findAll(root, (node) => node.tagName === 'BUTTON' && node.textContent === '会議を作成')).toHaveLength(0);
    expect(collectText(root)).not.toContain('この画面では会議を作成できません。');
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
    expect(collectText(root)).not.toContain('この画面では会議を作成できません。');
    expect(findAll(root, (node) => node.tagName === 'FORM' && node.className === 'bb-minutes-create-form')).toHaveLength(0);
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
    expect(findAll(root, (node) => node.tagName === 'BUTTON' && node.textContent === 'この版を確認済みにする')).toHaveLength(0);
    expect(collectText(root)).toContain('確認はプロジェクトの編集権限がある人が行います');
    expect(collectText(root)).not.toContain('この画面では議事録を編集できません。');
    expect(findAll(root, (node) => node.className === 'bb-minutes-edit-guard is-info')).toHaveLength(1);
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
    const confirm = findAll(root, (node) => node.tagName === 'BUTTON' && node.textContent === 'この版を確認済みにする')[0];
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
    expect(collectText(root)).toContain('確認はプロジェクトの編集権限がある人が行います');
    expect(collectText(root)).not.toContain('この画面では議事録を編集できません。');
  });
});

function at(year, month, day, hour = 0, minute = 0) {
  return new Date(year, month - 1, day, hour, minute).toISOString();
}

function entry({ id, title, scheduledAt, createdAt, minutes = 1, versionIds = 1, versions, calendarStart, latestVersionCreatedAt }) {
  const documents = Array.from({ length: minutes }, (_, index) => ({
    minutes_id: `${id}-minutes-${index + 1}`,
    title: '議事録',
    current_version_id: `${id}-version-${versionIds}`,
    version_ids: Array.from({ length: versionIds }, (__, versionIndex) => `${id}-version-${versionIndex + 1}`),
    created_at: createdAt,
  }));
  return {
    meeting: {
      meeting_id: id,
      title,
      ...(scheduledAt ? { scheduled_at: scheduledAt } : {}),
      ...(calendarStart ? { calendar_start: calendarStart } : {}),
      ...(createdAt ? { created_at: createdAt } : {}),
      ...(latestVersionCreatedAt ? { latest_version_created_at: latestVersionCreatedAt } : {}),
      participant_ids: [],
    },
    minutes: documents,
    ...(versions ? { versions } : {}),
  };
}

describe('meeting minutes page review', () => {
  const today = new Date(2026, 9, 14, 12, 0, 0);

  function mount(meetings, { detailFor, canEditMinutes = true } = {}) {
    const root = new FakeElement('div');
    const view = createMeetingMinutesUI({
      root,
      document: new FakeDocument(),
      now: () => today,
      canEditMinutes,
      fetcher: async (path) => {
        if (path === '/api/meeting-minutes') return jsonResponse(200, { absence_confirmed: true, meetings });
        const id = decodeURIComponent(path.split('/').pop());
        return jsonResponse(200, detailFor(id));
      },
    });
    return { root, view };
  }

  it('orders dated meetings newest first, keeps today first, and does not count a single minutes document', async () => {
    const meetings = [
      entry({ id: 'old-import', title: '古い取り込み', createdAt: at(2026, 10, 1, 9, 0) }),
      entry({ id: 'yesterday', title: '昨日の会議', scheduledAt: at(2026, 10, 13, 15, 0), minutes: 2, versionIds: 2 }),
      entry({
        id: 'fallback',
        title: '版の日時だけ',
        latestVersionCreatedAt: at(2026, 10, 12, 9, 30),
      }),
      entry({
        id: 'umeda',
        title: '梅田さん定例 議事録（下書き）',
        scheduledAt: at(2026, 10, 14, 10, 0),
        versions: [{ version_id: 'umeda-version-1', minutes_id: 'umeda-minutes-1', created_at: at(2026, 10, 14, 10, 5) }],
      }),
      entry({ id: 'new-import', title: '新しい取り込み', createdAt: at(2026, 10, 14, 18, 0) }),
    ];
    const { root } = mount(meetings);
    await flush();
    const list = findAll(root, (node) => node.className === 'bb-minutes-meeting-list')[0];
    const sequence = list.children.map((child) => child.tagName === 'BUTTON'
      ? child.children[0].textContent
      : child.textContent);
    expect(sequence).toEqual([
      '今日 10/14（水）',
      '梅田さん定例 議事録（下書き）',
      '10/13（火）',
      '昨日の会議',
      '10/12（月）',
      '版の日時だけ',
      '会議の日時が未登録（取り込んだ日の新しい順）',
      '新しい取り込み',
      '古い取り込み',
    ]);
    expect(sequence[0]).toBe('今日 10/14（水）');
    expect(collectText(list.children[5])).toContain('日時未登録・取り込み 10/12');
    expect(collectText(list.children[5])).not.toMatch(/\d{1,2}:\d{2}/);
    expect(collectText(list.children[5])).not.toContain('9:30');
    expect(collectText(list.children[7])).not.toContain('日時未登録・取り込み');
    expect(collectText(root)).toContain('新しい順・5件');
    expect(collectText(root)).not.toContain('1件の議事録');
    expect(collectText(root)).not.toContain('件の議事録');
    expect(collectText(list.children[3])).toContain('議事録 2件');
    expect(collectText(list.children[3])).toContain('第2版');
    expect(collectText(list.children[1])).toContain('確認待ち');
    expect(collectText(list.children[1])).not.toContain('第1版');
    expect(collectText(root)).not.toContain('未確認');
    expect(collectText(root)).not.toContain('この予定につなぐ');
    expect(collectText(root)).not.toContain('予定を選ぶ');
  });

  it('uses a calendar start before a newer version time and ignores an invalid scheduled_at', async () => {
    const meetings = [
      entry({
        id: 'calendar',
        title: '予定の開始だけ',
        calendarStart: at(2026, 10, 13, 8, 0),
        latestVersionCreatedAt: at(2026, 10, 14, 18, 0),
      }),
      entry({
        id: 'invalid',
        title: '壊れた日時',
        scheduledAt: 'not-a-date',
        latestVersionCreatedAt: at(2026, 10, 12, 11, 0),
      }),
      entry({ id: 'same-a', title: '同時刻A', scheduledAt: at(2026, 10, 14, 9, 0) }),
      entry({ id: 'same-b', title: '同時刻B', scheduledAt: at(2026, 10, 14, 9, 0) }),
    ];
    const { root } = mount(meetings);
    await flush();
    const list = findAll(root, (node) => node.className === 'bb-minutes-meeting-list')[0];
    const rows = list.children.filter((child) => child.tagName === 'BUTTON');
    expect(rows.map((child) => child.children[0].textContent)).toEqual(['同時刻A', '同時刻B', '予定の開始だけ', '壊れた日時']);
    expect(collectText(rows[2])).toContain('日時未登録・取り込み 10/13');
    expect(collectText(rows[2])).not.toContain('18:00');
    expect(collectText(rows[3])).toContain('日時未登録・取り込み 10/12');
    expect(collectText(rows[3])).not.toContain('not-a-date');
    expect(collectText(root)).not.toContain('未確認');
  });

  it('shows 確認待ち, a confirmed person and time, an old-version banner, and markdown without raw marks', async () => {
    const markdown = '# 決まったこと\n- 来週までに確認する\n------\n## 宿題\n1. 資料を送る\n<script>alert(1)</script>';
    const versions = [
      { version_id: 'version-1', minutes_id: 'minutes-1', body: '古い本文', created_at: at(2026, 10, 13, 9, 0) },
      {
        version_id: 'version-2',
        minutes_id: 'minutes-1',
        body: markdown,
        created_at: at(2026, 10, 13, 18, 0),
        predecessor_version_id: 'version-1',
        confirmation: { version_id: 'version-2', actor_id: '佐藤圭吾', confirmed_at: at(2026, 10, 13, 18, 10) },
      },
    ];
    const { root, view } = mount([entry({ id: 'meeting-1', title: '確認する会議', scheduledAt: at(2026, 10, 14, 10, 0) })], {
      detailFor: () => ({
        meeting: { meeting_id: 'meeting-1', title: '確認する会議', scheduled_at: at(2026, 10, 14, 10, 0), participant_ids: [] },
        minutes: [{ minutes_id: 'minutes-1', title: '議事録', current_version_id: 'version-2', revision: 2 }],
        versions,
        snapshot_revision: 2,
      }),
    });
    await flush();
    await view.openMeeting('meeting-1');
    expect(collectText(root)).toContain('10/13 18:10 佐藤圭吾が確認');
    expect(collectText(root)).toContain('決まったこと');
    expect(collectText(root)).toContain('来週までに確認する');
    expect(collectText(root)).toContain('宿題');
    expect(collectText(root)).toContain('資料を送る');
    expect(collectText(root)).not.toContain('#');
    expect(collectText(root)).not.toContain('------');
    expect(findAll(root, (node) => node.tagName === 'SCRIPT')).toHaveLength(0);
    expect(findAll(root, (node) => node.tagName === 'H3' && node.textContent === '決まったこと')).toHaveLength(1);
    expect(findAll(root, (node) => node.tagName === 'LI' && node.textContent === '来週までに確認する')).toHaveLength(1);
    expect(collectText(root)).toContain('第1版を訂正');
    expect(collectText(root)).not.toContain('未確認');
    expect(collectText(root)).not.toContain('第2版の本文');

    const older = findAll(root, (node) => node.tagName === 'BUTTON' && collectText(node).startsWith('第1版'))[0];
    older.listeners.get('click')();
    expect(collectText(root)).toContain('古い版を表示しています。最新は第2版（確認済み）です。');
    expect(collectText(root)).toContain('確認されないまま第2版に置き換え');
    expect(collectText(root)).toContain('古い本文');
    const back = findAll(root, (node) => node.tagName === 'BUTTON' && node.textContent === '最新の版を見る')[0];
    back.listeners.get('click')();
    expect(collectText(root)).not.toContain('古い版を表示しています');
    expect(collectText(root)).toContain('決まったこと');
  });

  it('shows one gray notice and a source link, and hides confirm when editing is denied', async () => {
    const { root, view } = mount([entry({ id: 'meeting-1', title: '読めない会議', scheduledAt: at(2026, 10, 14, 10, 0) })], {
      canEditMinutes: false,
      detailFor: () => ({
        meeting: { meeting_id: 'meeting-1', title: '読めない会議', scheduled_at: at(2026, 10, 14, 10, 0), participant_ids: [] },
        minutes: [{ minutes_id: 'minutes-1', title: '議事録', current_version_id: 'version-1', revision: 1 }],
        versions: [{
          version_id: 'version-1',
          minutes_id: 'minutes-1',
          body: '本文',
          created_at: at(2026, 10, 14, 10, 0),
          source_ref: { provider: 'github', locator: 'https://github.com/example/minutes/1', revision: 'abc', digest: 'digest' },
        }],
        snapshot_revision: 1,
      }),
    });
    await flush();
    await view.openMeeting('meeting-1');
    const notices = findAll(root, (node) => node.className === 'bb-minutes-edit-guard is-info');
    expect(notices).toHaveLength(1);
    expect(collectText(notices[0])).toContain('確認はプロジェクトの編集権限がある人が行います');
    expect(collectText(notices[0])).not.toContain('この画面では議事録を編集できません');
    const link = findAll(notices[0], (node) => node.tagName === 'A')[0];
    expect(link.attributes.href).toBe('https://github.com/example/minutes/1');
    expect(link.textContent).toBe('元の記録を開く（github）');
    expect(findAll(root, (node) => node.textContent === 'この版を確認済みにする')).toHaveLength(0);
    expect(findAll(root, (node) => node.className.includes('error'))).toHaveLength(0);
    expect(collectText(root)).toContain('確認待ち');
    expect(collectText(root)).not.toContain('未確認');
  });

  it('omits the source link when the locator is not an http URL and names an unreadable confirmation', async () => {
    const { root, view } = mount([entry({ id: 'meeting-1', title: '記録のない会議', scheduledAt: at(2026, 10, 14, 10, 0) })], {
      canEditMinutes: false,
      detailFor: () => ({
        meeting: { meeting_id: 'meeting-1', title: '記録のない会議', participant_ids: [] },
        minutes: [{ minutes_id: 'minutes-1', title: '議事録', current_version_id: 'version-1', revision: 1 }],
        versions: [{
          version_id: 'version-1',
          minutes_id: 'minutes-1',
          body: '本文',
          created_at: at(2026, 10, 14, 10, 0),
          confirmation: 'unreadable',
          source_ref: { provider: 'github', locator: 'docs/minutes/1.md', revision: 'abc', digest: 'digest' },
        }],
        snapshot_revision: 1,
      }),
    });
    await flush();
    await view.openMeeting('meeting-1');
    expect(findAll(root, (node) => node.tagName === 'A')).toHaveLength(0);
    expect(collectText(root)).toContain('本文を直すときは、議事録を取り込んだ元で編集してください。');
    expect(collectText(root)).toContain('確認の状態を確かめられません');
    expect(collectText(root)).not.toContain('未確認');
    expect(collectText(root)).not.toContain('この版を確認済みにする');
  });

  it('keeps twelve two-line rows inside the 1280×800 list budget', async () => {
    const meetings = Array.from({ length: 12 }, (_, index) => entry({
      id: `row-${index + 1}`,
      title: `行${index + 1}`,
      scheduledAt: at(2026, 10, 14, 10, index),
    }));
    const { root } = mount(meetings);
    await flush();
    const rows = findAll(root, (node) => node.className.includes('bb-minutes-meeting-item'));
    expect(rows).toHaveLength(12);
    for (const row of rows) {
      expect(row.children.map((child) => child.className)).toEqual(['bb-minutes-item-title', 'bb-minutes-item-line']);
    }
    const css = readFileSync(new URL('../../ui/meeting-minutes.css', import.meta.url), 'utf8');
    const source = readFileSync(new URL('../../ui/meeting-minutes.js', import.meta.url), 'utf8');
    expect(css).toContain('var(--bb-color-brand-indigo)');
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
    const tokens = readFileSync(new URL('../../ui/brainbase-tokens.css', import.meta.url), 'utf8');
    expect(tokens).toContain('--bb-color-brand-indigo: #0F2A43;');
    expect(css).toContain('min-height: 44px');
    expect(css).toContain('max-height: 52px');
    expect(css).not.toContain('box-shadow');
    const guard = css.slice(css.indexOf('.bb-minutes-edit-guard'), css.indexOf('.bb-minutes-source-link'));
    expect(guard).toContain('var(--bb-color-muted)');
    expect(guard).not.toContain('danger');
    expect(source).not.toContain('未確認');
    const pageHeading = 96;
    const sortNote = 28;
    expect(800 - pageHeading - sortNote).toBeGreaterThanOrEqual((12 * 44) + 22);
    expect(800 - pageHeading - sortNote).toBeGreaterThanOrEqual((10 * 52) + 22);
  });

  it('uses the empty-list sentence and keeps a failed list distinct from it', async () => {
    const root = new FakeElement('div');
    createMeetingMinutesUI({
      root,
      document: new FakeDocument(),
      fetcher: async () => jsonResponse(200, { absence_confirmed: true, meetings: [] }),
    });
    await flush();
    expect(collectText(root)).toContain('まだ議事録はありません。会議を取り込むと、ここに新しい順で並びます。');
    expect(collectText(root)).not.toContain('保存された会議はありません');
  });
});
