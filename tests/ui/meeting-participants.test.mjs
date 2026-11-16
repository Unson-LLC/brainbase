// 議事録の参加者の行 (story-meeting-participants-row-v1).
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
    this.hidden = false;
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
  focus() {}
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

const meeting = { meeting_id: 'meeting-1', title: 'Tech Knight 経営会議', scheduled_start_at: '2026-10-15T01:00:00.000Z', project_codes: ['techknight'] };

function detail() {
  return {
    meeting,
    minutes: [{ minutes_id: 'minutes-1', title: '議事録', current_version_id: 'version-1', revision: 1 }],
    versions: [{ version_id: 'version-1', minutes_id: 'minutes-1', body: '本文', created_at: '2026-10-15T02:00:00.000Z' }],
    snapshot_revision: 1,
  };
}

async function flush() {
  for (let index = 0; index < 4; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

function participantsSection(root) {
  return findAll(root, (node) => node.className === 'bb-minutes-participants')[0] ?? null;
}

function buttonNamed(root, label) {
  return findAll(root, (node) => node.tagName === 'BUTTON' && node.textContent === label)[0] ?? null;
}

async function mount(meetingParticipants) {
  const root = new FakeElement('div');
  const view = createMeetingMinutesUI({
    root,
    document: new FakeDocument(),
    fetcher: async (path) => (path === '/api/meeting-minutes'
      ? jsonResponse(200, { absence_confirmed: true, meetings: [{ meeting, minutes: [] }] })
      : jsonResponse(200, detail())),
    meetingParticipants,
  });
  await flush();
  await view.openMeeting('meeting-1');
  await flush();
  return { root, view };
}

const recorded = {
  status: 'recorded',
  participants: [
    { display_name: 'taku', state: 'linked', entity_id: 'per_yui', entity_type: 'person', name: '由井 拓翔', href: '/?screen=people&entity_id=per_yui', removable: false },
    { display_name: '白幡', state: 'unconfirmed', other_meetings: 2 },
    { display_name: 'TechKnight', state: 'not_person', removable: true },
  ],
  redrafting: false,
};

describe('meeting participants row', () => {
  it('shows linked people as links, unconfirmed ones as badges and non-people as plain names (AC-01, AC-03)', async () => {
    const reads = [];
    const { root } = await mount({ read: async (input) => { reads.push(input); return recorded; } });

    expect(reads).toHaveLength(1);
    expect(reads[0].meeting.meeting_id).toBe('meeting-1');
    const section = participantsSection(root);
    expect(section.hidden).toBe(false);
    const link = findAll(section, (node) => node.tagName === 'A')[0];
    expect(link.textContent).toBe('由井 拓翔');
    expect(link.attributes.href).toBe('/?screen=people&entity_id=per_yui');
    expect(collectText(section)).toContain('（taku）');
    const badge = buttonNamed(section, '白幡（未確認）');
    expect(badge).not.toBeNull();
    expect(badge.attributes['aria-expanded']).toBe('false');
    expect(collectText(section)).toContain('TechKnight（人ではない）');
    expect(buttonNamed(section, 'TechKnight（未確認）')).toBeNull();
  });

  it('shows nothing for none and without a host loader, and says it could not read on failure (AC-01, AC-02)', async () => {
    const none = await mount({ read: async () => ({ status: 'none' }) });
    expect(participantsSection(none.root).hidden).toBe(true);
    expect(collectText(participantsSection(none.root))).toBe('');

    const absent = await mount(undefined);
    expect(participantsSection(absent.root)).toBeNull();

    const failing = await mount({ read: async () => { throw new Error('boom'); } });
    expect(collectText(participantsSection(failing.root))).toContain('参加者を読み込めませんでした');
    expect(collectText(failing.root)).toContain('本文');

    const malformed = await mount({ read: async () => ({ status: 'recorded', participants: [{ display_name: 'x', state: 'linked' }] }) });
    expect(collectText(participantsSection(malformed.root))).toContain('参加者を読み込めませんでした');
  });

  it('does not link to unsafe addresses', async () => {
    const { root } = await mount({ read: async () => ({
      status: 'recorded',
      participants: [{ display_name: 'x', state: 'linked', entity_id: 'per_x', name: 'X', href: 'javascript:alert(1)' }],
    }) });
    expect(findAll(participantsSection(root), (node) => node.tagName === 'A')).toHaveLength(0);
    expect(collectText(participantsSection(root))).toContain('X');
  });

  it('opens the panel with candidates and evidence and links one person at a time (AC-04, AC-05)', async () => {
    const calls = [];
    let state = recorded;
    const { root } = await mount({
      read: async () => state,
      candidates: async (input, displayName) => {
        calls.push(['candidates', input.meeting.meeting_id, displayName]);
        return {
          display_name: displayName,
          other_meetings: 2,
          people: [{ entity_id: 'per_shirahata', name: '白幡 一郎', evidence: ['名前に「白幡」を含む'] }],
          contacts: [{ contact_id: 'ctc_1', name: '白幡 一郎', company: 'タカショー', evidence: ['名刺：タカショー'] }],
          companies: [{ entity_id: 'org_takasho', name: 'タカショー', evidence: [] }],
        };
      },
      link: async (input, body) => {
        calls.push(['link', input.meeting.meeting_id, body]);
        state = { ...recorded, participants: recorded.participants.map((participant) => (participant.display_name === '白幡'
          ? { display_name: '白幡', state: 'linked', entity_id: 'per_shirahata', name: '白幡 一郎', href: '/?screen=people&entity_id=per_shirahata', removable: true }
          : participant)), redrafting: true };
        return { linked: { display_name: '白幡', state: 'linked', entity_id: 'per_shirahata', name: '白幡 一郎' }, redraft: { meetings: 3 } };
      },
    });

    buttonNamed(root, '白幡（未確認）').listeners.get('click')();
    await flush();
    const section = participantsSection(root);
    expect(calls[0]).toEqual(['candidates', 'meeting-1', '白幡']);
    expect(collectText(section)).toContain('同じ表示名の議事録があと2件あります。結ぶとそれらも作り直します。');
    expect(collectText(section)).toContain('名前に「白幡」を含む');
    expect(collectText(section)).toContain('名刺：タカショー');
    expect(buttonNamed(section, 'タカショー（会社）に結ぶ')).not.toBeNull();
    expect(buttonNamed(section, '結ばない')).not.toBeNull();
    expect(buttonNamed(section, '新しい人として登録')).not.toBeNull();
    expect(buttonNamed(section, '白幡（未確認）').attributes['aria-expanded']).toBe('true');
    expect(findAll(section, (node) => /すべて|一括/u.test(node.textContent ?? '')).length).toBe(0);

    buttonNamed(section, 'この人').listeners.get('click')();
    await flush();
    expect(calls[1]).toEqual(['link', 'meeting-1', { display_name: '白幡', action: 'person', entity_id: 'per_shirahata' }]);
    const after = participantsSection(root);
    expect(collectText(after)).toContain('「白幡」を白幡 一郎に結びました。議事録3件を作り直します（数分かかります）。');
    expect(collectText(after)).toContain('名前を結んだので、この議事録を作り直しています。');
    expect(findAll(after, (node) => node.tagName === 'A').map((node) => node.textContent)).toContain('白幡 一郎');
    expect(findAll(after, (node) => node.className === 'bb-minutes-participant-panel')).toHaveLength(0);
  });

  it('registers a new person with the confirmed name, and offers the existing person when the host says one exists (AC-05)', async () => {
    const bodies = [];
    const { root } = await mount({
      read: async () => recorded,
      candidates: async () => ({ other_meetings: 0, people: [], contacts: [], companies: [] }),
      link: async (_input, body) => {
        bodies.push(body);
        const error = new Error('同じ名前の人がいます。');
        error.candidate = { entity_id: 'per_same', name: '白幡 太郎' };
        throw error;
      },
    });
    buttonNamed(root, '白幡（未確認）').listeners.get('click')();
    await flush();
    const section = participantsSection(root);
    expect(collectText(section)).toContain('人物と名刺に、それらしい候補はありませんでした。');
    const input = findAll(section, (node) => node.tagName === 'INPUT')[0];
    expect(input.value).toBe('白幡');
    input.value = '白幡 太郎';
    input.listeners.get('input')();
    buttonNamed(section, '新しい人として登録').listeners.get('click')();
    await flush();
    expect(bodies[0]).toEqual({ display_name: '白幡', action: 'new_person', name: '白幡 太郎' });
    const after = participantsSection(root);
    expect(collectText(after)).toContain('同じ名前の人がいます。この人で良ければ選んでください。');
    expect(collectText(after)).toContain('白幡 太郎');
    expect(buttonNamed(after, 'この人')).not.toBeNull();
  });

  it('records not-a-person, closes with あとで, and undoes with 取り消す (AC-04, AC-06)', async () => {
    const calls = [];
    const { root } = await mount({
      read: async () => recorded,
      candidates: async () => ({ other_meetings: 0, people: [], contacts: [], companies: [] }),
      link: async (_input, body) => { calls.push(['link', body]); return { linked: { display_name: body.display_name, state: 'not_person' }, redraft: { meetings: 0 } }; },
      unlink: async (_input, body) => { calls.push(['unlink', body]); return { unlinked: body, redraft: { meetings: 1 } }; },
    });
    buttonNamed(root, '白幡（未確認）').listeners.get('click')();
    await flush();
    buttonNamed(participantsSection(root), 'あとで').listeners.get('click')();
    await flush();
    expect(findAll(participantsSection(root), (node) => node.className === 'bb-minutes-participant-panel')).toHaveLength(0);
    expect(calls).toHaveLength(0);

    buttonNamed(root, '白幡（未確認）').listeners.get('click')();
    await flush();
    buttonNamed(participantsSection(root), '結ばない').listeners.get('click')();
    await flush();
    expect(calls[0]).toEqual(['link', { display_name: '白幡', action: 'not_person' }]);
    expect(collectText(participantsSection(root))).toContain('「白幡」を記録しました。');

    buttonNamed(participantsSection(root), '取り消す').listeners.get('click')();
    await flush();
    expect(calls[1]).toEqual(['unlink', { display_name: 'TechKnight' }]);
    expect(collectText(participantsSection(root))).toContain('「TechKnight」の結び付きを取り消しました。議事録1件を作り直します（数分かかります）。');
  });
});
