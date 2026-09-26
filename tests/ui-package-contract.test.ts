import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const manifestUrl = new URL('../package.json', import.meta.url);

describe('OSS共通UIの公開契約', () => {
  it('知識UIとMana委任UIを公開パッケージへ収録する', async () => {
    const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));

    expect(manifest.files).toContain('ui');
    expect(manifest.exports).toMatchObject({
      './foundation-http': {
        types: './dist/foundation-http.d.ts',
        import: './dist/foundation-http.js',
      },
      './graph-web-http': {
        types: './dist/graph-web-http.d.ts',
        import: './dist/graph-web-http.js',
      },
      './graph-web': {
        types: './dist/graph-web.d.ts',
        import: './dist/graph-web.js',
      },
      './graph-corrections': {
        types: './dist/graph-corrections.d.ts',
        import: './dist/graph-corrections.js',
      },
      './ui/outcome-knowledge': './ui/outcome-knowledge.js',
      './ui/outcome-knowledge.css': './ui/outcome-knowledge.css',
      './ui/outcome-mana': './ui/outcome-mana.js',
      './ui/outcome-mana.css': './ui/outcome-mana.css',
      './ui/judgment-view': './ui/judgment-view.js',
      './ui/judgment-view.css': './ui/judgment-view.css',
      './ui/objective-editor': './ui/objective-editor.js',
      './ui/objective-editor.css': './ui/objective-editor.css',
      './ui/value-proof-review': './ui/value-proof-review.js',
      './ui/value-proof-review.css': './ui/value-proof-review.css',
      './ui/objective-editor-http-port': './ui/objective-editor-http-port.js',
      './ui/world-model-view': './ui/world-model-view.js',
      './ui/world-model-view.css': './ui/world-model-view.css',
      './ui/local-web-shell': './ui/local-web-shell.js',
      './ui/local-web-shell.css': './ui/local-web-shell.css',
      './ui/graph-view-shared': './ui/graph-view-shared.js',
      './ui/graph-view-shared.css': './ui/graph-view-shared.css',
      './ui/graph-projects-view': './ui/graph-projects-view.js',
      './ui/graph-projects-view.css': './ui/graph-projects-view.css',
      './ui/graph-registry-view': './ui/graph-registry-view.js',
      './ui/graph-registry-view.css': './ui/graph-registry-view.css',
      './ui/brainbase-tokens.css': './ui/brainbase-tokens.css',
      './ui/icons/*': './ui/icons/*',
    });
  });

  it('共通UIへ顧客固有識別子を持ち込まない', async () => {
    const sources = await Promise.all([
      'outcome-knowledge.js',
      'outcome-knowledge.css',
      'outcome-mana.js',
      'outcome-mana.css',
      'judgment-view.js',
      'judgment-view.css',
      'objective-editor.js',
      'objective-editor.css',
      'value-proof-review.js',
      'value-proof-review.css',
      'objective-editor-http-port.js',
      'world-model-view.js',
      'world-model-view.css',
      'local-web-shell.js',
      'local-web-shell.css',
      'brainbase-tokens.css',
      'graph-view-shared.js',
      'graph-view-shared.css',
      'graph-projects-view.js',
      'graph-projects-view.css',
      'graph-registry-view.js',
      'graph-registry-view.css',
    ].map((file) => readFile(new URL(`../ui/${file}`, import.meta.url), 'utf8')));

    for (const source of sources) {
      expect(source).not.toMatch(/growin|unson\.jp|org_growin/i);
    }
  });

  it('新しい部品とホストの外枠は共通の見た目の定義だけで色・文字・余白を決める', async () => {
    const tokens = await readFile(new URL('../ui/brainbase-tokens.css', import.meta.url), 'utf8');
    for (const [name, value] of Object.entries({
      '--bb-color-ink': '#172033', '--bb-color-muted': '#667085', '--bb-color-border': '#d8dee9', '--bb-color-panel': '#ffffff',
      '--bb-color-surface': '#f5f7fb', '--bb-color-accent': '#3157d5', '--bb-color-accent-soft': '#eef2fd',
      '--bb-color-success': '#18794e', '--bb-color-success-soft': '#e7f5ee', '--bb-color-warning': '#9a6700',
      '--bb-color-warning-soft': '#fff8e6', '--bb-color-danger': '#b42318', '--bb-color-danger-soft': '#fef3f2',
      '--bb-radius-sm': '6px', '--bb-radius-md': '10px', '--bb-space-1': '4px', '--bb-space-2': '8px', '--bb-space-3': '12px',
      '--bb-space-4': '16px', '--bb-space-5': '24px', '--bb-space-6': '32px',
    })) {
      expect(tokens).toContain(`${name}: ${value};`);
    }
    for (const file of ['world-model-view.css', 'local-web-shell.css', 'graph-view-shared.css', 'graph-projects-view.css', 'graph-registry-view.css']) {
      const css = await readFile(new URL(`../ui/${file}`, import.meta.url), 'utf8');
      // Colors and font families come only from the shared tokens.
      expect(css, file).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
      expect(css, file).not.toMatch(/font-family:(?!\s*var\(--bb-font-)/);
    }
    const defined = new Set([...tokens.matchAll(/(--bb-[a-z0-9-]+):/g)].map((match) => match[1]));
    for (const file of ['graph-view-shared.css', 'graph-projects-view.css', 'graph-registry-view.css']) {
      const css = await readFile(new URL(`../ui/${file}`, import.meta.url), 'utf8');
      const used = [...css.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((match) => match[1]);
      // The Graph screens read only tokens that brainbase-tokens.css defines.
      expect(used.filter((name) => !defined.has(name)), file).toEqual([]);
    }
  });
});

