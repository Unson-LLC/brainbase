import { execFile as execFileCallback, type ExecFileOptions } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

const JUDGMENT_AUDIT_TOOL_NAME = 'brainbase_judgment_audit_read';
const OWNER_AUDIT_SCHEMA_VERSION = 'brainbase-owner-audit-v1';
const TURN_REF_PATTERN = /^[a-f0-9]{64}\/[a-f0-9]{64}$/u;
const HOST_SCRIPT_PATH = fileURLToPath(new URL(
  '../../../../scripts/codex-hooks/judgment-resolver-host.mjs',
  import.meta.url,
));
const HOST_TIMEOUT_MS = 15_000;
const HOST_MAX_BUFFER_BYTES = 256 * 1024;

export type JudgmentAuditReadData = {
  schema_version: 'brainbase-owner-audit-v1';
  turn_ref: string;
  lines: string[];
  prefix: string;
};

type ExecFileResult = { stdout: string; stderr: string };
type ExecFileRunner = (
  file: string,
  args: readonly string[],
  options: ExecFileOptions,
) => Promise<ExecFileResult>;

export type JudgmentAuditToolDependencies = {
  execFile?: ExecFileRunner;
};

export type JudgmentAuditToolResult =
  | { status: 'ok'; data: JudgmentAuditReadData }
  | { status: 'error'; error: { code: string; message: string } }
  | null;

export const judgmentAuditTools: Tool[] = [{
  name: JUDGMENT_AUDIT_TOOL_NAME,
  description: 'Read the Host-confirmed owner-audit prefix for the current turn. After all business tools, call this immediately before brainbase_judgment_state_record when that state tool is required (it remains the final tool call), or immediately before the final answer otherwise. Copy data.prefix verbatim as the first text in that answer. If any business tool is used after this call, call it again immediately before the state record or final answer so the prefix reflects the latest Host journal. This read-only tool does not record state or replace the Stop audit check.',
  inputSchema: {
    type: 'object',
    properties: {
      turn_ref: {
        type: 'string',
        pattern: '^[a-f0-9]{64}/[a-f0-9]{64}$',
        description: 'The Host-issued session/turn reference, copied unchanged from the resolver contract.',
      },
    },
    required: ['turn_ref'],
    additionalProperties: false,
  },
}];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function isValidTurnRef(value: unknown): value is string {
  return typeof value === 'string' && TURN_REF_PATTERN.test(value);
}

function isValidAuditData(value: unknown, turnRef: string): value is JudgmentAuditReadData {
  if (!isRecord(value) || !hasOnlyKeys(value, ['schema_version', 'turn_ref', 'lines', 'prefix'])) return false;
  if (value.schema_version !== OWNER_AUDIT_SCHEMA_VERSION || value.turn_ref !== turnRef) return false;
  if (!Array.isArray(value.lines)
    || value.lines.length === 0
    || !value.lines.every((line) => typeof line === 'string' && line.length > 0)
    || typeof value.prefix !== 'string'
    || value.prefix.length === 0) {
    return false;
  }
  return value.prefix === value.lines.join('\n');
}

function invalidInput(): Exclude<JudgmentAuditToolResult, null | { status: 'ok'; data: JudgmentAuditReadData }> {
  return {
    status: 'error',
    error: {
      code: 'judgment_audit_input_invalid',
      message: 'Judgment audit read requires exactly one lowercase hexadecimal session/turn reference in the form <64-hex>/<64-hex>',
    },
  };
}

function invalidResponse(): Exclude<JudgmentAuditToolResult, null | { status: 'ok'; data: JudgmentAuditReadData }> {
  return {
    status: 'error',
    error: {
      code: 'judgment_audit_response_invalid',
      message: 'Host returned an invalid brainbase-owner-audit-v1 response',
    },
  };
}

function unavailable(): Exclude<JudgmentAuditToolResult, null | { status: 'ok'; data: JudgmentAuditReadData }> {
  return {
    status: 'error',
    error: {
      code: 'judgment_audit_unavailable',
      message: 'Host owner audit could not be read',
    },
  };
}

const defaultExecFile: ExecFileRunner = (file, args, options) => new Promise((resolve, reject) => {
  execFileCallback(file, args, options, (error, stdout, stderr) => {
    if (error) {
      reject(error);
      return;
    }
    resolve({
      stdout: typeof stdout === 'string' ? stdout : stdout.toString('utf8'),
      stderr: typeof stderr === 'string' ? stderr : stderr.toString('utf8'),
    });
  });
});

function parseHostResponse(stdout: string, turnRef: string): JudgmentAuditReadData | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }

  // The Host CLI emits the immutable audit data object directly. Keep this
  // boundary strict so an MCP response envelope or another caller-controlled
  // shape cannot be mistaken for the Host's canonical payload.
  return isValidAuditData(parsed, turnRef) ? parsed : null;
}

export async function handleJudgmentAuditToolCall(
  name: string,
  args: Record<string, unknown>,
  dependencies: JudgmentAuditToolDependencies = {},
): Promise<JudgmentAuditToolResult> {
  if (name !== JUDGMENT_AUDIT_TOOL_NAME) return null;
  if (!isRecord(args)
    || !hasOnlyKeys(args, ['turn_ref'])
    || !isValidTurnRef(args.turn_ref)) {
    return invalidInput();
  }

  const turnRef = args.turn_ref;
  const execFile = dependencies.execFile ?? defaultExecFile;
  try {
    const result = await execFile(
      process.execPath,
      [HOST_SCRIPT_PATH, '--read-audit', turnRef],
      {
        shell: false,
        timeout: HOST_TIMEOUT_MS,
        maxBuffer: HOST_MAX_BUFFER_BYTES,
        encoding: 'utf8',
      },
    );
    const data = parseHostResponse(result.stdout, turnRef);
    return data ? { status: 'ok', data } : invalidResponse();
  } catch {
    return unavailable();
  }
}
