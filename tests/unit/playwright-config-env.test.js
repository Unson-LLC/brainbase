import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import playwrightConfig from '../../playwright.config.js';

describe('Playwright config environment safety', () => {
    it('webServer configへ親process環境を複製しない', () => {
        const webServers = Array.isArray(playwrightConfig.webServer)
            ? playwrightConfig.webServer
            : [playwrightConfig.webServer];

        expect(webServers).not.toHaveLength(0);
        for (const webServer of webServers) {
            expect(webServer).not.toHaveProperty('env');
        }
    });

    it('test server起動時だけE2E secretをINTERNAL_API_SECRETへ写像する', () => {
        const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));

        expect(packageJson.scripts['test:server']).toContain(
            'INTERNAL_API_SECRET=${BRAINBASE_E2E_INTERNAL_API_SECRET:-brainbase-e2e-internal-api-secret}'
        );
    });
});
