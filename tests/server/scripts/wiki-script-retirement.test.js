// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const repositoryRoot = path.resolve(import.meta.dirname, '../../..');

const removedEntrypoints = [
    'scripts/merge-codex-to-wiki.js',
    'scripts/reorganize-wiki.sh',
    'scripts/create-story-records-from-wiki.js'
];

const retainedInventoryEntrypoints = [
    'scripts/migrate-graphdb-to-wiki.js',
    'scripts/populate-wiki-pages.js'
];

function collectFiles(relativeRoot) {
    const root = path.join(repositoryRoot, relativeRoot);
    if (!existsSync(root)) return [];

    const files = [];
    const visit = (current) => {
        for (const entry of readdirSync(current, { withFileTypes: true })) {
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                visit(fullPath);
            } else if (entry.isFile()) {
                files.push(fullPath);
            }
        }
    };
    visit(root);
    return files;
}

describe('retired Wiki write entrypoints', () => {
    it('removes the obsolete manual writers', () => {
        for (const relativePath of removedEntrypoints) {
            expect(existsSync(path.join(repositoryRoot, relativePath))).toBe(false);
        }
    });

    it('does not retain runtime references to removed paths', () => {
        const runtimeFiles = [
            ...collectFiles('server'),
            ...collectFiles('cli'),
            path.join(repositoryRoot, 'package.json')
        ].filter((filePath) => !filePath.includes(`${path.sep}audit-artifacts${path.sep}`));

        for (const filePath of runtimeFiles) {
            const source = readFileSync(filePath, 'utf8');
            for (const relativePath of removedEntrypoints) {
                expect(source, `${filePath} still references ${relativePath}`).not.toContain(relativePath);
            }
        }
    });
});

describe('protected Wiki inventory entrypoints', () => {
    for (const relativePath of retainedInventoryEntrypoints) {
        it(`${relativePath} fails closed without --dry-run`, () => {
            const result = spawnSync(process.execPath, [path.join(repositoryRoot, relativePath)], {
                cwd: repositoryRoot,
                encoding: 'utf8',
                env: {
                    ...process.env,
                    INFO_SSOT_DATABASE_URL: 'postgresql://invalid.invalid:5432/unused',
                    DATABASE_URL: 'postgresql://invalid.invalid:5432/unused'
                }
            });

            expect(result.error).toBeUndefined();
            expect(result.status).toBe(1);
            expect(`${result.stdout}${result.stderr}`).toMatch(/retired|退役/i);
        });
    }
});
