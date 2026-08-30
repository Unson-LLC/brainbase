#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCliEntrypoint, runCli } from './cli.js';
import { processAutonomousJudgmentHook } from './judgment-autonomy.js';
import { blockedJudgmentOutput, type JudgmentHookPayload } from './judgment-host.js';

interface CliIo {
  stdin?: AsyncIterable<string | Uint8Array>;
  stdout?: { write(chunk: string): unknown };
  stderr?: { write(chunk: string): unknown };
}

async function readStdin(input: AsyncIterable<string | Uint8Array>): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of input) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

function write(io: CliIo, value: string): void {
  (io.stdout ?? process.stdout).write(value);
}

function writeError(io: CliIo, value: string): void {
  (io.stderr ?? process.stderr).write(value);
}

function optionValue(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  if (index < 0) return undefined;
  return argv[index + 1];
}

export function buildAutonomousHookConfig(cliPath = fileURLToPath(new URL('./autonomy-cli.js', import.meta.url))): Record<string, unknown> {
  const hook = {
    hooks: [{
      type: 'command',
      command: `${JSON.stringify(process.execPath)} ${JSON.stringify(cliPath)} judgment:hook`,
      statusMessage: 'brainbase autonomous judgment resolver'
    }]
  };
  return {
    hooks: {
      UserPromptSubmit: [hook],
      PostToolUse: [hook],
      Stop: [hook]
    }
  };
}

async function judgmentHook(io: CliIo): Promise<number> {
  let payload: JudgmentHookPayload = {};
  try {
    const input = await readStdin(io.stdin ?? process.stdin);
    payload = JSON.parse(input || '{}') as JudgmentHookPayload;
    write(io, `${JSON.stringify(await processAutonomousJudgmentHook(payload))}\n`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const eventName = payload.hook_event_name ?? payload.hookEventName;
    if (eventName === 'Stop' && payload.stop_hook_active === true) {
      writeError(io, `${reason}\n`);
      return 1;
    }
    write(io, `${JSON.stringify(blockedJudgmentOutput(reason))}\n`);
  }
  return 0;
}

async function judgmentInstall(argv: string[], io: CliIo): Promise<number> {
  if (optionValue(argv, 'target') !== 'codex') throw new Error('judgment:install currently requires --target codex');
  const payload = `${JSON.stringify(buildAutonomousHookConfig(), null, 2)}\n`;
  const outputPath = optionValue(argv, 'output');
  if (argv.includes('--dry-run') || !outputPath) {
    write(io, payload);
    return 0;
  }
  await mkdir(dirname(outputPath), { recursive: true });
  try {
    await writeFile(outputPath, payload, { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
      throw new Error(`Refusing to overwrite existing Hook config snippet ${outputPath}. Choose a new --output path or remove the old snippet first.`);
    }
    throw error;
  }
  write(io, `Wrote Codex Autonomous Judgment Host config snippet to ${outputPath}\n`);
  return 0;
}

export async function runAutonomyCli(argv = process.argv.slice(2), io: CliIo = process): Promise<number> {
  try {
    if (argv[0] === 'judgment:hook') return await judgmentHook(io);
    if (argv[0] === 'judgment:install') return await judgmentInstall(argv.slice(1), io);
    return await runCli(argv, io);
  } catch (error) {
    writeError(io, `${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  const code = await runAutonomyCli();
  process.exit(code);
}
