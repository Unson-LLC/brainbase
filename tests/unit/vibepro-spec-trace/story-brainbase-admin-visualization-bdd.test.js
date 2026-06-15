import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

describe('story-brainbase-admin-visualization-bdd VibePro trace', () => {
    it('INV-1 INV-2 INV-5: docs preserve source class and SSOT boundaries', () => {
        const story = read('docs/stories/story-brainbase-admin-visualization-bdd.md');
        const architecture = read('docs/architecture/brainbase-admin-visualization-architecture.md');
        const spec = read('docs/specs/story-brainbase-admin-visualization-bdd-spec.md');
        expect(story).toContain('source_class');
        expect(architecture).toContain('graph_ssot');
        expect(architecture).toContain('candidate_store');
        expect(architecture).toContain('personal_kg');
        expect(spec).toContain('INV-1');
        expect(spec).toContain('INV-2');
        expect(spec).toContain('INV-5');
    });

    it('INV-8 AP-3: docs require secret-safe settings and health visualization', () => {
        expect(read('docs/stories/story-brainbase-admin-visualization-bdd.md')).toContain('secret値');
        const spec = read('docs/specs/story-brainbase-admin-visualization-bdd-spec.md');
        expect(spec).toContain('INV-8');
        expect(spec).toContain('AP-3');
    });

    it('INV-10 S-8 Contract-6: docs require Japanese-first UI labels', () => {
        expect(read('docs/stories/story-brainbase-admin-visualization-bdd.md')).toContain('UIの主表示は日本語');
        const spec = read('docs/specs/story-brainbase-admin-visualization-bdd-spec.md');
        expect(spec).toContain('INV-10');
        expect(spec).toContain('Contract-6');
        expect(spec).toContain('S-8');
    });

    it('INV-7 Contract-7: live smoke keeps authenticated headers on denied-owner Personal KG checks', () => {
        const smoke = read('scripts/admin-personal-kg-smoke.mjs');
        expect(smoke).toContain('assert(tokenAuth,');
        expect(smoke).toContain('const deniedOwnerHeaders = { Authorization: `Bearer ${tokenAuth.token}` };');
        expect(smoke).toContain('denied_owner_auth');
        expect(smoke).toContain('/api/admin/personal-kg?owner=umeda&limit=5');
    });
});
