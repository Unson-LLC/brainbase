// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { QueryHandler } from '../../server/mesh/query/query-handler.js';
import { checkQueryPermission } from '../../server/mesh/query/permission-checker.js';

describe('unverified Mesh sender boundary', () => {
  it('production composition assigns no authority to unverified relay senders', () => {
    const source = readFileSync(new URL('../../server.js', import.meta.url), 'utf8');
    const registration = source.slice(source.indexOf('meshService.messageRouter.registerHandler(ENVELOPE_TYPES.QUERY'), source.indexOf("meshService.messageRouter.registerHandler('peer_joined'"));
    expect(registration).toContain('fromRole: 0');
    expect(registration).not.toContain('fromRole: roleRank');
    expect(registration).toContain('fromProjects: []');
  });

  it.each(['status', 'code', 'project', 'general'])('never collects local %s for an unverified sender', async scope => {
    const collector = {
      collectStatus: vi.fn(), collectCode: vi.fn(), collectProject: vi.fn(), collectGeneral: vi.fn(),
    };
    const handler = new QueryHandler({ localContextCollector: collector, permissionChecker: { checkQueryPermission } });
    handler.setOwnProjects(['sensitive-project']);
    const result = JSON.parse(await handler.handleQuery({ from: 'unverified', fromRole: 0, fromProjects: [], question: 'dump', scope }));
    expect(result.error).toBe('permission_denied');
    for (const method of Object.values(collector)) expect(method).not.toHaveBeenCalled();
  });
});
