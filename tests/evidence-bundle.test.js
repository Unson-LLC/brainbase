import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { verifyBundle } from '../scripts/verify-evidence-bundle.mjs';

const roots = [];
afterEach(() => roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })));
function fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-transfer-'));
    roots.push(root);
    fs.mkdirSync(path.join(root, 'nested'));
    const raw = '{"synthetic":true}\n';
    fs.writeFileSync(path.join(root, 'nested/item.json'), raw);
    const manifest = { schema: 'evidence-transfer-v1', files: [{ path: 'nested/item.json', bytes: Buffer.byteLength(raw), sha256: createHash('sha256').update(raw).digest('hex') }] };
    return { root, manifest };
}
describe('evidence transfer integrity', () => {
    it('matches exact bytes deterministically without asserting equivalence', () => {
        const { root, manifest } = fixture();
        const result = verifyBundle(root, manifest);
        expect(result.integrityMatched).toBe(true);
        expect(verifyBundle(root, manifest)).toEqual(result);
        expect(result).not.toHaveProperty('complete');
        expect(result).not.toHaveProperty('confirmed');
    });
    it.each(['changed', 'missing', 'size', 'directory'])('rejects %s evidence', (mode) => {
        const { root, manifest } = fixture();
        if (mode === 'changed') fs.writeFileSync(path.join(root, 'nested/item.json'), '{"synthetic":null}\n');
        if (mode === 'missing') manifest.files[0].path = 'absent.json';
        if (mode === 'size') manifest.files[0].bytes += 1;
        if (mode === 'directory') manifest.files[0].path = 'nested';
        expect(verifyBundle(root, manifest).integrityMatched).toBe(false);
    });
    it.each(['../outside', '/etc/passwd', 'nested/../item', 'nested//item', 'C:/file', 'nested\\item'])('rejects unsafe path %s', (name) => {
        const { root, manifest } = fixture();
        manifest.files[0].path = name;
        expect(() => verifyBundle(root, manifest)).toThrow('Invalid');
    });
    it('rejects symlink files and directories', () => {
        const { root, manifest } = fixture();
        fs.symlinkSync('nested/item.json', path.join(root, 'link.json'));
        manifest.files[0].path = 'link.json';
        expect(verifyBundle(root, manifest).files[0].reason).toBe('symlink');
        fs.symlinkSync('nested', path.join(root, 'link-dir'));
        manifest.files[0].path = 'link-dir/item.json';
        expect(verifyBundle(root, manifest).files[0].reason).toBe('symlink');
    });
    it.each([{}, { schema: 'evidence-transfer-v1', files: [] }])('rejects invalid manifest', (manifest) => {
        expect(() => verifyBundle('.', manifest)).toThrow();
    });
    it('rejects duplicate entries and malformed hashes or sizes', () => {
        const { root, manifest } = fixture();
        manifest.files.push({ ...manifest.files[0] });
        expect(() => verifyBundle(root, manifest)).toThrow();
        manifest.files.pop();
        manifest.files[0].bytes = -1;
        expect(() => verifyBundle(root, manifest)).toThrow();
        manifest.files[0].bytes = 1;
        manifest.files[0].sha256 = 'unknown';
        expect(() => verifyBundle(root, manifest)).toThrow();
    });
    it('CLI exits nonzero on a mismatch and does not echo invalid JSON', () => {
        const { root, manifest } = fixture();
        const file = path.join(root, 'manifest.json');
        const run = () => spawnSync(process.execPath, ['scripts/verify-evidence-bundle.mjs', root, file], { encoding: 'utf8' });
        fs.writeFileSync(file, JSON.stringify(manifest));
        expect(run().status).toBe(0);
        manifest.files[0].bytes += 1;
        fs.writeFileSync(file, JSON.stringify(manifest));
        expect(run().status).toBe(1);
        fs.writeFileSync(file, 'PRIVATE-INVALID-INPUT');
        const result = run();
        expect(result.status).toBe(1);
        expect(result.stdout + result.stderr).not.toContain('PRIVATE-INVALID-INPUT');
    });
});
