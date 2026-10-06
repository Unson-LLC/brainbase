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
