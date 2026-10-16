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
  getAttribute(name) { return name in this.attributes ? this.attributes[name] : null; }
  removeAttribute(name) { delete this.attributes[name]; }
  contains(node) {
    for (let current = node; current; current = current.parentNode) if (current === this) return true;
    return false;
  }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  removeEventListener(name) { this.listeners.delete(name); }
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

  it('rechecks editing permission before confirming a version', async () => {
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

    expect(findAll(root, (node) => node.tagName === 'FORM' && node.className === 'bb-minutes-save-form')).toHaveLength(0);
    expect(collectText(root)).not.toContain('訂正版を保存');
    expect(collectText(root)).not.toContain('新しい版を保存');
    expect(collectText(root)).not.toContain('議事録文書を追加');
    const confirm = findAll(root, (node) => node.tagName === 'BUTTON' && node.textContent === 'この版を確認済みにする')[0];
    expect(confirm).toBeTruthy();
    expect(confirm.disabled).toBe(false);

    allowed = false;
    confirm.listeners.get('click')();
    await flush();

    expect(methods).toEqual(['GET', 'GET']);
    expect(collectText(root)).toContain('確認はプロジェクトの編集権限がある人が行います');
    expect(collectText(root)).not.toContain('この画面では議事録を編集できません。');
  });
});

function at(year, month, day, hour = 0, minute = 0) {
  const pad = (part) => String(part).padStart(2, '0');
  return new Date(`${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00+09:00`).toISOString();
}

function entry({ id, title, scheduledAt, createdAt, minutes = 1, versionIds = 1, versions, calendarStart, latestVersionCreatedAt, participants = [], updatedAt }) {
  const documents = Array.from({ length: minutes }, (_, index) => ({
    minutes_id: `${id}-minutes-${index + 1}`,
    title: '議事録',
    current_version_id: `${id}-version-${versionIds}`,
    version_ids: Array.from({ length: versionIds }, (__, versionIndex) => `${id}-version-${versionIndex + 1}`),
    created_at: createdAt,
    ...(updatedAt ? { updated_at: updatedAt } : {}),
  }));
  return {
    meeting: {
      meeting_id: id,
      title,
      ...(scheduledAt ? { scheduled_at: scheduledAt } : {}),
      ...(calendarStart ? { calendar_start: calendarStart } : {}),
      ...(createdAt ? { created_at: createdAt } : {}),
      ...(latestVersionCreatedAt ? { latest_version_created_at: latestVersionCreatedAt } : {}),
      participant_ids: participants,
    },
    minutes: documents,
    ...(versions ? { versions } : {}),
  };
}

describe('meeting minutes page review', () => {
  const today = new Date('2026-10-14T12:00:00+09:00');

  function mount(meetings, { detailFor, canEditMinutes = true, now = () => today, canCreateMeeting, createUnavailableReason, hostFilters } = {}) {
    const root = new FakeElement('div');
    const view = createMeetingMinutesUI({
      root,
      document: new FakeDocument(),
      now,
      canEditMinutes,
      ...(canCreateMeeting === undefined ? {} : { canCreateMeeting }),
      ...(createUnavailableReason === undefined ? {} : { createUnavailableReason }),
      ...(hostFilters === undefined ? {} : { hostFilters }),
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
    expect(collectText(list.children[5])).toContain('日時未登録・版の作成 10/12');
    expect(collectText(list.children[5])).not.toMatch(/\d{1,2}:\d{2}/);
    expect(collectText(list.children[5])).not.toContain('9:30');
    expect(collectText(list.children[5])).not.toContain('日時未登録・取り込み');
    expect(collectText(list.children[7])).toContain('日時未登録・取り込み 10/14');
    expect(collectText(list.children[8])).toContain('日時未登録・取り込み 10/1');
    const count = findAll(root, (node) => node.className === 'bb-minutes-sort-note')[0];
    expect(count.textContent).toBe('5件');
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
    expect(collectText(rows[2])).toContain('日時未登録・予定の開始 10/13');
    expect(collectText(rows[2])).not.toContain('18:00');
    expect(collectText(rows[2])).not.toContain('日時未登録・取り込み');
    expect(collectText(rows[3])).toContain('日時未登録・版の作成 10/12');
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

  it('shows creator, relative time, and confirmer on each version history row', async () => {
    const versions = [
      {
        version_id: 'version-1',
        minutes_id: 'minutes-1',
        body: '古い本文',
        created_at: at(2026, 10, 13, 11, 20),
        created_actor_id: 'Worker',
      },
      {
        version_id: 'version-2',
        minutes_id: 'minutes-1',
        body: '新しい本文',
        created_at: at(2026, 10, 13, 16, 5),
        created_actor_id: 'Worker',
        predecessor_version_id: 'version-1',
        confirmation: { version_id: 'version-2', actor_id: '佐藤圭吾', confirmed_at: at(2026, 10, 13, 18, 10) },
      },
    ];
    const { root, view } = mount([entry({ id: 'meeting-1', title: '履歴のある会議', scheduledAt: at(2026, 10, 14, 10, 0) })], {
      detailFor: () => ({
        meeting: { meeting_id: 'meeting-1', title: '履歴のある会議', scheduled_at: at(2026, 10, 14, 10, 0), participant_ids: [] },
        minutes: [{ minutes_id: 'minutes-1', title: '議事録', current_version_id: 'version-2', revision: 2 }],
        versions,
        snapshot_revision: 2,
      }),
    });
    await flush();
    await view.openMeeting('meeting-1');
    const history = findAll(root, (node) => node.className.includes('bb-minutes-version-history'))[0];
    const rows = history.children.map((child) => collectText(child));
    expect(rows[0]).toContain('第2版（最新）');
    expect(rows[0]).toContain('10/13 16:05 作成（昨日）');
    expect(rows[0]).toContain('作成 Worker・10/13 18:10 佐藤圭吾が確認・第1版を訂正');
    expect(rows[1]).toContain('10/13 11:20 作成（昨日）');
    expect(rows[1]).toContain('作成 Worker・確認されないまま第2版に置き換え');
    expect(history.children[0].children.map((child) => child.className)).toEqual([
      'bb-minutes-version-line',
      'bb-minutes-version-line is-secondary',
    ]);
    expect(collectText(history)).not.toContain('未確認');
  });

  it('says the creator is unrecorded when created_actor_id is missing', async () => {
    const { root, view } = mount([entry({ id: 'meeting-1', title: '作成者のない会議', scheduledAt: at(2026, 10, 14, 10, 0) })], {
      detailFor: () => ({
        meeting: { meeting_id: 'meeting-1', title: '作成者のない会議', scheduled_at: at(2026, 10, 14, 10, 0), participant_ids: [] },
        minutes: [{ minutes_id: 'minutes-1', title: '議事録', current_version_id: 'version-1', revision: 1 }],
        versions: [{
          version_id: 'version-1',
          minutes_id: 'minutes-1',
          body: '本文',
          created_at: at(2026, 10, 14, 9, 0),
        }],
        snapshot_revision: 1,
      }),
    });
    await flush();
    await view.openMeeting('meeting-1');
    expect(collectText(root)).toContain('10/14 09:00 作成（今日）');
    expect(collectText(root)).toContain('作成者は未記録・確認待ち');
    expect(collectText(root)).not.toContain('未確認');
  });

  it('keeps meeting rows on an 85px pitch so twelve fit in the 1920×1200 area', async () => {
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
    const tokens = readFileSync(new URL('../../ui/brainbase-tokens.css', import.meta.url), 'utf8');
    expect(css).toContain('var(--bb-color-brand-indigo)');
    expect(css).toContain('minmax(340px, 380px)');
    expect(css).toContain('height: 85px');
    expect(css).toContain('height: 79px');
    expect(css).not.toContain('max-height: 52px');
    expect(css).not.toContain('box-shadow');
    expect(tokens).toContain('--bb-color-brand-indigo: #0F2A43;');
    const guard = css.slice(css.indexOf('.bb-minutes-edit-guard.is-info'), css.indexOf('.bb-minutes-source-link'));
    expect(guard).toContain('var(--bb-color-muted)');
    expect(guard).not.toContain('danger');
    expect(source).not.toContain('未確認');
    expect(source).toContain('function historyStamp');
    expect(source).toContain('function historySecondLine');
    expect(source).toContain("const TOKYO = 'Asia/Tokyo'");
    expect(css).toContain('overflow-wrap: anywhere');
    expect(1200 - 160).toBeGreaterThanOrEqual(12 * 85);
  });

  it('shows guidance in the detail pane before a meeting is selected', async () => {
    const { root } = mount([entry({ id: 'meeting-1', title: '未選択', scheduledAt: at(2026, 10, 14, 10, 0) })]);
    await flush();
    const detail = findAll(root, (node) => node.className.includes('bb-minutes-detail-pane'))[0];
    expect(collectText(detail)).toContain('議事録を選ぶと、ここに本文が出ます。');
  });

  it('does not show version save or document add forms on the readonly version screen', async () => {
    const { root, view } = mount([entry({ id: 'meeting-1', title: '読み取り', scheduledAt: at(2026, 10, 14, 10, 0) })], {
      detailFor: () => ({
        meeting: { meeting_id: 'meeting-1', title: '読み取り', scheduled_at: at(2026, 10, 14, 10, 0), participant_ids: [] },
        minutes: [{ minutes_id: 'minutes-1', title: '議事録', current_version_id: 'version-1', revision: 1 }],
        versions: [{ version_id: 'version-1', minutes_id: 'minutes-1', body: '本文', created_at: at(2026, 10, 14, 10, 0), created_actor_id: 'Worker' }],
        snapshot_revision: 1,
      }),
    });
    await flush();
    await view.openMeeting('meeting-1');
    expect(collectText(root)).not.toContain('訂正版を保存');
    expect(collectText(root)).not.toContain('新しい版を保存');
    expect(collectText(root)).not.toContain('議事録文書を追加');
    expect(findAll(root, (node) => node.tagName === 'FORM' && node.className === 'bb-minutes-save-form')).toHaveLength(0);
  });

  it('orders version history by created_at when the payload order is mixed', async () => {
    const versions = [
      { version_id: 'version-2', minutes_id: 'minutes-1', body: '中', created_at: at(2026, 10, 13, 11, 20), created_actor_id: 'Worker' },
      { version_id: 'version-3', minutes_id: 'minutes-1', body: '新', created_at: at(2026, 10, 13, 16, 5), created_actor_id: 'Worker', predecessor_version_id: 'version-2' },
      { version_id: 'version-1', minutes_id: 'minutes-1', body: '古', created_at: at(2026, 10, 12, 9, 0), created_actor_id: 'Worker' },
    ];
    const { root, view } = mount([entry({ id: 'meeting-1', title: '順不同', scheduledAt: at(2026, 10, 14, 10, 0) })], {
      detailFor: () => ({
        meeting: { meeting_id: 'meeting-1', title: '順不同', scheduled_at: at(2026, 10, 14, 10, 0), participant_ids: [] },
        minutes: [{ minutes_id: 'minutes-1', title: '議事録', current_version_id: 'version-3', revision: 3 }],
        versions,
        snapshot_revision: 3,
      }),
    });
    await flush();
    await view.openMeeting('meeting-1');
    const history = findAll(root, (node) => node.className.includes('bb-minutes-version-history'))[0];
    const rows = history.children.map((child) => collectText(child));
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain('第3版（最新）');
    expect(rows[0]).toContain('10/13 16:05');
    expect(rows[1]).toContain('第2版');
    expect(rows[2]).toContain('第1版');
    expect(rows[2]).toContain('10/12 09:00');
  });

  it('treats today as the Asia/Tokyo calendar date', async () => {
    const { root } = mount([
      entry({ id: 'line', title: '日付変更線の会議', scheduledAt: '2026-10-13T16:00:00.000Z' }),
    ], { now: () => new Date('2026-10-14T01:00:00.000Z') });
    await flush();
    const list = findAll(root, (node) => node.className === 'bb-minutes-meeting-list')[0];
    expect(collectText(list)).toContain('今日 10/14（水）');
    expect(collectText(list)).toContain('日付変更線の会議');
    expect(collectText(list)).not.toContain('10/13（火）');
  });

  it('hides creation without a reason and never explains it as a missing permission', async () => {
    const { root } = mount([
      entry({ id: 'meeting-1', title: '権限のない会議', scheduledAt: at(2026, 10, 14, 10, 0) }),
    ], { canCreateMeeting: false });
    await flush();
    expect(findAll(root, (node) => node.tagName === 'BUTTON' && node.textContent === '会議を作成')).toHaveLength(0);
    const pane = findAll(root, (node) => node.className.includes('bb-minutes-list-pane'))[0];
    expect(collectText(pane)).toContain('1件');
    expect(collectText(root)).not.toContain('権限がありません');
    expect(collectText(root)).not.toContain('編集権限がある人');
  });

  it('shows a create button that cannot be pressed with the host reason in one phrase', async () => {
    const { root } = mount([
      entry({ id: 'meeting-1', title: '週次定例', scheduledAt: at(2026, 10, 14, 10, 0) }),
    ], { canCreateMeeting: () => false, createUnavailableReason: () => 'プロジェクトを選ぶと作成できます' });
    await flush();
    const create = findAll(root, (node) => node.tagName === 'BUTTON' && node.textContent === '会議を作成');
    expect(create).toHaveLength(1);
    expect(create[0].disabled).toBe(true);
    const reason = findAll(root, (node) => node.className === 'bb-minutes-create-reason')[0];
    expect(reason.textContent).toBe('プロジェクトを選ぶと作成できます');
    expect(create[0].attributes['aria-describedby']).toBe(reason.attributes.id);
    expect(collectText(root)).not.toContain('権限がありません');
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

  function listTitles(root) {
    const list = findAll(root, (node) => node.className === 'bb-minutes-meeting-list')[0];
    return list ? list.children.filter((child) => child.tagName === 'BUTTON').map((child) => child.children[0].textContent) : [];
  }

  function fieldOf(root, label) {
    return findAll(root, (node) => node.className.startsWith('bb-minutes-filter-field')
      && node.children[0]?.textContent === label)[0];
  }

  function pick(root, label, value) {
    const field = fieldOf(root, label);
    const trigger = findAll(field, (node) => node.className === 'bb-ws-combobox-trigger')[0];
    trigger.listeners.get('click')();
    const option = findAll(field, (node) => node.attributes?.['data-value'] === value)[0];
    option.listeners.get('click')();
  }

  function filterMeetings() {
    return [
      entry({ id: 'weekly', title: '週次定例', scheduledAt: at(2026, 10, 14, 10, 0), participants: ['佐藤', '山本'], updatedAt: at(2026, 10, 14, 12, 0) }),
      entry({ id: 'deploy', title: '配備方針の相談', scheduledAt: at(2026, 10, 13, 15, 0), participants: ['田中'], updatedAt: at(2026, 10, 14, 13, 0) }),
      entry({ id: 'review', title: '月次レビュー', scheduledAt: at(2026, 9, 24, 16, 0), participants: ['佐藤'], updatedAt: at(2026, 9, 25, 9, 0) }),
    ];
  }

  it('narrows the loaded list by keyword without reloading and counts what is shown', async () => {
    let calls = 0;
    const root = new FakeElement('div');
    createMeetingMinutesUI({
      root,
      document: new FakeDocument(),
      now: () => today,
      fetcher: async () => { calls += 1; return jsonResponse(200, { absence_confirmed: true, meetings: filterMeetings() }); },
    });
    await flush();
    const keyword = findAll(root, (node) => node.className.includes('bb-minutes-filter-keyword'))[0];
    // Half-width katakana still finds the full-width title.
    keyword.value = 'ﾚﾋﾞｭｰ';
    keyword.listeners.get('input')();
    expect(listTitles(root)).toEqual(['月次レビュー']);
    expect(findAll(root, (node) => node.className === 'bb-minutes-sort-note')[0].textContent).toBe('3件中1件');
    expect(calls).toBe(1);
  });

  it('narrows by a period of meeting dates in Asia/Tokyo', async () => {
    const { root } = mount(filterMeetings());
    await flush();
    const [from, to] = findAll(fieldOf(root, '期間'), (node) => node.tagName === 'INPUT');
    from.value = '2026-10-13';
    from.listeners.get('change')();
    expect(listTitles(root)).toEqual(['週次定例', '配備方針の相談']);
    to.value = '2026-10-13';
    to.listeners.get('change')();
    expect(listTitles(root)).toEqual(['配備方針の相談']);
  });

  it('offers participants only when the records carry them and narrows by one', async () => {
    const plain = mount([entry({ id: 'plain', title: '参加者なし', scheduledAt: at(2026, 10, 14, 10, 0) })]);
    await flush();
    expect(fieldOf(plain.root, '参加者').hidden).toBe(true);

    const { root } = mount(filterMeetings());
    await flush();
    expect(fieldOf(root, '参加者').hidden).toBe(false);
    pick(root, '参加者', '佐藤');
    expect(listTitles(root)).toEqual(['週次定例', '月次レビュー']);
  });

  it('offers the confirmation state only when a row can show it', async () => {
    const { root } = mount([
      entry({ id: 'pending', title: '確認待ちの会議', scheduledAt: at(2026, 10, 14, 10, 0), versions: [{ version_id: 'pending-version-1', minutes_id: 'pending-minutes-1', created_at: at(2026, 10, 14, 10, 5) }] }),
      entry({ id: 'confirmed', title: '確認済みの会議', scheduledAt: at(2026, 10, 13, 10, 0), versions: [{ version_id: 'confirmed-version-1', minutes_id: 'confirmed-minutes-1', created_at: at(2026, 10, 13, 10, 5), confirmation: { version_id: 'confirmed-version-1', actor_id: '佐藤', confirmed_at: at(2026, 10, 13, 11, 0) } }] }),
      entry({ id: 'unknown', title: '状態の無い会議', scheduledAt: at(2026, 10, 12, 10, 0) }),
    ]);
    await flush();
    expect(fieldOf(root, '確認の状態').hidden).toBe(false);
    pick(root, '確認の状態', 'pending');
    expect(listTitles(root)).toEqual(['確認待ちの会議']);
    pick(root, '確認の状態', 'confirmed');
    expect(listTitles(root)).toEqual(['確認済みの会議']);

    const plain = mount(filterMeetings());
    await flush();
    expect(fieldOf(plain.root, '確認の状態').hidden).toBe(true);
  });

  it('sorts by oldest meeting first, or by the latest minutes update without date headings', async () => {
    const { root } = mount(filterMeetings());
    await flush();
    pick(root, '並べ替え', 'scheduled-asc');
    expect(listTitles(root)).toEqual(['月次レビュー', '配備方針の相談', '週次定例']);
    const list = () => findAll(root, (node) => node.className === 'bb-minutes-meeting-list')[0];
    expect(list().children[0].textContent).toBe('9/24（木）');

    pick(root, '並べ替え', 'updated-desc');
    expect(listTitles(root)).toEqual(['配備方針の相談', '週次定例', '月次レビュー']);
    expect(list().children.every((child) => child.tagName === 'BUTTON')).toBe(true);
    expect(collectText(list().children[0])).toContain('10/13 15:00');
    expect(collectText(list().children[0])).toContain('更新 10/14 13:00');
  });

  it('says no meeting matches, keeps that distinct from an empty list, and clears the conditions', async () => {
    const { root } = mount(filterMeetings());
    await flush();
    const keyword = findAll(root, (node) => node.className.includes('bb-minutes-filter-keyword'))[0];
    keyword.value = '存在しない会議';
    keyword.listeners.get('input')();
    const pane = findAll(root, (node) => node.className.includes('bb-minutes-list-pane'))[0];
    expect(collectText(pane)).toContain('条件に合う会議はありません。');
    expect(collectText(pane)).not.toContain('まだ議事録はありません');
    const clearButton = findAll(pane, (node) => node.tagName === 'BUTTON' && node.textContent === '条件を外す')[0];
    clearButton.listeners.get('click')();
    expect(listTitles(root)).toHaveLength(3);
    expect(keyword.value).toBe('');
  });

  it('draws host filters with the shared dropdown and leaves the value to the host', async () => {
    const changes = [];
    let project = '';
    const hostFilters = () => [{
      id: 'project',
      label: 'プロジェクト',
      value: project,
      options: [
        { value: '', label: 'すべてのプロジェクト' },
        { value: 'alpha', label: 'アルファ', hint: 'alpha' },
      ],
      onChange: (value) => { changes.push(value); project = value; },
    }];
    const { root, view } = mount(filterMeetings(), { hostFilters });
    await flush();
    const field = fieldOf(root, 'プロジェクト');
    expect(field).toBeTruthy();
    pick(root, 'プロジェクト', 'alpha');
    expect(changes).toEqual(['alpha']);
    await view.refresh();
    const trigger = findAll(fieldOf(root, 'プロジェクト'), (node) => node.className === 'bb-ws-combobox-trigger')[0];
    expect(trigger.attributes['aria-label']).toBe('プロジェクト: アルファ');
    const reset = findAll(root, (node) => node.className.includes('bb-minutes-filter-reset'))[0];
    expect(reset.hidden).toBe(false);
    reset.listeners.get('click')();
    expect(changes).toEqual(['alpha', '']);
  });
});
