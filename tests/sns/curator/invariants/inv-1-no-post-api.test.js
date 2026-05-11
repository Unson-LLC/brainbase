// @ts-check
import { describe, it, expect } from 'vitest';
import { SnsReadonlyCurator } from '../../../../server/services/sns/sns-readonly-curator.js';

describe('sns-curator INV-1: read-only curator has no post API', () => {
    it('INV-1: SnsReadonlyCurator class has no post/publish method', () => {
        const proto = SnsReadonlyCurator.prototype;
        const methods = Object.getOwnPropertyNames(proto);
        expect(methods).not.toContain('post');
        expect(methods).not.toContain('publish');
        expect(methods).not.toContain('send');
    });
});
