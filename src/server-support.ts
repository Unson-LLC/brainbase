/**
 * Small HTTP-host helpers shared by Brainbase servers: a structured error with
 * client-safe JSON, an async route wrapper, and a JSON logger that masks
 * secrets. They carry no organization, tenant, or deployment concept.
 */

type UnknownRecord = Record<string, unknown>;

export interface ErrorCodeEntry {
  code: string;
  statusCode: number;
}

/** Standard error codes. `code` is safe to expose to clients. */
export const ErrorCodes = {
  VALIDATION_ERROR: { code: 'VALIDATION_ERROR', statusCode: 400 },
  INVALID_DATE_FORMAT: { code: 'INVALID_DATE_FORMAT', statusCode: 400 },
  MISSING_REQUIRED_FIELD: { code: 'MISSING_REQUIRED_FIELD', statusCode: 400 },
  UNSUPPORTED_FORMAT: { code: 'UNSUPPORTED_FORMAT', statusCode: 400 },

  UNAUTHORIZED: { code: 'UNAUTHORIZED', statusCode: 401 },
  FORBIDDEN: { code: 'FORBIDDEN', statusCode: 403 },
  CROSS_TENANT_CANDIDATE: { code: 'CROSS_TENANT_CANDIDATE', statusCode: 403 },

  PROJECT_NOT_FOUND: { code: 'PROJECT_NOT_FOUND', statusCode: 404 },
  SESSION_NOT_FOUND: { code: 'SESSION_NOT_FOUND', statusCode: 404 },
  TASK_NOT_FOUND: { code: 'TASK_NOT_FOUND', statusCode: 404 },
  SCHEDULE_NOT_FOUND: { code: 'SCHEDULE_NOT_FOUND', statusCode: 404 },
  WORKTREE_NOT_FOUND: { code: 'WORKTREE_NOT_FOUND', statusCode: 404 },
  EVENT_NOT_FOUND: { code: 'EVENT_NOT_FOUND', statusCode: 404 },

  CONFLICT: { code: 'CONFLICT', statusCode: 409 },
  PORT_IN_USE: { code: 'PORT_IN_USE', statusCode: 409 },

  INTERNAL_ERROR: { code: 'INTERNAL_ERROR', statusCode: 500 },
  DATABASE_ERROR: { code: 'DATABASE_ERROR', statusCode: 500 },

  PROJECT_CATALOG_UNAVAILABLE: { code: 'PROJECT_CATALOG_UNAVAILABLE', statusCode: 503 },

  TIMEOUT: { code: 'TIMEOUT', statusCode: 504 },
} satisfies Record<string, ErrorCodeEntry>;

export interface AppErrorOptions {
  details?: UnknownRecord | null;
  cause?: unknown;
}

export interface AppErrorLog {
  code: string;
  message: string;
  statusCode: number;
  timestamp: string;
  details?: UnknownRecord;
  cause?: string;
}

/** A structured error: the message and code go to clients, details stay in logs. */
export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly timestamp: string;
  readonly details: UnknownRecord | null;
  override cause?: unknown;

  constructor(message: string, errorCode: ErrorCodeEntry, options: AppErrorOptions = {}) {
    super(message);
    this.name = 'AppError';
    this.code = errorCode.code;
    this.statusCode = errorCode.statusCode;
    this.timestamp = new Date().toISOString();
    this.details = options.details || null;
    if (options.cause) this.cause = options.cause;
  }

  /** Client-safe JSON. It never includes details. */
  toJSON(): { error: { code: string; message: string; timestamp: string } } {
    return { error: { code: this.code, message: this.message, timestamp: this.timestamp } };
  }

  /** Log object, including details and the cause message. */
  toLog(): AppErrorLog {
    const log: AppErrorLog = {
      code: this.code,
      message: this.message,
      statusCode: this.statusCode,
      timestamp: this.timestamp,
    };
    if (this.details) log.details = this.details;
    if (this.cause) log.cause = this.cause instanceof Error ? this.cause.message : String(this.cause);
    return log;
  }

  static isAppError(error: unknown): error is AppError {
    return error instanceof AppError;
  }

  static notFound(resource: string, id: string): AppError {
    const dynamicCode = (ErrorCodes as Record<string, ErrorCodeEntry>)[`${resource.toUpperCase()}_NOT_FOUND`];
    return new AppError(`${resource} '${id}' not found`, dynamicCode || ErrorCodes.SESSION_NOT_FOUND);
  }

  static validation(message: string, details?: UnknownRecord): AppError {
    return new AppError(message, ErrorCodes.VALIDATION_ERROR, { details });
  }

  static unauthorized(message = 'Unauthorized'): AppError {
    return new AppError(message, ErrorCodes.UNAUTHORIZED);
  }

  static forbidden(message = 'Forbidden', details?: UnknownRecord): AppError {
    return new AppError(message, ErrorCodes.FORBIDDEN, { details });
  }

  static conflict(message: string, details?: UnknownRecord): AppError {
    return new AppError(message, ErrorCodes.CONFLICT, { details });
  }

  static internal(message = 'Internal server error', cause?: Error): AppError {
    return new AppError(message, ErrorCodes.INTERNAL_ERROR, { cause });
  }
}

type RouteHandler = (req: any, res: any, next: (error?: unknown) => unknown) => unknown;

/** Wraps an async route handler so that a rejection reaches the error middleware. */
export function asyncHandler(fn: RouteHandler): (req: any, res: any, next: (error?: unknown) => unknown) => void {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch((error) => {
      next(error);
    });
  };
}

const SENSITIVE_KEYS = [
  'password', 'token', 'secret', 'key', 'credential', 'auth', 'apikey', 'api_key',
  'access_token', 'refresh_token', 'private', 'cookie', 'session',
];

const SENSITIVE_PATH_PATTERNS = [/\/\.env/, /\/credentials/, /\/secrets/, /\/\.ssh/, /\/\.gnupg/];

function redact(value: unknown, depth = 0): unknown {
  if (depth > 10) return '[MAX_DEPTH]';
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') {
    if (typeof value === 'string') {
      if (/^eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/.test(value)) return '[JWT_REDACTED]';
      if (/^[a-fA-F0-9]{32,}$/.test(value)) return '[HEX_KEY_REDACTED]';
      if (SENSITIVE_PATH_PATTERNS.some((pattern) => pattern.test(value))) return '[SENSITIVE_PATH_REDACTED]';
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  const result: UnknownRecord = {};
  for (const [key, item] of Object.entries(value)) {
    const lowerKey = key.toLowerCase();
    result[key] = SENSITIVE_KEYS.some((sensitive) => lowerKey.includes(sensitive)) ? '[REDACTED]' : redact(item, depth + 1);
  }
  return result;
}

function formatLog(level: string, msg: string, data: unknown = {}): string {
  const masked = redact(data);
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    msg,
    ...(masked && typeof masked === 'object' && !Array.isArray(masked) ? masked : {}),
  });
}

/** JSON-line logger that masks secrets. DEBUG enables debug lines. */
export const logger = {
  info(msg: string, data: UnknownRecord = {}): void {
    console.log(formatLog('info', msg, data));
  },
  warn(msg: string, data: UnknownRecord = {}): void {
    console.warn(formatLog('warn', msg, data));
  },
  error(msg: string, data: Error | (UnknownRecord & { error?: unknown }) = {}): void {
    let entry: UnknownRecord;
    if (data instanceof Error) {
      entry = { error: data.message, stack: data.stack };
    } else if (data.error instanceof Error) {
      entry = { ...data, error: data.error.message, stack: data.error.stack };
    } else {
      entry = data;
    }
    console.error(formatLog('error', msg, entry));
  },
  debug(msg: string, data: UnknownRecord = {}): void {
    if (process.env.DEBUG) console.log(formatLog('debug', msg, data));
  },
};
