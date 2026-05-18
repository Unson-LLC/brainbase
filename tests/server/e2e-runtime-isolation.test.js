// @ts-check
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

describe('Playwright E2E runtime isolation', () => {
    it('defaults the test server var directory to an E2E-only path', () => {
        const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
        const config = fs.readFileSync('playwright.config.js', 'utf8');
        expect(pkg.scripts['test:server']).toContain('BRAINBASE_TEST_MODE=true');
        expect(pkg.scripts['test:server']).toContain('BRAINBASE_VAR_DIR=${BRAINBASE_E2E_VAR_DIR:-var/e2e-runtime}');
        expect(pkg.scripts['test:server']).toContain('BRAINBASE_STATE_PATH=${BRAINBASE_E2E_VAR_DIR:-var/e2e-runtime}/state.json');
        expect(config).toContain("process.env.BRAINBASE_E2E_REUSE_SERVER === 'true'");
        expect(config).toContain('reuseExistingServer: REUSE_EXISTING_SERVER');
    });
});
