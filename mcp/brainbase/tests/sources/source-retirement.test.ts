import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const packageRoot = fileURLToPath(new URL('../../', import.meta.url));

describe('retired entity source files', () => {
  it('does not retain the filesystem/hybrid sources or their dedicated parsers', async () => {
    const retiredPaths = [
      'src/sources/filesystem-source.ts',
      'src/sources/hybrid-source.ts',
      'src/indexer/frontmatter.ts',
      'src/indexer/table.ts',
    ];

    for (const relativePath of retiredPaths) {
      await assert.rejects(access(path.join(packageRoot, relativePath)), { code: 'ENOENT' });
    }
  });
});
