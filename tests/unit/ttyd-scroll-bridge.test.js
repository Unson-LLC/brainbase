import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

describe('ttyd scroll bridge', () => {
    it('INV-5/AP-2 ttyd wheel handler delegates scroll only in alternate buffer', () => {
        const html = readFileSync(
            path.join(repoRoot, 'public/ttyd/custom_ttyd_index.html'),
            'utf8'
        );

        expect(html).toContain('handledByIframe: handledByIframe');
        expect(html).toContain('sessionId: getSessionIdFromPath()');
        expect(html).toContain('function isAlternateBuffer(term)');
        expect(html).toContain('if (!isAlternateBuffer(term)) return;');
        expect(html).not.toContain("fetch('/api/sessions/' + encodeURIComponent(sessionId) + '/scroll'");
    });

    it('parent scroll handler accepts current ttyd iframe messages from loopback ports', () => {
        const source = readFileSync(
            path.join(repoRoot, 'public/modules/file-upload.js'),
            'utf8'
        );

        expect(source).toContain('function isTrustedTerminalMessage(event)');
        expect(source).toContain("document.getElementById('terminal-frame')");
        expect(source).toContain("document.getElementById('mobile-live-terminal-frame')");
        expect(source).toContain('event.source === frame.contentWindow');
        expect(source).toContain('function getTrustedMessageSessionId(sessionId)');
        expect(source).toContain('getTrustedMessageSessionId(event.data.sessionId) || getSessionId?.()');
        expect(source).toContain("if (event.data && event.data.type === 'TMUX_SCROLL')");
        expect(source).toContain('if (event.data.handledByIframe === true) return;');
    });
});
