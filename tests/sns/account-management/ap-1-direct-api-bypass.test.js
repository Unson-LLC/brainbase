// @ts-check
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('x-provider AP-1: callers must use provider, not raw X API', () => {
    it('AP-1: provider re-exports do not include raw http URLs to X API outside x-client.js', () => {
        const src = fs.readFileSync(path.resolve('server/services/sns/providers/x-provider.js'), 'utf8');
        // x-provider.js は x-client interface のみ呼ぶ、生 URL を含まない
        expect(src).not.toMatch(/api\.twitter\.com/);
        expect(src).not.toMatch(/api\.x\.com/);
    });
});
