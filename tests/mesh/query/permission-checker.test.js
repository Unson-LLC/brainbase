import { describe, it, expect } from 'vitest';
import { checkQueryPermission } from '../../../server/mesh/query/permission-checker.js';

describe('permission-checker', () => {
  it('CEO (role 3) is always allowed', () => {
    const result = checkQueryPermission({
      fromRole: 3,
      fromProjects: [],
      toProjects: ['project-x'],
      scope: 'general',
    });
    expect(result.allowed).toBe(true);
  });

  it('GM (role 2) is always allowed', () => {
    const result = checkQueryPermission({
      fromRole: 2,
      fromProjects: [],
      toProjects: ['project-x'],
      scope: 'status',
    });
    expect(result.allowed).toBe(true);
  });

  it('Worker (role 1) allowed with shared project', () => {
    const result = checkQueryPermission({
      fromRole: 1,
      fromProjects: ['project-a', 'project-b'],
      toProjects: ['project-b', 'project-c'],
      scope: 'code',
    });
    expect(result.allowed).toBe(true);
  });

  it('Worker (role 1) denied without shared project', () => {
    const result = checkQueryPermission({
      fromRole: 1,
      fromProjects: ['project-a'],
      toProjects: ['project-b'],
      scope: 'code',
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/share at least one project/);
  });

  it('Role 0 is denied', () => {
    const result = checkQueryPermission({
      fromRole: 0,
      fromProjects: ['project-a'],
      toProjects: ['project-a'],
      scope: 'general',
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/Insufficient role/);
  });
});
