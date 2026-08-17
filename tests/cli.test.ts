import { access, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { isCliEntrypoint, runCli } from '../src/cli.js';
import { loadPersonalOs } from '../src/ssot.js';

const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'brainbase-cli-'));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function capture() {
  let stdout = '';
  let stderr = '';
  return {
    io: {
      stdout: { write: (chunk: string) => { stdout += chunk; } },
      stderr: { write: (chunk: string) => { stderr += chunk; } }
    },
    stdout: () => stdout,
    stderr: () => stderr
  };
}

describe('onboarding CLI', () => {
  it('CLI-UX-04 help leads with the complete five-step human first-value flow', async () => {
    const output = capture();
    const code = await runCli(['--help'], output.io);

    expect(code).toBe(0);
    expect(output.stdout()).toContain('初回価値まで（5ステップ）');
    expect(output.stdout()).toContain('1. brainbase onboard:start --target codex');
    expect(output.stdout()).toContain('2. 表示された brainbase onboard:seed を確認して実行');
    expect(output.stdout()).toContain('3. brainbase onboard:install --target codex --dry-run');
    expect(output.stdout()).toContain('5. 新しいエージェントで実際の依頼を送り、役立ったか本人が判断');
    expect(output.stdout().indexOf('初回価値まで（5ステップ）')).toBeLessThan(output.stdout().indexOf('使い方:'));
  });

  it('CLI-UX-00 recognizes an npm-style symlink as the public CLI entrypoint', async () => {
    const dir = await tempDir();
    const target = new URL('../src/cli.ts', import.meta.url);
    const link = join(dir, 'brainbase');
    await symlink(target, link);
    expect(isCliEntrypoint(target.href, link)).toBe(true);
  });

  it('S-1 onboard:init creates the minimum files', async () => {
    const dir = await tempDir();
    const output = capture();
    const code = await runCli(['onboard:init', '--dir', dir], output.io);

    expect(code).toBe(0);
    await expect(readFile(join(dir, 'graph.json'), 'utf8')).resolves.toContain('"version": 2');
    await expect(readFile(join(dir, 'personal-kg.jsonl'), 'utf8')).resolves.toBe('');
    await expect(access(join(dir, 'sources', 'gmail'))).resolves.toBeUndefined();
    await expect(access(join(dir, 'sources', 'calendar'))).resolves.toBeUndefined();
    await expect(access(join(dir, 'sources', 'drive'))).resolves.toBeUndefined();
    await expect(access(join(dir, 'sources', 'tasks'))).resolves.toBeUndefined();
    await expect(access(join(dir, 'candidates'))).resolves.toBeUndefined();
    expect((await loadPersonalOs(dir)).sourceCount).toBe(0);
    expect(output.stdout()).toContain('Initialized');
  });

  it('S-2 onboard:seed updates self, work, and relationships', async () => {
    const dir = await tempDir();
    const output = capture();
    const code = await runCli([
      'onboard:seed',
      '--dir', dir,
      '--name', 'Owner',
      '--value', 'Local facts first',
      '--project', 'MCP Onboarding',
      '--relationship', 'Otawara|partner|Needs local MCP from Codex'
    ], output.io);

    expect(code).toBe(0);
    const os = await loadPersonalOs(dir);
    expect(os.graph.owner?.name).toBe('Owner');
    expect(os.graph.entities.some((entity) => entity.name === 'MCP Onboarding')).toBe(true);
    expect(os.relationships.relationships[0]?.person).toBe('Otawara');
    expect(os.personalKg.some((entry) => entry.text === 'Local facts first')).toBe(true);
  });

  it('CLI-UX-07 repeating the same seed is idempotent', async () => {
    const dir = await tempDir();
    const args = [
      'onboard:seed',
      '--dir', dir,
      '--name', 'Owner',
      '--value', 'Local facts first',
      '--project', 'MCP Onboarding',
      '--relationship', 'Otawara|partner|Needs local MCP from Codex',
      '--decision-principle', 'Verify before claiming success.'
    ];

    expect(await runCli(args, capture().io)).toBe(0);
    const output = capture();
    expect(await runCli(args, output.io)).toBe(0);

    const os = await loadPersonalOs(dir);
    expect(os.personalKg.filter((entry) => entry.type === 'self')).toHaveLength(1);
    expect(os.personalKg.filter((entry) => entry.text === 'Local facts first')).toHaveLength(1);
    expect(os.personalKg.filter((entry) => entry.text === 'MCP Onboarding')).toHaveLength(1);
    expect(os.relationships.relationships.filter((entry) => entry.person === 'Otawara')).toHaveLength(1);
    expect(os.decisions.filter((entry) => entry.decision === 'Verify before claiming success.')).toHaveLength(1);
    expect(output.stdout()).toContain('同じ文脈は更新しました');
    expect(output.stdout()).toContain('既存の別データは削除していません');
  });

  it('S-3 onboard:install --target codex --dry-run prints valid Codex TOML config', async () => {
    const dir = await tempDir();
    const output = capture();
    const code = await runCli(['onboard:install', '--target', 'codex', '--dir', dir, '--dry-run'], output.io);

    expect(code).toBe(0);
    expect(output.stdout()).toContain('[mcp_servers.brainbase]');
    expect(output.stdout()).toContain(`[mcp_servers.brainbase.env]`);
    expect(output.stdout()).toContain(`command = ${JSON.stringify(process.execPath)}`);
    expect(output.stdout()).toMatch(/args = \[".*src\/index\.js"\]/);
    expect(output.stdout()).toContain(`BRAINBASE_PERSONAL_OS_DIR = ${JSON.stringify(dir)}`);
  });

  it.each(['claude', 'codecode'])('S-3 onboard:install --target %s --dry-run prints valid MCP JSON config', async (target) => {
    const dir = await tempDir();
    const output = capture();
    const code = await runCli(['onboard:install', '--target', target, '--dir', dir, '--dry-run'], output.io);

    expect(code).toBe(0);
    const config = JSON.parse(output.stdout());
    expect(config.mcpServers.brainbase.command).toBe(process.execPath);
    expect(config.mcpServers.brainbase.args[0]).toMatch(/src\/index\.js$/);
    expect(config.mcpServers.brainbase.env.BRAINBASE_PERSONAL_OS_DIR).toBe(dir);
  });

  it('S-3 onboard:install writes a new snippet file and refuses to overwrite existing client config', async () => {
    const dir = await tempDir();
    const outputPath = join(dir, 'brainbase-codex-snippet.toml');
    const output = capture();
    const code = await runCli(['onboard:install', '--target', 'codex', '--dir', dir, '--output', outputPath], output.io);

    expect(code).toBe(0);
    await expect(readFile(outputPath, 'utf8')).resolves.toContain('[mcp_servers.brainbase]');

    const second = capture();
    const secondCode = await runCli(['onboard:install', '--target', 'codex', '--dir', dir, '--output', outputPath], second.io);

    expect(secondCode).toBe(1);
    expect(second.stderr()).toContain('Refusing to overwrite existing MCP config snippet');
  });

  it('S-3 fails loudly for unsupported install targets', async () => {
    const dir = await tempDir();
    const output = capture();
    const code = await runCli(['onboard:install', '--target', 'unknown', '--dir', dir, '--dry-run'], output.io);

    expect(code).toBe(1);
    expect(output.stderr()).toContain('onboard:install requires --target codex|claude|codecode');
  });

  it('value-first-onboarding S-1 C-3 onboard:agent --format json prints the value-first protocol', async () => {
    const output = capture();
    const code = await runCli(['onboard:agent', '--format', 'json'], output.io);

    expect(code).toBe(0);
    const protocol = JSON.parse(output.stdout());
    expect(protocol.goal).toContain('first useful Brainbase answer');
    expect(protocol.interviewSections.map((section: { id: string }) => section.id)).toEqual([
      'value_target',
      'hypothesis',
      'approval',
      'minimum_seed',
      'first_value_demo',
      'optional_sources'
    ]);
    expect(protocol.safetyRules.join('\n')).toContain('Do not ask the user to paste OAuth tokens');
    expect(protocol.safetyRules.join('\n')).toContain('Do not treat raw source diagnosis');
    expect(protocol.nextCommands.join('\n')).toContain('brainbase onboard:projects');
    expect(protocol.nextCommands.join('\n')).toContain('brainbase onboard:demo');
    expect(protocol.nextCommands.join('\n'), 'onboarding-operationalization-next-actions C-5 onboard:agent JSON includes operationalization commands').toContain('brainbase onboard:skills --target codex');
    expect(protocol.nextCommands.join('\n')).toContain('brainbase onboard:routines --target codex');
    expect(protocol.completionCheck.join('\n')).toContain('unfinished operationalization');
    expect(protocol.completionCheck.join('\n')).toContain('MCP resolve_entity/get_context/search verification');
    expect(protocol.nextCommands.indexOf('brainbase onboard:demo --scenario "<real request that should now work>"')).toBeLessThan(
      protocol.nextCommands.indexOf('brainbase onboard:diagnose-sources --email gmail --calendar google-calendar --drive google-drive --drive-folder "<folder-id>" --tasks notion')
    );
  });

  it('onboarding-operationalization-next-actions C-5 onboard:agent markdown shows operationalization completion guidance', async () => {
    const output = capture();
    const code = await runCli(['onboard:agent'], output.io);

    expect(code).toBe(0);
    const markdown = output.stdout();
    expect(markdown).toContain('# Brainbase Agent Onboarding Protocol');
    expect(markdown).toContain('brainbase onboard:skills --target codex');
    expect(markdown).toContain('brainbase onboard:routines --target codex');
    expect(markdown).toContain('unfinished operationalization');
    expect(markdown).toContain('MCP resolve_entity/get_context/search verification');
  });

  it('value-first-onboarding S-2 C-5 onboard:demo reports missing canonical areas before seed', async () => {
    const dir = await tempDir();
    const output = capture();
    const code = await runCli(['onboard:demo', '--dir', dir, '--format', 'json'], output.io);

    expect(code).toBe(1);
    const demo = JSON.parse(output.stdout());
    expect(demo.ready).toBe(false);
    expect(demo.completionSignal).toBe('needs_seed');
    expect(demo.missing).toEqual(['self', 'work', 'relationships']);
    expect(demo.answer).toContain('まだ接続前プレビューを作れません');
    expect(demo.valueExplanation).toContain('最小メモが足りません');
  });

  it('value-first-onboarding S-3 S-4 C-5 C-6 and onboarding-first-value-experience S-2 C-1 onboard:demo shows first useful output after minimum seed', async () => {
    const dir = await tempDir();
    const seed = capture();
    const seedCode = await runCli([
      'onboard:seed',
      '--dir', dir,
      '--name', 'Owner',
      '--value', 'Do not make me re-explain the AI Dojo premise.',
      '--project', 'AI Dojo',
      '--relationship', 'Yamamoto Rikiya|CSO|Owns CSO perspective for AI Dojo decisions.',
      '--decision-principle', 'First prove value, then configure sources.'
    ], seed.io);
    expect(seedCode).toBe(0);

    const output = capture();
    const code = await runCli([
      'onboard:demo',
      '--dir', dir,
      '--scenario', 'Draft the first note to Yamamoto about AI Dojo.',
      '--format', 'json'
    ], output.io);

    expect(code).toBe(0);
    const demo = JSON.parse(output.stdout());
    expect(demo.ready).toBe(true);
    expect(demo.completionSignal).toBe('cli_sample_ready');
    expect(demo.onboardingComplete).toBe(false);
    expect(demo.humanValueStatus).toBe('not_observed');
    expect(demo.missing).toEqual([]);
    expect(demo.contextUsed.selectedRelationship).toMatchObject({
      person: 'Yamamoto Rikiya',
      role: 'CSO'
    });
    expect(demo.tryPrompt).toBe('Draft the first note to Yamamoto about AI Dojo.');
    expect(demo.sampleResult).toContain('Yamamoto Rikiya');
    expect(demo.sampleResult).toContain('AI Dojo');
    expect(demo.sampleResult).toContain('次に判断したいこと:');
    expect(demo.sampleResult).toContain('相談したいこと:');
    expect(demo.sampleResult).toContain('未確認事項:');
    expect(demo.sampleResult).toContain('次の行動:');
    expect(demo.sampleResult).not.toContain('分けて出します');
    expect(demo.valueExplanation).toContain('もう一度説明しなくても');
    expect(demo.operationalization.pending.map((item: { id: string }) => item.id), 'onboarding-operationalization-next-actions S-1 C-1 onboard:demo reports unfinished operationalization actions').toEqual([
      'public-skills',
      'routines',
      'mcp-config',
      'source-allowlist',
      'verification'
    ]);
    expect(demo.operationalization.pending.find((item: { id: string }) => item.id === 'mcp-config').command).toContain(`--dir ${dir}`);
    expect(demo.operationalization.pending.find((item: { id: string }) => item.id === 'verification').command).toContain(`--dir ${dir}`);
    expect(demo.operationalization.recommendedOrder.join('\n')).toContain('ohayo / oyasumi / retro');
    expect(demo.operationalization.safetyRules.join('\n')).toContain('実設定');
    expect(demo.answer).toContain('Yamamoto Rikiya');
    expect(demo.answer).toContain('AI Dojo');
    expect(demo.answer).not.toMatch(/Graph|Personal KG|SSOT|relationship record/iu);

    const doctorOutput = capture();
    const doctorCode = await runCli(['doctor', '--dir', dir], doctorOutput.io);
    expect(doctorCode).toBe(0);
    const status = JSON.parse(doctorOutput.stdout());
    expect(status).toMatchObject({
      localBackend: {
        connected: true,
        backend: 'local'
      },
      agentMcp: {
        status: 'not_verified'
      },
      operationallyReady: false,
      valueDemo: {
        scope: 'local_cli_sample',
        ready: true,
        missing: [],
        completionSignal: 'cli_sample_ready'
      }
    });
    expect(status).not.toHaveProperty('connected');
    expect(status.valueDemo.command).toContain(`--dir ${dir}`);
    expect(status.valueDemo).toMatchObject({
      ready: true,
      missing: [],
      completionSignal: 'cli_sample_ready'
    });
    expect(status.operationalization.pending.map((item: { id: string }) => item.id), 'onboarding-operationalization-next-actions S-4 C-4 doctor keeps operationalization separate from valueDemo.ready').toEqual([
      'public-skills',
      'routines',
      'mcp-config',
      'source-allowlist',
      'verification'
    ]);
  });

  it('onboarding-first-value-experience S-3 C-3 onboard:demo markdown shows try prompt, sample result, and value explanation', async () => {
    const dir = await tempDir();
    const seed = capture();
    const seedCode = await runCli([
      'onboard:seed',
      '--dir', dir,
      '--name', 'Owner',
      '--value', 'Do not make me re-explain the AI Dojo premise.',
      '--project', 'AI Dojo',
      '--relationship', 'Yamamoto Rikiya|CSO|Owns CSO perspective for AI Dojo decisions.',
      '--decision-principle', 'First prove value, then configure sources.'
    ], seed.io);
    expect(seedCode).toBe(0);

    const output = capture();
    const code = await runCli([
      'onboard:demo',
      '--dir', dir,
      '--scenario', 'Draft the first note to Yamamoto about AI Dojo.'
    ], output.io);

    expect(code).toBe(0);
    const markdown = output.stdout();
    expect(markdown).toContain('## 今すぐ試す');
    expect(markdown).toContain('Draft the first note to Yamamoto about AI Dojo.');
    expect(markdown).toContain('## サンプル結果');
    expect(markdown).toContain('これはCLIが保存済み文脈から組み立てたサンプルです');
    expect(markdown).toContain('実エージェント接続: 未確認');
    expect(markdown).toContain('同じ依頼をCodex / Claude Codeへ送って実際の応答を確認');
    expect(markdown).toContain('Yamamoto Rikiya');
    expect(markdown).toContain('AI Dojo');
    expect(markdown).toContain('## 反映された文脈');
    expect(markdown).toContain('もう一度説明しなくても');
    expect(markdown).toContain('## 次に実行');
    expect(markdown).toContain('brainbase onboard:install --target codex');
    expect(markdown).toContain('--dry-run');
    expect(markdown).toContain('このサンプルだけでは初回価値の達成になりません');
    expect(markdown).not.toContain('## まだ残っている運用化');
    expect(markdown.indexOf('## 今すぐ試す')).toBeLessThan(markdown.indexOf('## サンプル結果'));
    expect(markdown.indexOf('## サンプル結果')).toBeLessThan(markdown.indexOf('## 反映された文脈'));
    expect(markdown).not.toMatch(/Graph|Personal KG|SSOT|relationship record/iu);
  });

  it('S-9b onboard:start initializes Personal OS and prints a Japanese guided first-run plan', async () => {
    const dir = await tempDir();
    const output = capture();
    const code = await runCli([
      'onboard:start',
      '--dir', dir,
      '--target', 'codex',
      '--name', '大田原さん',
      '--value', 'AIには外部ソース由来の推測を候補扱いしてほしい',
      '--project', 'Brainbase個人オンボーディング',
      '--goal', 'CodexからBrainbase MCPを呼び出して仕事文脈を渡す',
      '--status', '初回セットアップ中',
      '--role', '個人利用者',
      '--stakeholder', '佐藤圭吾|導入支援|Brainbase MCPとオンボーディングを支援する',
      '--email', 'gmail',
      '--calendar', 'google-calendar',
      '--drive', 'google-drive',
      '--drive-folder', 'cursorvers-brainbase-folder',
      '--local-folder', '/Users/otawara/Notes',
      '--tasks', 'scattered-calendar-notes',
      '--assume-gog',
      '--format', 'json'
    ], output.io);

    expect(code).toBe(0);
    const guide = JSON.parse(output.stdout());
    expect(guide.language).toBe('ja');
    expect(guide.target).toBe('codex');
    expect(guide.dataDir).toBe(dir);
    expect(guide.initialized).toMatchObject({
      personalOs: true,
      canonicalFactWrites: false
    });
    expect(guide.firstValueExperience, 'onboarding-first-value-experience S-1 C-2 onboard:start returns firstValueExperience').toMatchObject({
      tryPrompt: '佐藤圭吾さんにBrainbase個人オンボーディングの相談を投げるための論点メモを作って'
    });
    expect(guide.firstValueExperience.expectedValue).toContain('説明し直さなくても');
    expect(guide.firstValueExperience.sampleResult).toContain('保存した仕事メモ');
    expect(JSON.stringify(guide.firstValueExperience)).not.toMatch(/Graph|Personal KG|SSOT|relationship record/iu);
    expect(guide.operationalization.pending.map((item: { id: string }) => item.id), 'onboarding-operationalization-next-actions S-3 C-3 onboard:start returns operationalization actions').toEqual([
      'public-skills',
      'routines',
      'mcp-config',
      'source-allowlist',
      'verification'
    ]);
    expect(guide.operationalization.recommendedOrder.join('\n')).toContain('確認付き');
    expect(JSON.stringify(guide.interview)).toContain('メール');
    expect(JSON.stringify(guide.interview)).toContain('Google Drive');
    expect(guide.interview.map((section: { id: string }) => section.id)).toEqual([
      'value_target',
      'self',
      'project',
      'approval',
      'first_value_demo',
      'sources'
    ]);

    const drive = guide.sourceReadiness.find((source: { area: string }) => source.area === 'drive');
    expect(drive).toMatchObject({
      title: 'ドライブ',
      status: 'ready',
      statusLabel: '準備済み'
    });
    expect(drive.setupCommands.join('\n')).toContain('gog drive ls cursorvers-brainbase-folder');
    expect(guide.answers.localFolders).toEqual(['/Users/otawara/Notes']);

    expect(guide.projectRegistration.available).toBe(true);
    expect(guide.projectRegistration.dryRunCommand).toContain('brainbase onboard:projects');
    expect(guide.projectRegistration.dryRunCommand).toContain('Brainbase個人オンボーディング');
    expect(guide.projectRegistration.dryRunCommand).toContain('local|local folder|/Users/otawara/Notes');
    expect(guide.projectRegistration.writeCommand).toContain('--write');
    expect(guide.nextCommands.map((item: { id: string }) => item.id)).toEqual([
      'self-seed',
      'install',
      'doctor',
      'actual-agent-value',
      'first-value-demo',
      'skills',
      'routines',
      'project-dry-run',
      'project-write',
      'source-diagnosis',
      'candidates'
    ]);
    expect(guide.nextCommands.find((item: { id: string }) => item.id === 'self-seed').command).toContain('--relationship');
    expect(guide.nextCommands.find((item: { id: string }) => item.id === 'first-value-demo').command).toContain('onboard:demo');
    expect(guide.nextCommands.find((item: { id: string }) => item.id === 'skills').command).toContain('onboard:skills --target codex');
    expect(guide.nextCommands.find((item: { id: string }) => item.id === 'routines').command).toContain('onboard:routines --target codex');
    expect(guide.nextCommands.find((item: { id: string }) => item.id === 'source-diagnosis').command).toContain('--assume-gog');
    expect(guide.nextCommands.find((item: { id: string }) => item.id === 'install').command).toContain('onboard:install --target codex');
    expect(guide.approvalGates.join('\n')).toContain('OAuth token');
    expect(guide.approvalGates.join('\n')).toContain('実エージェントの回答と本人の価値判断');
    expect(guide.completionCheck.join('\n')).not.toContain('first_value_demo_ready');
    expect(guide.completionCheck.join('\n'), 'onboarding-first-value-experience INV-1 requires an actual agent answer and the user\'s value judgment').toContain('本人が役立ったかを判断');

    const os = await loadPersonalOs(dir);
    expect(os.graph.entities).toHaveLength(0);
    expect(os.personalKg).toHaveLength(0);
  });

  it('S-9c and onboarding-first-value-experience S-1 onboard:start markdown shows first prompt before optional source setup', async () => {
    const dir = await tempDir();
    const output = capture();
    const code = await runCli([
      'onboard:start',
      '--dir', dir,
      '--target', 'claude',
      '--email', 'gmail',
      '--calendar', 'google-calendar',
      '--drive', 'google-drive',
      '--gog-command', '__missing_brainbase_gog__',
      '--details'
    ], output.io);

    expect(code).toBe(0);
    expect(output.stdout()).toContain('# Brainbase 初回オンボーディング開始');
    expect(output.stdout()).toContain('対象エージェント: Claude Code');
    expect(output.stdout()).toContain('## 接続後に実エージェントで試すこと');
    expect(output.stdout()).toContain('### 回答イメージ（接続前プレビュー）');
    expect(output.stdout(), 'onboarding-operationalization-next-actions S-3 markdown start shows operationalization before source setup').toContain('## まだ残っている運用化');
    expect(output.stdout()).toContain('brainbase onboard:skills --target');
    expect(output.stdout()).toContain('brainbase onboard:routines --target');
    expect(output.stdout()).toContain('メール');
    expect(output.stdout()).toContain('追加接続（初回価値確認後の任意ステップ）');
    expect(output.stdout().indexOf('## 接続後に実エージェントで試すこと')).toBeLessThan(output.stdout().indexOf('## 追加接続（初回価値確認後の任意ステップ）'));
    expect(output.stdout().indexOf('## まだ残っている運用化')).toBeLessThan(output.stdout().indexOf('## 追加接続（初回価値確認後の任意ステップ）'));
    expect(output.stdout()).toContain('onboard:demo');
    expect(output.stdout()).toContain('ローカル設定が必要');
    expect(output.stdout()).toContain('ローカルGoGコマンドをインストールまたは設定する: __missing_brainbase_gog__');
    expect(output.stdout()).toContain('プロジェクト名の聞き取り待ち');
    expect(output.stdout()).toContain('--gog-command __missing_brainbase_gog__');
    expect(output.stdout()).toContain('brainbase onboard:install --target claude');
  });

  it('CLI-UX-01 onboard:start shows one concise next command by default and preserves details on request', async () => {
    const dir = await tempDir();
    const concise = capture();
    const args = [
      'onboard:start', '--dir', dir, '--target', 'codex', '--name', '高橋葵',
      '--value', '結論を先に示す', '--project', 'Atlas導入',
      '--decision-principle', '推測を事実として扱わない',
      '--stakeholder', '田中|責任者|最終判断を担当'
    ];
    expect(await runCli(args, concise.io)).toBe(0);
    expect(concise.stdout()).toContain('## 次に実行');
    expect(concise.stdout()).toContain('--decision-principle');
    expect(concise.stdout()).toContain('推測を事実として扱わない');
    expect(concise.stdout()).toContain('詳細を見る');
    expect(concise.stdout()).not.toContain('## エージェントの聞き取り');
    expect(concise.stdout()).not.toContain('## まだ残っている運用化');

    const detailed = capture();
    expect(await runCli([...args, '--details'], detailed.io)).toBe(0);
    expect(detailed.stdout()).toContain('## エージェントの聞き取り');
    expect(detailed.stdout()).toContain('## まだ残っている運用化');
  });

  it('CLI-UX-02 onboard:demo --help prints help without creating user data or running the demo', async () => {
    const dir = join(await tempDir(), 'not-created');
    const output = capture();
    const code = await runCli(['onboard:demo', '--dir', dir, '--help'], output.io);

    expect(code).toBe(0);
    expect(output.stdout()).toContain('brainbase onboard:demo');
    expect(output.stdout()).toContain('--scenario');
    expect(output.stdout()).not.toContain('初回価値デモ');
    expect(output.stdout()).toContain('onboard:start');
    expect(output.stdout()).toContain('[--value value]');
    await expect(access(dir)).rejects.toThrow();
  });

  it('CLI-UX-03 seed confirmation lists saved context and the next copyable MCP install preview', async () => {
    const dir = await tempDir();
    const output = capture();
    const code = await runCli([
      'onboard:seed', '--dir', dir, '--name', '高橋葵', '--value', '結論を先に示す',
      '--project', 'Atlas導入', '--decision-principle', '推測を事実として扱わない',
      '--relationship', '田中|責任者|最終判断を担当'
    ], output.io);

    expect(code).toBe(0);
    expect(output.stdout()).toContain('保存しました');
    expect(output.stdout()).toContain('本人: 高橋葵');
    expect(output.stdout()).toContain('プロジェクト: Atlas導入');
    expect(output.stdout()).toContain('関係者: 田中（責任者）');
    expect(output.stdout()).toContain('判断基準: 推測を事実として扱わない');
    expect(output.stdout()).toContain(`brainbase onboard:install --target codex --dir ${dir} --dry-run`);
    expect(output.stdout()).toContain('実際の依頼でBrainbaseのresolve_entity、get_context、searchを使います');
  });

  it('CLI-UX-05 start translates missing canonical areas in the primary Japanese output', async () => {
    const dir = await tempDir();
    const output = capture();

    const code = await runCli(['onboard:start', '--dir', dir, '--target', 'codex'], output.io);

    expect(code).toBe(0);
    expect(output.stdout()).toContain('不足: 本人の前提、今の仕事、関係者');
    expect(output.stdout()).not.toContain('不足: self, work, relationships');
  });

  it('S-10 onboard:recommend maps Google tools to metadata-first GoG source staging', async () => {
    const output = capture();
    const code = await runCli([
      'onboard:recommend',
      '--email', 'gmail',
      '--calendar', 'google-calendar',
      '--drive', 'google-drive',
      '--tasks', 'notion',
      '--format', 'json'
    ], output.io);

    expect(code).toBe(0);
    const recommendations = JSON.parse(output.stdout()).recommendations;
    expect(recommendations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        area: 'email',
        recommendation: expect.stringContaining('GoG Gmail'),
        sourcePath: 'sources/gmail/threads.jsonl',
        importMode: 'metadata-first'
      }),
      expect.objectContaining({
        area: 'calendar',
        recommendation: expect.stringContaining('GoG Google Calendar'),
        sourcePath: 'sources/calendar/events.jsonl',
        importMode: 'metadata-first'
      }),
      expect.objectContaining({
        area: 'drive',
        recommendation: expect.stringContaining('GoG Drive'),
        sourcePath: 'sources/drive/files.jsonl',
        importMode: 'metadata-first'
      }),
      expect.objectContaining({
        area: 'tasks',
        recommendation: expect.stringContaining('Notion'),
        sourcePath: 'sources/tasks/tasks.jsonl',
        importMode: 'export-first'
      })
    ]));
  });

  it('S-10 onboard:recommend handles no task tool deterministically', async () => {
    const output = capture();
    const code = await runCli(['onboard:recommend', '--tasks', 'none', '--format', 'json'], output.io);

    expect(code).toBe(0);
    const tasks = JSON.parse(output.stdout()).recommendations.find((recommendation: { area: string }) => recommendation.area === 'tasks');
    expect(tasks).toMatchObject({
      area: 'tasks',
      input: 'none',
      importMode: 'not-configured'
    });
  });

  it('S-11 onboard:diagnose-sources reports Google GoG readiness and Drive allowlists', async () => {
    const dir = await tempDir();
    const output = capture();
    const code = await runCli([
      'onboard:diagnose-sources',
      '--dir', dir,
      '--email', 'gmail',
      '--calendar', 'google-calendar',
      '--drive', 'google-drive',
      '--drive-folder', 'folder-123',
      '--tasks', 'notion',
      '--assume-gog',
      '--format', 'json'
    ], output.io);

    expect(code).toBe(0);
    const diagnostics = JSON.parse(output.stdout()).diagnostics;
    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        area: 'email',
        status: 'ready',
        collector: 'gog',
        importMode: 'metadata-first',
        sourcePath: 'sources/gmail/threads.jsonl'
      }),
      expect.objectContaining({
        area: 'calendar',
        status: 'ready',
        collector: 'gog',
        importMode: 'metadata-first',
        sourcePath: 'sources/calendar/events.jsonl'
      }),
      expect.objectContaining({
        area: 'drive',
        status: 'ready',
        collector: 'gog',
        importMode: 'metadata-first',
        sourcePath: 'sources/drive/files.jsonl'
      })
    ]));
    const drive = diagnostics.find((diagnostic: { area: string }) => diagnostic.area === 'drive');
    expect(drive.setupCommands.join('\n')).toContain('gog drive ls folder-123');
    expect(drive.safetyNotes.join('\n')).toContain('Do not scan the whole Drive by default');
  });

  it('S-12 onboard:diagnose-sources fails visibly when GoG is not available', async () => {
    const dir = await tempDir();
    const output = capture();
    const code = await runCli([
      'onboard:diagnose-sources',
      '--dir', dir,
      '--email', 'gmail',
      '--calendar', 'google-calendar',
      '--drive', 'google-drive',
      '--drive-folder', 'folder-123',
      '--gog-command', '__missing_brainbase_gog__',
      '--format', 'json'
    ], output.io);

    expect(code).toBe(0);
    const diagnostics = JSON.parse(output.stdout()).diagnostics;
    expect(diagnostics.filter((diagnostic: { collector: string; status: string }) => diagnostic.collector === 'gog').map((diagnostic: { status: string }) => diagnostic.status)).toEqual([
      'needs_setup',
      'needs_setup',
      'needs_setup'
    ]);
    expect(JSON.stringify(diagnostics)).toContain('Install or configure local GoG command');

    const markdown = capture();
    const markdownCode = await runCli([
      'onboard:diagnose-sources',
      '--dir', dir,
      '--email', 'gmail',
      '--drive', 'google-drive',
      '--gog-command', '__missing_brainbase_gog__'
    ], markdown.io);

    expect(markdownCode).toBe(0);
    expect(markdown.stdout()).toContain('# Brainbase Source Diagnosis');
    expect(markdown.stdout()).toContain('- Status: needs_setup');
    expect(markdown.stdout()).toContain('Install or configure local GoG command: __missing_brainbase_gog__');
    expect(markdown.stdout()).toContain('- Required user input:');
    expect(markdown.stdout()).toContain('- Setup commands:');
  });

  it('S-13 onboard:diagnose-sources requires a Drive folder allowlist even when GoG is ready', async () => {
    const dir = await tempDir();
    const output = capture();
    const code = await runCli([
      'onboard:diagnose-sources',
      '--dir', dir,
      '--drive', 'google-drive',
      '--assume-gog',
      '--format', 'json'
    ], output.io);

    expect(code).toBe(0);
    const drive = JSON.parse(output.stdout()).diagnostics.find((diagnostic: { area: string }) => diagnostic.area === 'drive');
    expect(drive.status).toBe('needs_input');
    expect(drive.requiredUserInput.join('\n')).toContain('At least one allowed Google Drive folder id');

    const markdown = capture();
    const markdownCode = await runCli([
      'onboard:diagnose-sources',
      '--dir', dir,
      '--drive', 'google-drive',
      '--assume-gog'
    ], markdown.io);

    expect(markdownCode).toBe(0);
    expect(markdown.stdout()).toContain('- Status: needs_input');
    expect(markdown.stdout()).toContain('At least one allowed Google Drive folder id');
    expect(markdown.stdout()).toContain('gog drive ls <allowed-folder-id>');
  });

  it.each(['notion', 'todoist', 'linear', 'github-issues', 'nocodb', 'csv', 'none'])('S-14 onboard:diagnose-sources maps task source %s deterministically', async (taskInput) => {
    const dir = await tempDir();
    const output = capture();
    const code = await runCli([
      'onboard:diagnose-sources',
      '--dir', dir,
      '--tasks', taskInput,
      '--format', 'json'
    ], output.io);

    expect(code).toBe(0);
    const tasks = JSON.parse(output.stdout()).diagnostics.find((diagnostic: { area: string }) => diagnostic.area === 'tasks');
    expect(tasks).toMatchObject({
      area: 'tasks',
      input: taskInput,
      sourcePath: 'sources/tasks/tasks.jsonl'
    });
    expect(JSON.stringify(tasks)).toContain('Do not paste secrets');
  });

  it('S-15 onboard:candidates writes review candidates without canonical SSOT writes', async () => {
    const dir = await tempDir();
    const output = capture();
    const code = await runCli([
      'onboard:candidates',
      '--dir', dir,
      '--name', 'Owner',
      '--value', 'Local facts first',
      '--project', 'MCP Onboarding',
      '--relationship', 'Otawara|partner|Needs local MCP from Codex',
      '--decision-principle', 'Promote only reviewed candidates',
      '--write',
      '--format', 'json'
    ], output.io);

    expect(code).toBe(0);
    const candidateSet = JSON.parse(output.stdout());
    expect(candidateSet.canonicalWrites).toBe(false);
    expect(candidateSet.candidates.map((candidate: { kind: string }) => candidate.kind)).toEqual([
      'self',
      'value',
      'project',
      'decision',
      'relationship'
    ]);
    await expect(readFile(candidateSet.candidatePath, 'utf8')).resolves.toContain('Otawara');

    const os = await loadPersonalOs(dir);
    expect(os.graph.entities).toHaveLength(0);
    expect(os.personalKg).toHaveLength(0);
    expect(os.relationships.relationships).toHaveLength(0);

    const doctorOutput = capture();
    const doctorCode = await runCli(['doctor', '--dir', dir], doctorOutput.io);
    expect(doctorCode).toBe(0);
    expect(JSON.parse(doctorOutput.stdout()).missing).toEqual(['self', 'work', 'relationships']);
  });

  it.each([
    ['forward', ['Aa', 'BB']],
    ['reverse', ['BB', 'Aa']]
  ])('onboard:apply blocks legacy stable-id collisions atomically (%s)', async (_label, names) => {
    const dir = await tempDir();
    await runCli(['onboard:init', '--dir', dir], capture().io);
    const candidatePath = join(dir, 'candidates.json');
    await writeFile(candidatePath, JSON.stringify({
      candidates: names.map((name) => ({ id: `candidate-${name}`, kind: 'project', payload: { name } }))
    }));
    const canonicalPaths = ['graph.json', 'personal-kg.jsonl', 'relationships.json', 'decisions.jsonl'];
    const before = await Promise.all(canonicalPaths.map((path) => readFile(join(dir, path), 'utf8')));
    const output = capture();

    const code = await runCli(['onboard:apply', '--dir', dir, '--from', candidatePath, '--all', '--write'], output.io);

    expect(code).toBe(1);
    expect(output.stderr()).toMatch(/canonical_id_collision: project-1mo.*Aa.*BB/);
    expect(await Promise.all(canonicalPaths.map((path) => readFile(join(dir, path), 'utf8')))).toEqual(before);
  });

  it('onboard:apply blocks a collision with an existing Graph entity without changing canonical files', async () => {
    const dir = await tempDir();
    await runCli(['onboard:init', '--dir', dir], capture().io);
    const candidatePath = join(dir, 'candidates.json');
    await writeFile(candidatePath, JSON.stringify({ candidates: [{ id: 'candidate-Aa', kind: 'project', payload: { name: 'Aa' } }] }));
    expect(await runCli(['onboard:apply', '--dir', dir, '--from', candidatePath, '--all', '--write'], capture().io)).toBe(0);
    await writeFile(candidatePath, JSON.stringify({ candidates: [{ id: 'candidate-BB', kind: 'project', payload: { name: 'BB' } }] }));
    const canonicalPaths = ['graph.json', 'personal-kg.jsonl', 'relationships.json', 'decisions.jsonl'];
    const before = await Promise.all(canonicalPaths.map((path) => readFile(join(dir, path), 'utf8')));
    const output = capture();

    const code = await runCli(['onboard:apply', '--dir', dir, '--from', candidatePath, '--all', '--write'], output.io);

    expect(code).toBe(1);
    expect(output.stderr()).toMatch(/canonical_id_collision: project-1mo.*Aa.*BB/);
    expect(await Promise.all(canonicalPaths.map((path) => readFile(join(dir, path), 'utf8')))).toEqual(before);
  });

  it('S-16 onboard:plan maps Google Workspace local answers into a no-write setup plan', async () => {
    const output = capture();
    const code = await runCli([
      'onboard:plan',
      '--profile', 'google-workspace-local',
      '--host', 'mac-mini',
      '--email', 'google-workspace',
      '--secondary-email', 'gmail',
      '--calendar', 'google-calendar',
      '--drive', 'google-drive',
      '--drive-folder', 'folder-123',
      '--local-folder', '/Users/owner/Notes',
      '--tasks', 'scattered-calendar-notes',
      '--inactive-task-tool', 'notion',
      '--format', 'json'
    ], output.io);

    expect(code).toBe(0);
    const plan = JSON.parse(output.stdout());
    expect(plan.profile).toBe('google-workspace-local');
    expect(plan.canonicalWrites).toBe(false);
    expect(plan.host).toMatchObject({
      input: 'mac-mini',
      role: expect.stringContaining('local Brainbase MCP runtime host')
    });
    expect(plan.host.boundary).toContain('not a hosted backend');
    expect(plan.safetyRules.join('\n')).toContain('bb.unson.jp sync are out of scope');

    const email = plan.sources.find((source: { area: string }) => source.area === 'email');
    expect(email).toMatchObject({
      collector: 'gog gmail',
      importMode: 'metadata-first',
      sourcePath: 'sources/gmail/threads.jsonl'
    });
    expect(email.accounts).toEqual(['<google-workspace-account>', '<gmail-account>']);

    const drive = plan.sources.find((source: { area: string }) => source.area === 'drive');
    expect(drive.allowlists).toEqual(['folder-123']);
    expect(drive.notes.join('\n')).toContain('Do not scan the whole Drive');

    const localFiles = plan.sources.find((source: { area: string }) => source.area === 'local_files');
    expect(localFiles.allowlists).toEqual(['/Users/owner/Notes']);
    expect(localFiles.notes.join('\n')).toContain('Do not scan the full home directory');

    const tasks = plan.sources.find((source: { area: string }) => source.area === 'tasks');
    expect(tasks.collector).toBe('calendar-and-notes-candidates');
    expect(tasks.notes.join('\n')).toContain('Inactive task tools: notion');
    expect(tasks.notes.join('\n')).toContain('candidate inputs');

    expect(plan.nextCommands.join('\n')).toContain('brainbase onboard:diagnose-sources');
    expect(plan.nextCommands.join('\n')).toContain('brainbase onboard:candidates');
    expect(plan.nextCommands.join('\n')).toContain('brainbase onboard:install');
    expect(plan.nextCommands.join('\n')).toContain('brainbase doctor');
  });

  it('S-17 onboard:plan markdown surfaces missing Drive and local allowlists', async () => {
    const output = capture();
    const code = await runCli([
      'onboard:plan',
      '--profile', 'google-workspace-local',
      '--host', 'mac-mini',
      '--email', 'google-workspace',
      '--calendar', 'google-calendar',
      '--drive', 'google-drive',
      '--tasks', 'scattered-calendar-notes',
      '--inactive-task-tool', 'notion'
    ], output.io);

    expect(code).toBe(0);
    expect(output.stdout()).toContain('# Brainbase Local Onboarding Plan');
    expect(output.stdout()).toContain('- Input: mac-mini');
    expect(output.stdout()).toContain('not a hosted backend');
    expect(output.stdout()).toContain('At least one allowed Google Drive folder id');
    expect(output.stdout()).toContain('At least one allowed local folder for notes or work files');
    expect(output.stdout()).toContain('Allowed local notes folder if notes should be included');
    expect(output.stdout()).toContain('Inactive task tools: notion');
    expect(output.stdout()).toContain('gog drive ls --parent <allowed-google-drive-folder-id>');
  });

  it('S-2 fails loudly for malformed relationship seeds', async () => {
    const dir = await tempDir();
    const output = capture();
    const code = await runCli([
      'onboard:seed', '--dir', dir,
      '--name', '高橋葵', '--value', '結論を先に示す', '--project', 'Atlas導入',
      '--decision-principle', '推測を事実として扱わない',
      '--relationship', 'Otawara||'
    ], output.io);

    expect(code).toBe(1);
    expect(output.stderr()).toContain('関係者の形式が正しくありません');
    expect(output.stderr()).toContain('田中|責任者|Atlas導入の最終判断を担当');
    expect(output.stderr()).toContain('保存内容は変更していません');
    expect(output.stderr()).toContain(`brainbase onboard:seed --dir ${dir}`);
    expect(output.stderr()).toContain('--name');
    expect(output.stderr()).toContain('高橋葵');
    expect(output.stderr()).toContain('--value');
    expect(output.stderr()).toContain('結論を先に示す');
    expect(output.stderr()).toContain('--project');
    expect(output.stderr()).toContain('Atlas導入');
    expect(output.stderr()).toContain('--decision-principle');
    expect(output.stderr()).toContain('推測を事実として扱わない');
  });
});
