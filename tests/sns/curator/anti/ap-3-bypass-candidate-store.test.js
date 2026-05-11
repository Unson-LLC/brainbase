// @ts-check
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const CURATOR_PATH = path.resolve('server/services/sns/sns-readonly-curator.js');

describe('sns-curator AP-3: must not write to _codex/sns/drafts/ filesystem', () => {
    it('AP-3: source has no fs.writeFile to _codex path', () => {
        const source = fs.readFileSync(CURATOR_PATH, 'utf8');
        // _codex への write を禁止（旧経路）
        expect(source).not.toMatch(/_codex\/sns\/drafts/);
        // fs.writeFile も使わない（candidate-store経由必須）
        expect(source).not.toMatch(/writeFileSync|fs\.writeFile/);
    });
});
