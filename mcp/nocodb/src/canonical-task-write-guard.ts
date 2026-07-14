import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUIRED_MANIFEST_KEYS = [
  'base_id',
  'owner_person_id',
  'project',
  'schema_version',
  'table_id',
  'table_name',
] as const;

const FORBIDDEN_IDENTITY_OVERRIDES = [
  'CANONICAL_TASK_BASE_ID',
  'CANONICAL_TASK_TABLE_ID',
  'CANONICAL_TASK_TABLE_NAME',
  'CANONICAL_TASK_PROJECT',
  'CANONICAL_TASK_OWNER_PERSON_ID',
  'CANONICAL_TASK_STORE_HASH',
] as const;

const EXPECTED_CANONICAL_IDENTITY = Object.freeze({
  base_id: 'pva7l2qlu6fdfip',
  table_id: 'm7iys8m7o1abr3f',
  table_name: 'タスク',
  project: 'brainbase',
});

export interface CanonicalTaskStoreManifest {
  schema_version: string;
  base_id: string;
  table_id: string;
  table_name: string;
  project: string;
  owner_person_id: string;
}

export interface NocoDBTableIdentity {
  id: string;
  title: string;
}

export interface NocoDBColumnIdentity {
  id?: string;
  fk_model_id?: string;
  model_id?: string;
  table_id?: string;
  fk_table_id?: string;
}

export interface CanonicalTaskMetadataResolver {
  listTables(baseId: string): Promise<NocoDBTableIdentity[]>;
  getColumn(columnId: string): Promise<NocoDBColumnIdentity>;
}

export type CanonicalTaskWriteGuardCode =
  | 'canonical_task_api_required'
  | 'canonical_task_mutation_not_ready';

export class CanonicalTaskWriteGuardError extends Error {
  readonly code: CanonicalTaskWriteGuardCode;

  constructor(code: CanonicalTaskWriteGuardCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CanonicalTaskWriteGuardError';
    this.code = code;
  }
}

interface LoadedManifest {
  manifest: Readonly<CanonicalTaskStoreManifest>;
  identityHash: string;
}

interface GuardInitialization {
  loaded?: LoadedManifest;
  error?: Error;
}

function defaultManifestPath(): string {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  return resolve(moduleDirectory, '../../../config/canonical-task-store.json');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
}

function requireNonEmptyString(
  value: unknown,
  field: keyof CanonicalTaskStoreManifest
): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`canonical Task manifest field ${field} must be a non-empty string`);
  }
  return value;
}

function parseManifest(raw: unknown): CanonicalTaskStoreManifest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('canonical Task manifest must be a JSON object');
  }

  const object = raw as Record<string, unknown>;
  const actualKeys = Object.keys(object).sort();
  const expectedKeys = [...REQUIRED_MANIFEST_KEYS].sort();
  if (actualKeys.join('\u0000') !== expectedKeys.join('\u0000')) {
    throw new Error(`canonical Task manifest keys must be exactly: ${expectedKeys.join(', ')}`);
  }

  const manifest: CanonicalTaskStoreManifest = {
    schema_version: requireNonEmptyString(object.schema_version, 'schema_version'),
    base_id: requireNonEmptyString(object.base_id, 'base_id'),
    table_id: requireNonEmptyString(object.table_id, 'table_id'),
    table_name: requireNonEmptyString(object.table_name, 'table_name'),
    project: requireNonEmptyString(object.project, 'project'),
    owner_person_id: requireNonEmptyString(object.owner_person_id, 'owner_person_id'),
  };

  for (const [field, expected] of Object.entries(EXPECTED_CANONICAL_IDENTITY)) {
    if (manifest[field as keyof CanonicalTaskStoreManifest] !== expected) {
      throw new Error(`canonical Task manifest ${field} does not match the fixed canonical identity`);
    }
  }

  return manifest;
}

function loadManifest(environment: NodeJS.ProcessEnv): LoadedManifest {
  const forbiddenOverride = FORBIDDEN_IDENTITY_OVERRIDES.find(
    (name) => environment[name] !== undefined
  );
  if (forbiddenOverride) {
    throw new Error(`${forbiddenOverride} is forbidden; configure only CANONICAL_TASK_STORE_MANIFEST`);
  }

  const manifestPath = environment.CANONICAL_TASK_STORE_MANIFEST || defaultManifestPath();
  const manifest = parseManifest(JSON.parse(readFileSync(manifestPath, 'utf8')));
  const serialized = canonicalJson(manifest);

  return {
    manifest: Object.freeze(manifest),
    identityHash: createHash('sha256').update(serialized).digest('hex'),
  };
}

function initialize(environment: NodeJS.ProcessEnv): GuardInitialization {
  try {
    return { loaded: loadManifest(environment) };
  } catch (error) {
    return {
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

export class CanonicalTaskWriteGuard {
  private readonly resolver: CanonicalTaskMetadataResolver;
  private readonly initialization: GuardInitialization;
  private verification?: Promise<void>;
  private verifiedTables?: NocoDBTableIdentity[];
  private closedReason?: Error;

  constructor(
    resolver: CanonicalTaskMetadataResolver,
    environment: NodeJS.ProcessEnv = process.env
  ) {
    this.resolver = resolver;
    this.initialization = initialize(environment);
  }

  get identityHash(): string | null {
    return this.initialization.loaded?.identityHash ?? null;
  }

  async assertRecordMutationAllowed(baseId: string, tableNameOrId: string): Promise<void> {
    await this.ensureMutationReady();
    const manifest = this.manifest;

    if (baseId !== manifest.base_id) {
      return;
    }

    const normalizedTarget = tableNameOrId.trim();
    const table = this.verifiedTables?.find(
      (candidate) => candidate.id === normalizedTarget || candidate.title === normalizedTarget
    );

    if (!table) {
      this.close(
        new Error(
          `unable to resolve mutation table ${tableNameOrId} in canonical base ${baseId}`
        )
      );
    }

    if (table.id === manifest.table_id) {
      throw this.canonicalMutationDenied('record');
    }
  }

  async assertColumnMutationAllowed(columnId: string): Promise<void> {
    await this.ensureMutationReady();

    let column: NocoDBColumnIdentity;
    try {
      column = await this.resolver.getColumn(columnId);
    } catch (error) {
      this.close(
        new Error(`unable to resolve mutation column ${columnId}`, {
          cause: error,
        })
      );
    }

    const parentTableId =
      column.fk_model_id || column.model_id || column.table_id || column.fk_table_id;
    if (!parentTableId) {
      this.close(new Error(`column ${columnId} metadata has no parent table identity`));
    }

    if (parentTableId === this.manifest.table_id) {
      throw this.canonicalMutationDenied('column');
    }
  }

  private get manifest(): Readonly<CanonicalTaskStoreManifest> {
    const manifest = this.initialization.loaded?.manifest;
    if (!manifest) {
      throw this.notReady(this.initialization.error);
    }
    return manifest;
  }

  private async ensureMutationReady(): Promise<void> {
    if (this.closedReason) {
      throw this.notReady(this.closedReason);
    }
    if (this.verifiedTables) {
      return;
    }
    if (this.initialization.error) {
      this.closedReason = this.initialization.error;
      throw this.notReady(this.closedReason);
    }

    if (!this.verification) {
      this.verification = this.verifyCanonicalIdentity();
    }

    try {
      await this.verification;
    } catch (error) {
      this.closedReason = error instanceof Error ? error : new Error(String(error));
      throw this.notReady(this.closedReason);
    }
  }

  private async verifyCanonicalIdentity(): Promise<void> {
    const manifest = this.manifest;
    const tables = await this.resolver.listTables(manifest.base_id);
    if (!Array.isArray(tables)) {
      throw new Error('canonical base table metadata did not return a list');
    }

    const canonicalTable = tables.find((table) => table.id === manifest.table_id);
    if (!canonicalTable || canonicalTable.title !== manifest.table_name) {
      throw new Error(
        `canonical table metadata does not match manifest hash ${this.identityHash}`
      );
    }

    this.verifiedTables = tables.map((table) => ({ ...table }));
  }

  private close(reason: Error): never {
    this.closedReason = reason;
    throw this.notReady(reason);
  }

  private canonicalMutationDenied(target: 'record' | 'column'): CanonicalTaskWriteGuardError {
    return new CanonicalTaskWriteGuardError(
      'canonical_task_api_required',
      `Direct canonical Task ${target} mutation is forbidden. Use the authenticated Canonical Task principal/operation API route.`
    );
  }

  private notReady(reason?: Error): CanonicalTaskWriteGuardError {
    return new CanonicalTaskWriteGuardError(
      'canonical_task_mutation_not_ready',
      `NocoDB mutation is disabled because canonical Task identity cannot be verified${
        reason?.message ? `: ${reason.message}` : ''
      }`,
      reason ? { cause: reason } : undefined
    );
  }
}
