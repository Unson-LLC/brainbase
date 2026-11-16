// UNS-264: the meeting list returns body-free summaries and is bounded by a
// limit with a cursor so a growing archive never has to serialize every
// meeting (and its minutes bodies) into one response.
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createMeetingMinutesHttpHandler } from '../src/meeting-minutes-http.js';
import {
  createMeetingMinutesStore,
  MEETING_MINUTES_LIST_DEFAULT_LIMIT,
  MEETING_MINUTES_LIST_MAX_LIMIT,
  type MeetingMinutesRequestContext,
} from '../src/meeting-minutes.js';

const OWNER: MeetingMinutesRequestContext = { principal_id: 'per_owner' };

const directories: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

// Titles added to the returned set become unreadable. The set is read live so
// a meeting can be created (its readback needs read access) and only then
// hidden from the listing.
async function openStore(): Promise<{ store: ReturnType<typeof createMeetingMinutesStore>; denyTitles: Set<string> }> {
  const dir = await mkdtemp(join(tmpdir(), 'brainbase-minutes-list-'));
  directories.push(dir);
  const denyTitles = new Set<string>();
  let tick = 0;
  const store = createMeetingMinutesStore({
    data_dir: dir,
    now: () => new Date(Date.UTC(2026, 10, 3, 0, 0, tick++)),
    authorizer: {
      // A meeting record is the only resource whose title we can see here; its
      // minutes documents and versions carry no title and stay readable, so a
      // denied meeting is fully excluded from the listing by its meeting record.
      can_read: (resource) => !('title' in resource) || !denyTitles.has(resource.title as string),
      can_write: () => true,
    },
  });
  return { store, denyTitles };
}

async function createMeetings(store: ReturnType<typeof createMeetingMinutesStore>, count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const created = await store.create_meeting({ title: `会議${index}`, initial_body: `本文の中身${index}` }, OWNER);
    ids.push(created.meeting.meeting_id);
  }
  return ids;
}

describe('meeting list is body-free and paginated (UNS-264)', () => {
  it('returns meeting and minutes-document summaries without any version body', async () => {
    const { store } = await openStore();
    const ids = await createMeetings(store, 3);
    const page = await store.list_meetings(OWNER, {});
    expect(page.meetings.map((entry) => entry.meeting.meeting_id)).toEqual([...ids].reverse());
    for (const entry of page.meetings) {
      expect(Object.keys(entry).sort()).toEqual(['current_version_states', 'meeting', 'minutes']);
      expect(entry.current_version_states).toEqual([{
        minutes_id: entry.minutes[0].minutes_id, version_id: entry.minutes[0].current_version_id, status: 'pending',
      }]);
      expect(entry.minutes).toHaveLength(1);
      // A document summary never carries the writable body; it only names its versions.
      expect(entry.minutes[0]).not.toHaveProperty('body');
      expect(entry.minutes[0].version_ids.length).toBeGreaterThan(0);
    }
    // The bodies live only in the detail, never in the serialized listing.
    expect(JSON.stringify(page)).not.toContain('本文の中身');
    const detail = await store.get_meeting(ids[0], OWNER);
    expect(detail.versions.map((version) => version.body)).toContain('本文の中身0');
  });

  it('keeps the whole archive reachable one bounded page at a time', async () => {
    const { store } = await openStore();
    const ids = await createMeetings(store, 5);
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await store.list_meetings(OWNER, { limit: 2, cursor });
      expect(page.meetings.length).toBeLessThanOrEqual(2);
      seen.push(...page.meetings.map((entry) => entry.meeting.meeting_id));
      cursor = page.next_cursor;
      pages += 1;
      expect(pages).toBeLessThanOrEqual(5); // guard against a non-terminating cursor
    } while (cursor !== undefined);
    expect(seen).toEqual([...ids].reverse());
    expect(new Set(seen).size).toBe(ids.length);
  });

  it('returns the newest 50 meeting dates and keeps older pages stable when a new meeting is inserted', async () => {
    const { store } = await openStore();
    const older = await store.create_meeting({ title: 'Older', scheduled_at: '2026-10-01T00:00:00Z' }, OWNER);
    const ids: string[] = [];
    for (let index = 0; index < 51; index += 1) {
      const created = await store.create_meeting({ title: `Recent ${index}`, scheduled_at: new Date(Date.UTC(2026, 10, index + 1)).toISOString() }, OWNER);
      ids.push(created.meeting.meeting_id);
    }
    // An older import created last must not displace the newest meeting dates.
    await store.create_meeting({ title: 'Undated import' }, OWNER);
    const first = await store.list_meetings(OWNER, { limit: 50 });
    expect(first.meetings.map(entry => entry.meeting.meeting_id)).toEqual([...ids].reverse().slice(0, 50));
    await store.create_meeting({ title: 'Newest', scheduled_at: '2027-01-01T00:00:00Z' }, OWNER);
    const second = await store.list_meetings(OWNER, { limit: 50, cursor: first.next_cursor });
    expect(second.meetings.slice(0, 2).map(entry => entry.meeting.meeting_id)).toEqual([ids[0], older.meeting.meeting_id]);
    expect(second.meetings).toHaveLength(3);
    expect(second.meetings[2].meeting.title).toBe('Undated import');
    expect(second.next_cursor).toBeUndefined();
  });

  it('omits next_cursor on the last (or only) page and defaults to a bounded limit', async () => {
    const { store } = await openStore();
    await createMeetings(store, 3);
    const page = await store.list_meetings(OWNER, {});
    expect(page.next_cursor).toBeUndefined();
    expect(page.meetings.length).toBeLessThanOrEqual(MEETING_MINUTES_LIST_DEFAULT_LIMIT);
    expect(MEETING_MINUTES_LIST_DEFAULT_LIMIT).toBeLessThanOrEqual(MEETING_MINUTES_LIST_MAX_LIMIT);
  });

  it('counts only readable meetings toward a page and pages over the readable subset', async () => {
    // Every even-indexed meeting is hidden after creation; the listing must
    // skip them without letting them consume a page slot or break the cursor.
    const { store, denyTitles } = await openStore();
    const ids = await createMeetings(store, 6); // 会議0..会議5
    for (const index of [0, 2, 4]) denyTitles.add(`会議${index}`);
    const readable = [ids[5], ids[3], ids[1]];
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await store.list_meetings(OWNER, { limit: 1, cursor });
      seen.push(...page.meetings.map((entry) => entry.meeting.meeting_id));
      cursor = page.next_cursor;
    } while (cursor !== undefined);
    expect(seen).toEqual(readable);
  });

  it('caps an oversized limit at the maximum rather than refusing it', async () => {
    const { store } = await openStore();
    const ids = await createMeetings(store, 3);
    const page = await store.list_meetings(OWNER, { limit: MEETING_MINUTES_LIST_MAX_LIMIT + 1000 });
    expect(page.meetings.map((entry) => entry.meeting.meeting_id)).toEqual([...ids].reverse());
    expect(page.next_cursor).toBeUndefined();
  });

  it('keeps the pre-paging array shape when called without options', async () => {
    // Organization server-parts and other 0.47-0.50.0 callers read
    // list_meetings(context) with Array.isArray, so the bare call must keep
    // returning every readable summary as a plain array, never a page object.
    const { store, denyTitles } = await openStore();
    const ids = await createMeetings(store, 4);
    denyTitles.add('会議1');
    const listed = await store.list_meetings(OWNER);
    expect(Array.isArray(listed)).toBe(true);
    expect(listed).not.toHaveProperty('next_cursor');
    expect(listed.map((entry) => entry.meeting.meeting_id)).toEqual([ids[0], ids[2], ids[3]]);
    expect(JSON.stringify(listed)).not.toContain('本文の中身');
  });

  it('does not truncate the array form at the page default limit', async () => {
    const { store } = await openStore();
    const ids = await createMeetings(store, MEETING_MINUTES_LIST_DEFAULT_LIMIT + 1);
    const listed = await store.list_meetings(OWNER);
    expect(Array.isArray(listed)).toBe(true);
    expect(listed.map((entry) => entry.meeting.meeting_id)).toEqual(ids);
    const page = await store.list_meetings(OWNER, {});
    expect(page.meetings).toHaveLength(MEETING_MINUTES_LIST_DEFAULT_LIMIT);
    expect(typeof page.next_cursor).toBe('string');
  }, 60_000);

  it('rejects a non-positive limit and an unresolvable cursor', async () => {
    const { store } = await openStore();
    await createMeetings(store, 1);
    await expect(store.list_meetings(OWNER, { limit: 0 })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(store.list_meetings(OWNER, { limit: 2.5 })).rejects.toMatchObject({ code: 'invalid_input' });
    const forged = Buffer.from('meeting_does_not_exist', 'utf8').toString('base64url');
    await expect(store.list_meetings(OWNER, { cursor: forged })).rejects.toMatchObject({ code: 'invalid_input' });
  });
});

async function startHttp(store: ReturnType<typeof createMeetingMinutesStore>): Promise<string> {
  const handler = createMeetingMinutesHttpHandler({ store, resolveContext: () => OWNER });
  const server = createServer((request, response) => {
    void handler(request, response).catch(() => {
      if (!response.headersSent) response.writeHead(500).end();
    });
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not expose a TCP address');
  return `http://127.0.0.1:${address.port}`;
}

async function getList(base: string, query = ''): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${base}/api/meeting-minutes${query}`);
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

describe('meeting list HTTP endpoint honours limit and cursor (UNS-264)', () => {
  it('keeps the readback shape, pages with the cursor, and never ships a body', async () => {
    const { store } = await openStore();
    const ids = await createMeetings(store, 3);
    const base = await startHttp(store);

    const first = await getList(base, '?limit=1');
    expect(first.status).toBe(200);
    // The organization BFF listReadback() checks exactly these fields.
    expect(first.body.state).toBe('ready');
    expect(first.body.absence_confirmed).toBe(true);
    expect(Array.isArray(first.body.meetings)).toBe(true);
    expect((first.body.meetings as unknown[]).length).toBe(1);
    expect(typeof first.body.next_cursor).toBe('string');
    expect(JSON.stringify(first.body)).not.toContain('本文の中身');

    const seen: string[] = [];
    let cursor: string | undefined = undefined;
    let guard = 0;
    do {
      const query = `?limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const page = await getList(base, query);
      expect(page.status).toBe(200);
      seen.push(...(page.body.meetings as Array<{ meeting: { meeting_id: string } }>).map((entry) => entry.meeting.meeting_id));
      cursor = page.body.next_cursor as string | undefined;
      guard += 1;
      expect(guard).toBeLessThanOrEqual(5);
    } while (cursor !== undefined);
    expect(seen).toEqual([...ids].reverse());
  });

  it('rejects an invalid limit or cursor with 422', async () => {
    const { store } = await openStore();
    await createMeetings(store, 1);
    const base = await startHttp(store);
    expect((await getList(base, '?limit=0')).status).toBe(422);
    expect((await getList(base, '?limit=abc')).status).toBe(422);
    expect((await getList(base, '?cursor=')).status).toBe(422);
    const forged = Buffer.from('meeting_missing', 'utf8').toString('base64url');
    expect((await getList(base, `?cursor=${forged}`)).status).toBe(422);
  });
});
