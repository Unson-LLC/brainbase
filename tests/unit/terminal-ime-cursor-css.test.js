import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const stylePath = path.resolve(process.cwd(), 'public/style.css');

describe('terminal IME cursor CSS', () => {
    it('composition input is not shifted away from xterm cursor row', () => {
        const css = fs.readFileSync(stylePath, 'utf8');
        const terminalCss = css.slice(
            css.indexOf('.terminal-xterm-host'),
            css.indexOf('/* Disable iframe pointer events during drag */')
        );

        expect(terminalCss).not.toContain('translateY(-100%)');
        expect(terminalCss).not.toContain('translateY(calc(-1 * var(--bb-terminal-row-height');
        expect(terminalCss).not.toContain('top: calc(-1 * var(--bb-terminal-row-height');
    });

    it('settled IME cursor is rendered without moving xterm input geometry', () => {
        const css = fs.readFileSync(stylePath, 'utf8');
        const terminalCss = css.slice(
            css.indexOf('.terminal-xterm-host'),
            css.indexOf('/* Disable iframe pointer events during drag */')
        );

        expect(terminalCss).toContain('.terminal-xterm-host.bb-ime-cursor-settling .composition-view');
        expect(terminalCss).toContain('.terminal-xterm-host.bb-ime-cursor-settling .composition-view::after');
        expect(terminalCss).toContain('animation: terminal-cursor-blink 1s steps(1, end) infinite;');
        expect(terminalCss).toContain('.terminal-xterm-host.bb-ime-cursor-settling .xterm-cursor,');
        expect(terminalCss).toContain('opacity: 0 !important;');
    });
});
