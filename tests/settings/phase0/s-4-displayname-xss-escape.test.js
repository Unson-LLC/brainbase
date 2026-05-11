// @ts-check
import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { escapeHtml } from '../../../public/modules/ui-helpers.js';

// node 環境では document が無いので jsdom で補う
const dom = new JSDOM('');
global.document = dom.window.document;

describe('phase0 S-4: displayName XSS escape', () => {
    it('S-4: escapeHtml neutralizes HTML by encoding < > & characters', () => {
        const malicious = '<img src=x onerror=alert(1)>';
        const escaped = escapeHtml(malicious);
        expect(escaped).not.toMatch(/^<img/);
        expect(escaped).toMatch(/&lt;img/);
        expect(escaped).toMatch(/&gt;$/);
    });

    it('S-4: escapeHtml encodes ampersand', () => {
        expect(escapeHtml('a & b')).toContain('&amp;');
    });
});
