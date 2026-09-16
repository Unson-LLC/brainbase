import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('legacy auth grant population entrypoint', () => {
  it('delegates to the organization-scoped writer and has no global CEO project list', () => {
    const source = fs.readFileSync(
      path.resolve('scripts/populate-auth-grants.mjs'),
      'utf8'
    );

    expect(source).toContain("import('./info-ssot-sync-slack-auth.js')");
    expect(source).not.toContain('allProjects');
    expect(source).not.toContain('personMap');
  });
});
