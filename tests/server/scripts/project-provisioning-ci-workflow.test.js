import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Project Provisioning PR workflow', () => {
    it('PRでtypecheck・実PostgreSQL統合・control-plane・Playwrightを検証する', () => {
        const workflow = fs.readFileSync('.github/workflows/project-provisioning-contract.yml', 'utf8');

        expect(workflow).toMatch(/pull_request:/u);
        expect(workflow).toMatch(/npm run typecheck/u);
        expect(workflow).toMatch(/npm run test:integration:project-provisioning/u);
        expect(workflow).toMatch(/npx playwright test --config tests\/e2e\/project-provisioning\.playwright\.config\.js/u);
        expect(workflow).toMatch(/permissions:\s*\n\s+contents: read/u);
    });
});
