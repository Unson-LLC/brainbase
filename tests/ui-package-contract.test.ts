import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const manifestUrl = new URL('../package.json', import.meta.url);

describe('OSS共通UIの公開契約', () => {
  it('知識UIとMana委任UIを公開パッケージへ収録する', async () => {
    const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));

    expect(manifest.files).toContain('ui');
    expect(manifest.exports).toMatchObject({
      './ui/outcome-knowledge': './ui/outcome-knowledge.js',
      './ui/outcome-knowledge.css': './ui/outcome-knowledge.css',
      './ui/outcome-mana': './ui/outcome-mana.js',
      './ui/outcome-mana.css': './ui/outcome-mana.css',
      './ui/judgment-view': './ui/judgment-view.js',
      './ui/judgment-view.css': './ui/judgment-view.css',
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
    ].map((file) => readFile(new URL(`../ui/${file}`, import.meta.url), 'utf8')));

    for (const source of sources) {
      expect(source).not.toMatch(/growin|unson\.jp|org_growin/i);
    }
  });
});
