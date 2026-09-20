// @vitest-environment node
import * as nodeFs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { runGraphWikiInventory } from '../../../scripts/migrate-graphdb-to-wiki.js';
import { runWikiPagesInventory } from '../../../scripts/populate-wiki-pages.js';

const quietLogger = {
    log: vi.fn(),
    warn: vi.fn(),
};

const fixtureRoots = new Set();

afterEach(async () => {
    for (const root of fixtureRoots) {
        await nodeFs.rm(root, { recursive: true, force: true });
    }
    fixtureRoots.clear();
});

function createPool(queryResult = { rows: [] }) {
    return {
        query: vi.fn(async () => queryResult),
        connect: vi.fn(async () => {
            throw new Error('dry-run must not connect to the database');
        }),
        end: vi.fn(async () => {}),
    };
}

async function createWikiFixture(files) {
    const root = await nodeFs.mkdtemp(path.join(os.tmpdir(), 'brainbase-wiki-inventory-'));
    fixtureRoots.add(root);
    for (const [relativePath, content] of Object.entries(files)) {
        const filePath = path.join(root, relativePath);
        await nodeFs.mkdir(path.dirname(filePath), { recursive: true });
        await nodeFs.writeFile(filePath, content, 'utf8');
    }
    return root;
}

describe('Wiki inventory dry-run fixtures', () => {
    it('migrate-graphdb-to-wiki reads entities without writing files or database rows', async () => {
        const wikiRoot = await createWikiFixture({});
        const pool = createPool({
            rows: [{
                entity_id: 'person_001',
                entity_type: 'person',
                payload: { name: 'Fixture Person' },
            }],
        });
        const writeFile = vi.fn(async () => {
            throw new Error('dry-run must not write files');
        });
        const mkdir = vi.fn(async () => {
            throw new Error('dry-run must not create directories');
        });

        const result = await runGraphWikiInventory({
            dryRun: true,
            wikiRoot,
            pool,
            fsImpl: { ...nodeFs, mkdir, writeFile },
            logger: quietLogger,
        });

        expect(result.stats).toMatchObject({ created: 1, skipped: 0, dbInserted: 0 });
        expect(pool.query).toHaveBeenCalledTimes(1);
        expect(pool.query.mock.calls[0][0]).not.toMatch(/\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i);
        expect(pool.connect).not.toHaveBeenCalled();
        expect(mkdir).not.toHaveBeenCalled();
        expect(writeFile).not.toHaveBeenCalled();
        await expect(nodeFs.access(path.join(wikiRoot, 'people/person_001.md'))).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('migrate-graphdb-to-wiki surfaces entity query rejection with a fake pool only', async () => {
        const wikiRoot = await createWikiFixture({});
        const query = vi.fn(async () => {
            const error = new Error('entity inventory read failed');
            error.code = 'EIO';
            throw error;
        });
        const pool = {
            query,
            connect: vi.fn(),
            end: vi.fn(async () => {}),
        };

        await expect(runGraphWikiInventory({
            dryRun: true,
            wikiRoot,
            pool,
            logger: quietLogger,
        })).rejects.toThrow('entity inventory read failed');
        expect(query).toHaveBeenCalledTimes(1);
        expect(pool.connect).not.toHaveBeenCalled();
    });

    it('populate-wiki-pages reads Markdown without connecting or writing in dry-run', async () => {
        const wikiRoot = await createWikiFixture({ 'brainbase/fixture.md': '# Fixture Page\n' });
        const pool = createPool({ rows: [{ id: 'project_001', name: 'brainbase' }] });
        const writeFile = vi.fn(async () => {
            throw new Error('dry-run must not write files');
        });
        const mkdir = vi.fn(async () => {
            throw new Error('dry-run must not create directories');
        });

        const result = await runWikiPagesInventory({
            dryRun: true,
            wikiRoot,
            pool,
            fsImpl: { ...nodeFs, mkdir, writeFile },
            logger: quietLogger,
        });

        expect(result.pages).toHaveLength(1);
        expect(result.pages[0]).toMatchObject({
            wikiPath: 'brainbase/fixture',
            title: 'Fixture Page',
            projectId: 'project_001',
        });
        expect(pool.query).toHaveBeenCalledTimes(1);
        expect(pool.query.mock.calls[0][0]).not.toMatch(/\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i);
        expect(pool.connect).not.toHaveBeenCalled();
        expect(mkdir).not.toHaveBeenCalled();
        expect(writeFile).not.toHaveBeenCalled();
        await expect(nodeFs.readFile(path.join(wikiRoot, 'brainbase/fixture.md'), 'utf8')).resolves.toBe('# Fixture Page\n');
    });

    it('migrate-graphdb-to-wiki does not turn an inaccessible Wiki path into a missing file', async () => {
        const wikiRoot = await createWikiFixture({});
        const pool = createPool({
            rows: [{
                entity_id: 'person_002',
                entity_type: 'person',
                payload: { name: 'Unreadable Fixture' },
            }],
        });
        const access = vi.fn(async () => {
            const error = new Error('permission denied');
            error.code = 'EACCES';
            throw error;
        });

        await expect(runGraphWikiInventory({
            dryRun: true,
            wikiRoot,
            pool,
            fsImpl: { ...nodeFs, access },
            logger: quietLogger,
        })).rejects.toThrow(/Unable to inspect Wiki file .*EACCES|permission denied/);
    });

    it('populate-wiki-pages does not turn a Markdown read failure into a successful page', async () => {
        const wikiRoot = await createWikiFixture({ 'brainbase/unreadable.md': '# Unreadable Fixture\n' });
        const pool = createPool({ rows: [{ id: 'project_001', name: 'brainbase' }] });
        const readFile = vi.fn(async () => {
            const error = new Error('I/O failure');
            error.code = 'EIO';
            throw error;
        });

        await expect(runWikiPagesInventory({
            dryRun: true,
            wikiRoot,
            pool,
            fsImpl: { ...nodeFs, readFile },
            logger: quietLogger,
        })).rejects.toThrow(/Unable to read Wiki file .*I\/O failure/);
    });

    it('populate-wiki-pages surfaces a readdir failure instead of treating the tree as empty', async () => {
        const wikiRoot = await createWikiFixture({});
        const readdir = vi.fn(async () => {
            const error = new Error('directory read failed');
            error.code = 'EIO';
            throw error;
        });

        await expect(runWikiPagesInventory({
            dryRun: true,
            wikiRoot,
            pool: createPool(),
            fsImpl: { ...nodeFs, readdir },
            logger: quietLogger,
        })).rejects.toThrow(/Unable to read Wiki directory .*directory read failed/);
        expect(readdir).toHaveBeenCalledTimes(1);
    });

    it('populate-wiki-pages surfaces project query rejection with a fake pool only', async () => {
        const wikiRoot = await createWikiFixture({ 'brainbase/query-failure.md': '# Query Failure\n' });
        const query = vi.fn(async () => {
            const error = new Error('project metadata read failed');
            error.code = 'EIO';
            throw error;
        });
        const pool = {
            query,
            connect: vi.fn(),
            end: vi.fn(async () => {}),
        };

        await expect(runWikiPagesInventory({
            dryRun: true,
            wikiRoot,
            pool,
            logger: quietLogger,
        })).rejects.toThrow('project metadata read failed');
        expect(query).toHaveBeenCalledTimes(1);
        expect(pool.connect).not.toHaveBeenCalled();
    });
});
