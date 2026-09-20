import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('legacy shared header auth configuration', () => {
    it('does not emit the retired header-auth flag from setup', () => {
        const setupScript = readFileSync(resolve(process.cwd(), 'scripts/setup.sh'), 'utf8');

        expect(setupScript).not.toContain('ALLOW_INSECURE_SSOT_HEADERS');
    });
});
