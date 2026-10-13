import { describe, expect, it } from 'vitest';
import {
  GRAPH_ENTITY_LIST_SQL,
  GRAPH_ENTITY_PAGE_DEFAULT,
  decodeGraphEntityCursor,
  encodeGraphEntityCursor,
  listGraphEntities,
  pageGraphEntityRows
} from '../../../server/services/info-ssot-service.js';
import { createInfoSsotController } from '../../../server/controllers/info-ssot-controller.js';

const access = {
  role: 'gm',
  projectCodes: ['atlas'],
  clearance: ['internal']
};

function row(id, updatedAt) {
  return {
    id,
    updated_at: updatedAt,
    entity_type: 'objective',
    project_id: 'project-atlas',
    payload: {},
    role_min: 'member',
    sensitivity: 'internal',
    lifecycle_status: 'active'
  };
}

describe('graph entity keyset paging', () => {
  it('orders by updated_at and breaks ties with id', () => {
    const rows = [
      row('b', '2026-10-13T00:00:00.000Z'),
      row('a', '2026-10-13T00:00:00.000Z'),
      row('c', '2026-10-12T00:00:00.000Z')
    ];
    const page = pageGraphEntityRows(rows, 2);
    expect(page.records.map((record) => record.id)).toEqual(['b', 'a']);
    const cursor = decodeGraphEntityCursor(page.next_cursor);
    expect(cursor).toEqual({ updatedAt: '2026-10-13T00:00:00.000Z', id: 'a' });
    expect(GRAPH_ENTITY_LIST_SQL).toContain('ORDER BY ge.updated_at DESC, ge.id DESC');
    expect(GRAPH_ENTITY_LIST_SQL).not.toContain('app_foundation_row_visible');
  });

  it('uses a default page of 50 and returns the next cursor from the query', async () => {
    const stored = Array.from({ length: 51 }, (_, index) => row(
      `e${String(index).padStart(3, '0')}`,
      `2026-10-13T00:${String(index).padStart(2, '0')}:00.000Z`
    ));
    const calls = [];
    const client = {
      async query(text, values) {
        calls.push({ text, values });
        if (text.startsWith('SELECT ge.id')) return { rows: stored };
        return { rows: [] };
      }
    };

    const page = await listGraphEntities(client, access, {});
    expect(page.records).toHaveLength(GRAPH_ENTITY_PAGE_DEFAULT);
    expect(page.next_cursor).toBeTruthy();
    const listCall = calls.find((call) => call.text.startsWith('SELECT ge.id'));
    expect(listCall.values[2]).toBe(GRAPH_ENTITY_PAGE_DEFAULT + 1);
    expect(listCall.values[0]).toBeNull();

    const second = await listGraphEntities(client, access, { cursor: page.next_cursor, limit: 10 });
    const secondCall = calls.filter((call) => call.text.startsWith('SELECT ge.id')).at(-1);
    expect(secondCall.values[0]).toBe(page.records.at(-1).updated_at);
    expect(secondCall.values[1]).toBe(page.records.at(-1).id);
    expect(secondCall.values[2]).toBe(11);
    expect(second.records).toHaveLength(10);
  });

  it('rejects a cursor that is not a keyset token', () => {
    expect(() => decodeGraphEntityCursor('not-a-cursor')).toThrow(/cursor is invalid/);
  });
});

describe('listGraphEntities controller', () => {
  it('passes the cursor and returns the next cursor', async () => {
    const seen = [];
    const controller = createInfoSsotController({
      infoSSOTService: {
        async listGraphEntities(requestAccess, options) {
          seen.push({ requestAccess, options });
          return { records: [row('e1', '2026-10-13T00:00:00.000Z')], next_cursor: 'next-1' };
        }
      }
    });
    const response = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } };
    const cursor = encodeGraphEntityCursor(row('e0', '2026-10-13T00:00:00.000Z'));
    await controller.listGraphEntities({
      access,
      query: { cursor, limit: '25', project: 'atlas', type: 'objective' }
    }, response);

    expect(response.statusCode).toBe(200);
    expect(response.body.next_cursor).toBe('next-1');
    expect(response.body.records).toHaveLength(1);
    expect(seen[0].options).toMatchObject({ cursor, limit: '25', projectCode: 'atlas', entityType: 'objective' });
  });
});
