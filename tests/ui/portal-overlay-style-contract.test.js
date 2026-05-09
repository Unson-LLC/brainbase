import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const css = readFileSync(path.join(process.cwd(), 'public/style.css'), 'utf8');

function getRule(selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'm'));
    return match?.[1] || '';
}

describe('Portal overlay style contract', () => {
    it('Portal本文は全体スクロールをブロックしない', () => {
        const overlayRule = getRule('.command-center-theme .portal-overlay');
        const contentRule = getRule('.command-center-theme .portal-overlay-content');
        const sectionRule = getRule('.command-center-theme .portal-ov-section');
        const sectionContentRule = getRule('.command-center-theme .portal-ov-section-content');

        expect(overlayRule).toContain('overflow: auto');
        expect(contentRule).toContain('overflow: visible');
        expect(sectionRule).toContain('overflow: visible');
        expect(sectionContentRule).toContain('overflow: visible');
        expect(contentRule).not.toContain('overflow: hidden');
        expect(sectionRule).not.toContain('overflow: hidden');
        expect(sectionContentRule).not.toContain('overflow: auto');
    });
});
