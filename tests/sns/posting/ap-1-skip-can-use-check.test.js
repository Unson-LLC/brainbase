// @ts-check
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('posting AP-1: posting-service.js requires canUseForPost call', () => {
    it('AP-1: source code references canUseForPost before postTweet', () => {
        const src = fs.readFileSync(path.resolve('server/services/sns/posting-service.js'), 'utf8');
        const idxCan = src.indexOf('canUseForPost');
        const idxPost = src.indexOf('provider.post');
        expect(idxCan).toBeGreaterThan(0);
        expect(idxPost).toBeGreaterThan(idxCan);
    });
});
