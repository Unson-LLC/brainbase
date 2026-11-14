import { createHash } from 'node:crypto';

// Shared contract between the judgment Host and the judgment resolver.
// The resolver's HTTP mount and its service must throw and recognize the
// same error class, and both sides must produce identical canonical bytes,
// so these live in one public module instead of being copied per caller.

function compareCodePoints(left: string, right: string): number {
  const a = Array.from(left, (value) => value.codePointAt(0) as number);
  const b = Array.from(right, (value) => value.codePointAt(0) as number);
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('canonical JSON only supports finite numbers');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort(compareCodePoints).map((key) => {
      const entry = (value as Record<string, unknown>)[key];
      if (entry === undefined) throw new TypeError('canonical JSON does not support undefined');
      return `${JSON.stringify(key)}:${canonicalJson(entry)}`;
    }).join(',')}}`;
  }
  throw new TypeError(`canonical JSON does not support ${typeof value}`);
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function computeRequestDigest(rawInput: unknown): string {
  return sha256Hex(canonicalJson(rawInput));
}

export class JudgmentResolutionError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = 'JudgmentResolutionError';
    this.code = code;
    this.status = status;
  }

  toJSON(): { name: string; code: string; status: number; message: string } {
    return { name: this.name, code: this.code, status: this.status, message: this.message };
  }
}
