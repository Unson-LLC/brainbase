/**
 * Host-owned dependencies shared by the routine and automation run cores.
 *
 * The OSS package deliberately does not resolve a tenant, user, credential,
 * storage directory, or Graph connection by itself. A consumer supplies those
 * values through these ports for every operation.
 */

export type Awaitable<T> = T | PromiseLike<T>;

export interface RuntimePortInput {
  operation: string;
  routine?: string;
  automationId?: string;
  runId?: string;
  request?: unknown;
}

export interface RuntimeHostContext {
  storageRoot: string;
  now: Date;
  tenantId: string;
  identity: unknown;
  auth: unknown;
  graph: unknown;
  input: RuntimePortInput;
}

export interface RuntimeStorageRootPort {
  resolve(input: RuntimePortInput): Awaitable<string>;
}

export interface RuntimeClockPort {
  now(): Date;
}

export interface RuntimeIdentityPort {
  resolve(input: RuntimePortInput & { tenantId: string }): Awaitable<unknown>;
}

export interface RuntimeTenantPort {
  resolve(input: RuntimePortInput): Awaitable<string>;
}

export type RuntimeAuthorization =
  | boolean
  | void
  | {
      approved: boolean;
      context?: unknown;
    };

export interface RuntimeAuthPort {
  authorize(input: RuntimePortInput & {
    tenantId: string;
    identity: unknown;
  }): Awaitable<RuntimeAuthorization>;
}

export interface RuntimeGraphPort {
  resolve(input: RuntimePortInput & {
    tenantId: string;
    identity: unknown;
  }): Awaitable<unknown>;
}

export interface RuntimeHostPorts {
  storageRoot: RuntimeStorageRootPort;
  clock: RuntimeClockPort;
  identity: RuntimeIdentityPort;
  tenant: RuntimeTenantPort;
  auth: RuntimeAuthPort;
  graph: RuntimeGraphPort;
}

export function assertRuntimeHostPorts(ports: RuntimeHostPorts): void {
  if (!ports || typeof ports !== 'object') {
    throw new Error('runtime host ports are required');
  }

  const required = ['storageRoot', 'clock', 'identity', 'tenant', 'auth', 'graph'] as const;
  for (const name of required) {
    if (!ports[name] || typeof ports[name] !== 'object') {
      throw new Error(`runtime host port ${name} is required`);
    }
  }

  for (const [name, value] of [
    ['storageRoot.resolve', ports.storageRoot.resolve],
    ['clock.now', ports.clock.now],
    ['identity.resolve', ports.identity.resolve],
    ['tenant.resolve', ports.tenant.resolve],
    ['auth.authorize', ports.auth.authorize],
    ['graph.resolve', ports.graph.resolve]
  ] as const) {
    if (typeof value !== 'function') {
      throw new Error(`runtime host port ${name} must be a function`);
    }
  }
}

export async function resolveRuntimeHostContext(
  ports: RuntimeHostPorts,
  input: RuntimePortInput
): Promise<RuntimeHostContext> {
  assertRuntimeHostPorts(ports);

  const storageRoot = await ports.storageRoot.resolve(input);
  if (typeof storageRoot !== 'string' || storageRoot.trim() === '') {
    throw new Error('runtime storage root must be a non-empty string');
  }

  const tenantId = await ports.tenant.resolve(input);
  if (typeof tenantId !== 'string' || tenantId.trim() === '') {
    throw new Error('runtime tenant port must resolve a non-empty string');
  }

  const identity = await ports.identity.resolve({ ...input, tenantId });
  if (identity === null || identity === undefined) {
    throw new Error('runtime identity port must resolve an identity');
  }

  const authorization = await ports.auth.authorize({ ...input, tenantId, identity });
  if (
    authorization === false
    || (typeof authorization === 'object'
      && authorization !== null
      && 'approved' in authorization
      && authorization.approved === false)
  ) {
    throw new Error(`runtime authorization denied for ${input.operation}`);
  }

  const graph = await ports.graph.resolve({ ...input, tenantId, identity });
  if (graph === null || graph === undefined) {
    throw new Error('runtime Graph port must resolve a context');
  }

  const now = ports.clock.now();
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new Error('runtime clock must return a valid Date');
  }

  return {
    storageRoot,
    now,
    tenantId,
    identity,
    auth: authorization,
    graph,
    input
  };
}
