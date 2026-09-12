/**
 * Stdio facade for the Brainbase MCP server.
 *
 * The facade owns the client-facing stdio connection and publishes the
 * manifest-backed catalog before the authenticated Graph backend is started.
 * Requests which need the backend receive a bounded, retryable readiness
 * result while the backend launcher performs its normal Infisical and API
 * preflights.  A request that reaches the backend is sent exactly once by
 * this process; callers decide whether and when to retry it.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ReadBuffer, serializeMessage } from '@modelcontextprotocol/sdk/shared/stdio.js';
import type { RequestOptions } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { Transport, TransportSendOptions } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
  type CallToolResult,
  type JSONRPCMessage,
  type ListResourceTemplatesResult,
  type ListResourcesResult,
  type ResourceTemplate,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';

import { publishedTools, rejectLegacySearchSurface } from './server.js';

const DEFAULT_STARTUP_TIMEOUT_MS = 30_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_BACKOFF_MS = 250;
const MAX_STARTUP_TIMEOUT_MS = 120_000;
const MAX_REQUEST_TIMEOUT_MS = 300_000;
const MAX_RETRY_BACKOFF_MS = 30_000;
const MAX_ATTEMPTS = 5;
const PROCESS_TERM_GRACE_MS = 500;
const PROCESS_KILL_GRACE_MS = 500;
const CLOSE_TIMEOUT_MS = 2_000;

const BACKEND_STARTING_MESSAGE = 'Brainbase backend is starting; retry this request.';
const BACKEND_RETRY_MESSAGE = 'Brainbase backend is not ready; retry this request shortly.';
const BACKEND_EXHAUSTED_MESSAGE = 'Brainbase backend is unavailable for this connection.';
const BACKEND_REQUEST_MESSAGE = 'Brainbase backend request failed.';
const BACKEND_PROCESS_ERROR = 'Brainbase backend process is unavailable.';
const BACKEND_PROTOCOL_ERROR = 'Brainbase backend returned an invalid protocol message.';

type DiagnosticEvent = 'startup_started' | 'startup_ready' | 'startup_failed'
  | 'startup_timeout' | 'backend_disconnected' | 'process_spawned'
  | 'process_spawn_failed' | 'process_exit';
type ProcessDiagnostic = {
  event: DiagnosticEvent;
  child_pid?: number;
  exit_code?: number | null;
  signaled?: boolean;
};
export type BackendDiagnostic = ProcessDiagnostic & {
  facade_pid: number;
  timestamp: string;
  attempt: number;
  elapsed_ms: number;
};

/** This is intentionally duplicated from the backend's static resource catalog. */
export const WIKI_RESOURCE_TEMPLATE: ResourceTemplate = {
  uriTemplate: 'brainbase://wiki/page/{path}',
  name: 'wiki-page',
  title: 'Wiki Page',
  description: 'Read a brainbase wiki page by path. Example URI: brainbase://wiki/page/brainbase/project',
  mimeType: 'text/markdown',
};

export type BackendReadinessReason = 'starting' | 'backoff' | 'exhausted' | 'closed';

/**
 * Internal readiness error.  Its message and reason are fixed so backend
 * stderr, credentials, and launcher details never cross the MCP boundary.
 */
export class BackendReadinessError extends Error {
  readonly retryable: boolean;
  readonly reason: BackendReadinessReason;

  constructor(reason: BackendReadinessReason) {
    super(readinessMessage(reason));
    this.name = 'BackendReadinessError';
    this.reason = reason;
    // Exhaustion only ends the current bounded burst. Once its cooldown has
    // elapsed, the same frontend connection can start a fresh burst.
    this.retryable = reason !== 'closed';
  }
}

function readinessMessage(reason: BackendReadinessReason): string {
  switch (reason) {
    case 'starting':
      return BACKEND_STARTING_MESSAGE;
    case 'backoff':
      return BACKEND_RETRY_MESSAGE;
    case 'exhausted':
      return BACKEND_EXHAUSTED_MESSAGE;
    case 'closed':
      return 'Brainbase backend connection is closed.';
  }
}

function safeMcpError(message: string, data: Record<string, unknown> = {}): McpError {
  return new McpError(ErrorCode.InternalError, message, data);
}

function asReadinessMcpError(error: BackendReadinessError): McpError {
  return safeMcpError(error.message, {
    retryable: error.retryable,
    reason: error.reason,
  });
}

function asBackendMcpError(): McpError {
  return safeMcpError(BACKEND_REQUEST_MESSAGE, { retryable: false });
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(parsed)));
}

function envInteger(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  return boundedInteger(process.env[name], fallback, minimum, maximum);
}

function waitFor(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

/**
 * A stdio client transport with process-group cleanup.
 *
 * The SDK's StdioClientTransport deliberately only kills the direct child.
 * The Brainbase launcher is a shell which execs another process, so the
 * facade starts it detached and terminates the whole process group on close.
 */
export interface BackendProcessParameters {
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  onDiagnostic?: (event: ProcessDiagnostic) => void;
}

export class ChildProcessTransport implements Transport {
  private child: ChildProcessWithoutNullStreams | undefined;
  private processGroupId: number | undefined;
  private readonly readBuffer = new ReadBuffer();
  private closePromise: Promise<void> | undefined;
  private closeRequested = false;
  private closeNotified = false;

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  constructor(private readonly parameters: BackendProcessParameters) {}

  private diagnose(event: ProcessDiagnostic): void {
    try { this.parameters.onDiagnostic?.(event); } catch { /* Diagnostics never affect transport. */ }
  }

  get pid(): number | undefined {
    return this.child?.pid ?? this.processGroupId;
  }

  async start(): Promise<void> {
    if (this.child || this.processGroupId) {
      throw new Error(BACKEND_PROCESS_ERROR);
    }

    this.closeRequested = false;
    this.closeNotified = false;
    this.readBuffer.clear();

    await new Promise<void>((resolve, reject) => {
      let spawned = false;
      let settled = false;
      const child = spawn(this.parameters.command, this.parameters.args, {
        cwd: this.parameters.cwd,
        env: this.parameters.env,
        detached: process.platform !== 'win32',
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: process.platform === 'win32',
      }) as ChildProcessWithoutNullStreams;
      this.child = child;
      this.processGroupId = child.pid;

      child.once('spawn', () => {
        this.diagnose({ event: 'process_spawned', child_pid: child.pid });
        spawned = true;
        if (!settled) {
          settled = true;
          resolve();
        }
      });

      child.once('error', () => {
        this.diagnose({ event: 'process_spawn_failed', child_pid: child.pid });
        this.emitError(BACKEND_PROCESS_ERROR);
        if (!settled) {
          settled = true;
          reject(new Error(BACKEND_PROCESS_ERROR));
        }
      });

      child.once('exit', (code, signal) => {
        this.diagnose({ event: 'process_exit', child_pid: child.pid, exit_code: code, signaled: signal !== null });
        // `close` waits for inherited stdio handles. A detached descendant can
        // keep those handles open after the direct child exits, so clean the
        // process group at `exit` as well as at `close`.
        this.cleanupExitedProcessGroup();
      });

      child.once('close', () => {
        if (this.child === child) {
          this.child = undefined;
        }
        if (!spawned && !settled) {
          settled = true;
          reject(new Error(BACKEND_PROCESS_ERROR));
        }
        this.cleanupExitedProcessGroup();
        this.notifyClose();
      });

      child.stdin.on('error', () => this.emitError(BACKEND_PROCESS_ERROR));
      child.stdout.on('error', () => this.emitError(BACKEND_PROTOCOL_ERROR));
      child.stdout.on('data', (chunk: Buffer) => this.processOutput(chunk));

      // Drain stderr so a noisy backend cannot block on a full pipe.  Never
      // forward the bytes: Infisical and API clients can include credentials.
      child.stderr.on('data', () => undefined);
    });
  }

  async send(message: JSONRPCMessage, _options?: TransportSendOptions): Promise<void> {
    const stdin = this.child?.stdin;
    if (!stdin || stdin.destroyed || stdin.writableEnded) {
      throw new Error(BACKEND_PROCESS_ERROR);
    }

    const json = serializeMessage(message);
    await new Promise<void>((resolve, reject) => {
      const accepted = stdin.write(json, (error?: Error | null) => {
        if (error) {
          reject(new Error(BACKEND_PROCESS_ERROR));
          return;
        }
        resolve();
      });
      if (!accepted) {
        stdin.once('drain', resolve);
      }
    });
  }

  async close(): Promise<void> {
    if (this.closePromise) return this.closePromise;

    this.closeRequested = true;
    const child = this.child;
    const groupId = this.processGroupId;
    if (!child && groupId === undefined) {
      this.readBuffer.clear();
      this.notifyClose();
      return;
    }

    this.closePromise = (child
      ? this.closeChild(child, groupId)
      : this.closeProcessGroup(groupId))
      .finally(() => {
        this.closePromise = undefined;
      });
    return this.closePromise;
  }

  private processOutput(chunk: Buffer): void {
    try {
      this.readBuffer.append(chunk);
      while (true) {
        const message = this.readBuffer.readMessage();
        if (message === null) break;
        this.onmessage?.(message);
      }
    } catch {
      this.emitError(BACKEND_PROTOCOL_ERROR);
      void this.close();
    }
  }

  private emitError(message: string): void {
    this.onerror?.(new Error(message));
  }

  private cleanupExitedProcessGroup(): void {
    // If close() owns shutdown, closeChild/closeProcessGroup controls the
    // grace periods. Otherwise the direct child may already be gone while a
    // detached descendant still owns the group and inherited stdio handles.
    if (this.closeRequested || this.processGroupId === undefined) return;
    this.killProcessGroup(this.processGroupId, 'SIGKILL');
    this.processGroupId = undefined;
  }

  private notifyClose(): void {
    if (this.closeNotified) return;
    this.closeNotified = true;
    this.onclose?.();
  }

  private async closeChild(
    child: ChildProcessWithoutNullStreams,
    groupId: number | undefined,
  ): Promise<void> {
    const closed = new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        resolve();
        return;
      }
      child.once('close', () => resolve());
    });

    try {
      child.stdin.end();
    } catch {
      // The process may have exited between the state check and end().
    }

    await Promise.race([closed, waitFor(PROCESS_TERM_GRACE_MS)]);
    // Always signal the process group. The direct child may have exited while
    // a shell grandchild is still alive and holding credentials.
    this.killProcessGroup(groupId ?? child.pid, 'SIGTERM');
    await Promise.race([closed, waitFor(PROCESS_KILL_GRACE_MS)]);
    this.killProcessGroup(groupId ?? child.pid, 'SIGKILL');
    await Promise.race([closed, waitFor(PROCESS_KILL_GRACE_MS)]);

    if (this.child === child) {
      this.child = undefined;
    }
    if (this.processGroupId === groupId) {
      this.processGroupId = undefined;
    }
    this.readBuffer.clear();
    this.notifyClose();
  }

  private async closeProcessGroup(groupId: number | undefined): Promise<void> {
    if (groupId !== undefined) {
      this.killProcessGroup(groupId, 'SIGTERM');
      await waitFor(PROCESS_TERM_GRACE_MS);
      this.killProcessGroup(groupId, 'SIGKILL');
      await waitFor(PROCESS_KILL_GRACE_MS);
    }
    if (this.processGroupId === groupId) {
      this.processGroupId = undefined;
    }
    this.readBuffer.clear();
    this.notifyClose();
  }

  private killProcessGroup(groupId: number | undefined, signal: NodeJS.Signals): void {
    if (!groupId) return;
    try {
      if (process.platform !== 'win32') {
        process.kill(-groupId, signal);
      } else {
        this.child?.kill(signal);
      }
    } catch {
      // A process that already exited needs no further cleanup.
    }
  }
}

export type BackendClient = Pick<
  Client,
  'connect' | 'close' | 'listResources' | 'listResourceTemplates' | 'readResource' | 'callTool'
>;

export type BackendSessionState = 'idle' | 'starting' | 'ready' | 'failed' | 'closed';

export interface BackendSessionOptions {
  backendLauncher?: string;
  backendArgs?: string[];
  backendCwd?: string;
  backendEnv?: NodeJS.ProcessEnv;
  startupTimeoutMs?: number;
  requestTimeoutMs?: number;
  maxAttempts?: number;
  retryBackoffMs?: number;
  now?: () => number;
  onDiagnostic?: (event: BackendDiagnostic) => void;
  transportFactory?: (parameters: BackendProcessParameters) => Transport;
  clientFactory?: () => BackendClient;
}

export class BackendSession {
  private readonly onDiagnostic: ((event: BackendDiagnostic) => void) | undefined;
  private readonly backendLauncher: string;
  private readonly backendArgs: string[];
  private readonly backendCwd: string | undefined;
  private readonly backendEnv: NodeJS.ProcessEnv;
  private readonly startupTimeoutMs: number;
  readonly requestTimeoutMs: number;
  private readonly maxAttempts: number;
  private readonly retryBackoffMs: number;
  private readonly now: () => number;
  private readonly transportFactory: (parameters: BackendProcessParameters) => Transport;
  private readonly clientFactory: () => BackendClient;
  private stateValue: BackendSessionState = 'idle';
  private attempts = 0;
  private nextRetryAt = 0;
  private startingTransport: Transport | undefined;
  private startingClient: BackendClient | undefined;
  private currentTransport: Transport | undefined;
  private currentClient: BackendClient | undefined;
  private closePromise: Promise<void> | undefined;

  constructor(options: BackendSessionOptions = {}) {
    // Opt-in only. Raw errors, launcher arguments, env and stderr are never logged.
    this.onDiagnostic = options.onDiagnostic ?? (process.env.BRAINBASE_MCP_DIAGNOSTICS === '1'
      ? (event) => { process.stderr.write(`${JSON.stringify({ schema: 'brainbase-mcp-lifecycle-v1', ...event })}\n`); }
      : undefined);
    this.backendLauncher = options.backendLauncher ?? defaultBackendLauncher();
    this.backendArgs = options.backendArgs ?? [];
    this.backendCwd = options.backendCwd;
    this.backendEnv = options.backendEnv ?? { ...process.env };
    this.startupTimeoutMs = Math.min(
      MAX_STARTUP_TIMEOUT_MS,
      Math.max(1, options.startupTimeoutMs ?? envInteger(
        'BRAINBASE_MCP_STARTUP_TIMEOUT_MS',
        DEFAULT_STARTUP_TIMEOUT_MS,
        1,
        MAX_STARTUP_TIMEOUT_MS,
      )),
    );
    this.requestTimeoutMs = Math.min(
      MAX_REQUEST_TIMEOUT_MS,
      Math.max(1, options.requestTimeoutMs ?? envInteger(
        'BRAINBASE_MCP_REQUEST_TIMEOUT_MS',
        DEFAULT_REQUEST_TIMEOUT_MS,
        1,
        MAX_REQUEST_TIMEOUT_MS,
      )),
    );
    this.maxAttempts = Math.min(
      MAX_ATTEMPTS,
      Math.max(1, options.maxAttempts ?? envInteger('BRAINBASE_MCP_MAX_ATTEMPTS', DEFAULT_MAX_ATTEMPTS, 1, MAX_ATTEMPTS)),
    );
    this.retryBackoffMs = Math.min(
      MAX_RETRY_BACKOFF_MS,
      Math.max(0, options.retryBackoffMs ?? envInteger(
        'BRAINBASE_MCP_RETRY_BACKOFF_MS',
        DEFAULT_RETRY_BACKOFF_MS,
        0,
        MAX_RETRY_BACKOFF_MS,
      )),
    );
    this.now = options.now ?? Date.now;
    this.transportFactory = options.transportFactory ?? ((parameters) => new ChildProcessTransport(parameters));
    this.clientFactory = options.clientFactory ?? (() => new Client(
      { name: 'brainbase-stdio-facade', version: '1.0.0' },
      { capabilities: {} },
    ));
  }

  get state(): BackendSessionState {
    return this.stateValue;
  }

  get attemptCount(): number {
    return this.attempts;
  }

  /** Start backend initialization without making a client request wait for it. */
  kickoff(): void {
    if (this.stateValue === 'closed' || this.stateValue === 'ready' || this.stateValue === 'starting') {
      return;
    }
    const now = this.now();
    if (now < this.nextRetryAt) return;
    if (this.attempts >= this.maxAttempts) {
      this.attempts = 0;
      this.nextRetryAt = 0;
      this.stateValue = 'idle';
    }
    this.beginStartup();
  }

  /**
   * Start at most one backend attempt and report readiness to the caller.
   * The caller must retry the original operation after a readiness error.
   */
  async ensureReady(): Promise<BackendClient> {
    if (this.stateValue === 'closed') {
      throw new BackendReadinessError('closed');
    }
    if (this.stateValue === 'ready' && this.currentClient) {
      return this.currentClient;
    }
    if (this.stateValue === 'starting') {
      throw new BackendReadinessError('starting');
    }
    const now = this.now();
    if (this.attempts >= this.maxAttempts) {
      if (now < this.nextRetryAt) {
        throw new BackendReadinessError('exhausted');
      }
      // Reset the bounded burst after cooldown. A connection stays usable
      // across transient startup failures instead of becoming permanently
      // exhausted after maxAttempts.
      this.attempts = 0;
      this.nextRetryAt = 0;
      this.stateValue = 'idle';
    }
    if (now < this.nextRetryAt) {
      throw new BackendReadinessError('backoff');
    }

    this.beginStartup();
    throw new BackendReadinessError('starting');
  }

  async close(): Promise<void> {
    if (this.closePromise) return this.closePromise;

    this.stateValue = 'closed';
    const client = this.currentClient ?? this.startingClient;
    const transport = this.currentTransport ?? this.startingTransport;
    this.currentClient = undefined;
    this.currentTransport = undefined;
    this.startingClient = undefined;
    this.startingTransport = undefined;
    this.closePromise = (async () => {
      // Do not wait for a potentially hung connect(). Closing the captured
      // transport immediately is what bounds shutdown and kills descendants.
      await Promise.all([closeQuietly(client), closeQuietly(transport)]);
    })().finally(() => {
      this.closePromise = undefined;
    });
    return this.closePromise;
  }

  private beginStartup(): void {
    this.attempts += 1;
    this.stateValue = 'starting';
    void this.startAttempt();
  }

  private async startAttempt(): Promise<void> {
    let transport: Transport | undefined;
    let client: BackendClient | undefined;
    const startedAt = this.now();
    const attempt = this.attempts;
    const diagnose = (event: ProcessDiagnostic): void => {
      try {
        this.onDiagnostic?.({ ...event, facade_pid: process.pid, timestamp: new Date().toISOString(),
          attempt, elapsed_ms: Math.max(0, this.now() - startedAt) });
      } catch { /* A broken diagnostic sink must not break MCP. */ }
    };
    let timedOut = false;
    diagnose({ event: 'startup_started' });
    try {
      transport = this.transportFactory({
        command: this.backendLauncher,
        args: [...this.backendArgs],
        cwd: this.backendCwd,
        env: { ...this.backendEnv },
        onDiagnostic: diagnose,
      });
      client = this.clientFactory();
      this.startingTransport = transport;
      this.startingClient = client;
      const connectPromise = client.connect(transport, {
        timeout: this.startupTimeoutMs,
        maxTotalTimeout: this.startupTimeoutMs,
      });
      await Promise.race([
        connectPromise,
        waitFor(this.startupTimeoutMs).then(() => {
          timedOut = true;
          throw new Error(BACKEND_PROCESS_ERROR);
        }),
      ]);

      if (this.stateValue === 'closed') {
        await closeQuietly(client);
        await closeQuietly(transport);
        if (this.startingClient === client) this.startingClient = undefined;
        if (this.startingTransport === transport) this.startingTransport = undefined;
        return;
      }

      if (this.startingClient === client) this.startingClient = undefined;
      if (this.startingTransport === transport) this.startingTransport = undefined;
      this.currentTransport = transport;
      this.currentClient = client;
      this.stateValue = 'ready';
      diagnose({ event: 'startup_ready' });
      const previousOnClose = transport.onclose;
      let closeHandled = false;
      transport.onclose = () => {
        if (closeHandled) return;
        closeHandled = true;
        try {
          previousOnClose?.();
        } finally {
          if (this.currentTransport === transport) {
            this.currentTransport = undefined;
            this.currentClient = undefined;
            if (this.stateValue !== 'closed') {
              this.stateValue = 'failed';
              diagnose({ event: 'backend_disconnected' });
              this.nextRetryAt = this.now() + this.retryBackoffMs;
            }
          }
          // The SDK transport can report close after its direct child has
          // exited while a detached descendant still owns the process group.
          // Keep cleanup independent of the session's current transport ref.
          void closeQuietly(transport);
        }
      };
    } catch {
      // Keep the original error private.  The frontend reports the fixed
      // readiness message above and never forwards launcher stderr.
      // Classify before cleanup: closing a failed child can itself take time.
      const failureEvent = timedOut || this.now() - startedAt >= this.startupTimeoutMs
        ? 'startup_timeout' : 'startup_failed';
      await closeQuietly(client);
      await closeQuietly(transport);
      if (this.startingClient === client) this.startingClient = undefined;
      if (this.startingTransport === transport) this.startingTransport = undefined;
      if (this.stateValue !== 'closed') {
        this.stateValue = 'failed';
        diagnose({ event: failureEvent });
        this.nextRetryAt = this.now() + this.retryBackoffMs;
      }
    }
  }
}

async function closeQuietly(value: { close(): Promise<void> } | undefined): Promise<void> {
  if (!value) return;
  const closePromise = Promise.resolve()
    .then(() => value.close())
    .catch(() => undefined);
  await Promise.race([closePromise, waitFor(CLOSE_TIMEOUT_MS)]);
}

function defaultBackendLauncher(): string {
  const configured = process.env.BRAINBASE_MCP_BACKEND_LAUNCHER;
  if (configured) return configured;
  return join(dirname(fileURLToPath(import.meta.url)), '../../../scripts/run-brainbase-mcp.sh');
}

function requestOptions(extra: { signal: AbortSignal }, timeoutMs: number): RequestOptions {
  return {
    signal: extra.signal,
    timeout: timeoutMs,
    maxTotalTimeout: timeoutMs,
  };
}

function readinessToolResultFromMcpError(error: McpError): CallToolResult | undefined {
  const data = error.data;
  if (!data || typeof data !== 'object') return undefined;
  const reason = (data as Record<string, unknown>).reason;
  const retryable = (data as Record<string, unknown>).retryable;
  if (
    (reason !== 'starting' && reason !== 'backoff' && reason !== 'exhausted' && reason !== 'closed')
    || typeof retryable !== 'boolean'
  ) {
    return undefined;
  }
  return {
    isError: true,
    content: [{ type: 'text', text: readinessMessage(reason) }],
    _meta: {
      'brainbase.retryable': retryable,
      'brainbase.readinessReason': reason,
    },
  };
}

function backendToolFailureResult(): CallToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: BACKEND_REQUEST_MESSAGE }],
    _meta: { 'brainbase.retryable': false },
  };
}

export interface FacadeOptions {
  tools?: Tool[];
  resourceTemplates?: ResourceTemplate[];
  requestTimeoutMs?: number;
}

export function createFacadeServer(
  backend: Pick<BackendSession, 'ensureReady'>,
  options: FacadeOptions = {},
): Server {
  const tools = options.tools ?? publishedTools;
  const resourceTemplates = options.resourceTemplates ?? [WIKI_RESOURCE_TEMPLATE];
  const timeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const server = new Server(
    { name: 'brainbase', version: '1.0.0' },
    { capabilities: { tools: {}, resources: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async (): Promise<ListResourceTemplatesResult> => ({
    resourceTemplates,
  }));

  server.setRequestHandler(ListResourcesRequestSchema, async (request, extra): Promise<ListResourcesResult> => {
    const client = await requireBackend(backend);
    try {
      return await client.listResources(request.params, requestOptions(extra, timeoutMs));
    } catch {
      throw asBackendMcpError();
    }
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request, extra) => {
    const client = await requireBackend(backend);
    try {
      return await client.readResource(request.params, requestOptions(extra, timeoutMs));
    } catch {
      throw asBackendMcpError();
    }
  });

  server.setRequestHandler(CallToolRequestSchema, async (request, extra): Promise<CallToolResult> => {
    try {
      rejectLegacySearchSurface(request.params.name, request.params.arguments ?? {});
    } catch (error) {
      return {content: [{type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}`}], isError: true};
    }
    let client: BackendClient;
    try {
      client = await requireBackend(backend);
    } catch (error) {
      if (error instanceof McpError) {
        return readinessToolResultFromMcpError(error) ?? backendToolFailureResult();
      }
      return backendToolFailureResult();
    }

    try {
      // No automatic replay: a backend call either returns its result or
      // yields one fixed failure result.  A later user request may choose to
      // retry after the session observes a transport close.
      return await client.callTool(
        request.params,
        undefined,
        requestOptions(extra, timeoutMs),
      ) as unknown as CallToolResult;
    } catch {
      return backendToolFailureResult();
    }
  });

  return server;
}

async function requireBackend(backend: Pick<BackendSession, 'ensureReady'>): Promise<BackendClient> {
  try {
    return await backend.ensureReady();
  } catch (error) {
    if (error instanceof BackendReadinessError) {
      throw asReadinessMcpError(error);
    }
    throw asBackendMcpError();
  }
}

export async function runFacade(): Promise<void> {
  const backend = new BackendSession({ backendArgs: process.argv.slice(2) });
  const server = createFacadeServer(backend, { requestTimeoutMs: backend.requestTimeoutMs });
  const transport = new StdioServerTransport();
  let shutdownPromise: Promise<void> | undefined;
  let exitRequested = false;

  const shutdown = (): Promise<void> => {
    if (shutdownPromise) return shutdownPromise;
    // Keep one shared promise for every lifecycle trigger.  In particular,
    // stdin EOF and a near-simultaneous signal must wait for the same backend
    // process-group cleanup instead of letting the signal handler exit early.
    shutdownPromise = (async () => {
      await backend.close();
      await server.close().catch(() => undefined);
    })();
    return shutdownPromise;
  };

  const exitAfterShutdown = () => {
    if (exitRequested) return;
    exitRequested = true;
    void shutdown().finally(() => process.exit(0));
  };

  // The SDK replaces transport.onclose during server.connect(). Use the
  // server lifecycle hook so shutdown remains wired after that wrapping.
  server.oninitialized = () => {
    backend.kickoff();
  };
  server.onclose = () => {
    void shutdown();
  };
  process.stdin.once('end', exitAfterShutdown);
  process.stdin.once('close', exitAfterShutdown);
  process.once('SIGTERM', exitAfterShutdown);
  process.once('SIGINT', exitAfterShutdown);

  try {
    await server.connect(transport);
  } catch (error) {
    await shutdown();
    throw error;
  }
}

function isMainModule(): boolean {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

const invokedPath = isMainModule();
if (invokedPath) {
  runFacade().catch(() => {
    // Keep stdout reserved for MCP JSON-RPC.  Do not print the underlying
    // error because it may contain launcher or credential details.
    process.exitCode = 1;
  });
}
