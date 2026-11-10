#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

// Transfer integrity only: this cannot establish provenance or task equivalence.
export function verifyBundle(root, manifest) {
    if (manifest?.schema !== 'evidence-transfer-v1' || !Array.isArray(manifest.files) || manifest.files.length === 0) {
        throw new Error('Expected evidence-transfer-v1 with a non-empty files array');
    }
    const seen = new Set();
    // Validate the entire manifest before reading any evidence.
    for (const entry of manifest.files) {
        const name = entry?.path;
        if (typeof name !== 'string' || !name || name.includes('\\') || name.includes('\0') ||
            path.posix.isAbsolute(name) || name.split('/').some((part) => !part || part === '.' || part === '..') ||
            /^[A-Za-z]:/.test(name) || seen.has(name) ||
            !/^[a-f0-9]{64}$/.test(entry.sha256) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0) {
            throw new Error('Invalid or duplicate manifest entry');
        }
        seen.add(name);
    }
    const base = fs.realpathSync(root);
    if (!fs.statSync(base).isDirectory()) throw new Error('Evidence root must be a directory');
    const files = manifest.files.map((entry) => {
        try {
            let current = base;
            // Reject symlinks in every component, including links within the root.
            for (const component of entry.path.split('/')) {
                current = path.join(current, component);
                if (fs.lstatSync(current).isSymbolicLink()) {
                    return { path: entry.path, matched: false, reason: 'symlink' };
                }
            }
            if (!fs.statSync(current).isFile()) return { path: entry.path, matched: false, reason: 'not-file' };
            const raw = fs.readFileSync(current);
            const matched = raw.length === entry.bytes && createHash('sha256').update(raw).digest('hex') === entry.sha256;
            return { path: entry.path, matched, reason: matched ? 'matched' : 'digest-or-size-mismatch' };
        } catch {
            return { path: entry.path, matched: false, reason: 'unreadable-or-missing' };
        }
    });
    return { schema: 'evidence-transfer-result-v1', integrityMatched: files.every((file) => file.matched), files };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        const [root, manifestFile, ...extra] = process.argv.slice(2);
        if (!root || !manifestFile || extra.length) throw new Error('Usage: node scripts/verify-evidence-bundle.mjs <root> <manifest.json>');
        const result = verifyBundle(root, JSON.parse(fs.readFileSync(manifestFile, 'utf8')));
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        process.exitCode = result.integrityMatched ? 0 : 1;
    } catch (error) {
        // Do not print evidence contents or JSON parse errors containing input.
        process.stderr.write('Evidence transfer validation failed (check arguments, manifest, and root).\n');
        process.exitCode = 1;
    }
}
