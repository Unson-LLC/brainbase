import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

async function text(path: string): Promise<string> {
  return readFile(join(repoRoot, path), 'utf8');
}

describe('public manual quick start', () => {
  it('links first-time users directly to one resumable checklist', async () => {
    const home = await text('docs/manual/index.md');
    const config = await text('docs/.vitepress/config.mjs');

    expect(home).toContain('text: 10分で試す');
    expect(home).toContain('link: /guide/quick-start');
    expect(config).toContain("{ text: '最短で試す', link: '/guide/quick-start' }");
  });

  it('keeps start, MCP, Judgment Host, verification, and recovery in one ordered guide', async () => {
    const guide = await text('docs/manual/guide/quick-start.md');

    expect(guide).toContain('Brainbaseのオンボーディングを始めたいです。');
    expect(guide).toContain('npm run onboard:start -- --target codex');
    expect(guide).toContain('npm run onboard:install -- --target codex --dry-run');
    expect(guide).toContain('MCPの動作確認が終わるまで、Judgment Hostへ進まない');
    expect(guide).toContain('brainbase judgment:install --target codex --dry-run');
    expect(guide).toContain('UserPromptSubmit');
    expect(guide).toContain('PostToolUse');
    expect(guide).toContain('Stop');
    expect(guide).toContain('新しいtask');
    expect(guide).toContain('中断したらここから再開');
    expect(guide).toContain('生成された設定断片は、まだ登録完了ではありません');
  });

  it('puts backup and non-overwrite safety next to configuration steps', async () => {
    const guide = await text('docs/manual/guide/quick-start.md');

    expect(guide).toContain('既存設定をバックアップ');
    expect(guide).toContain('Brainbaseの項目だけを追加');
    expect(guide).toContain('既存設定を自動マージしません');
    expect(guide).toContain('元の設定へ戻す');
    expect(guide).toContain('未確認を成功扱いしない');
  });

  it('declares a favicon asset instead of requesting the missing default icon', async () => {
    const config = await text('docs/.vitepress/config.mjs');

    expect(config).toContain("rel: 'icon'");
    expect(config).toContain("href: '/assets/brainbase-mark.svg'");
    await expect(access(
      join(repoRoot, 'docs/manual/public/assets/brainbase-mark.svg'),
      constants.F_OK
    )).resolves.toBeUndefined();
  });
});
