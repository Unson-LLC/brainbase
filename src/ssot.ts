import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, win32 } from 'node:path';
import { z } from 'zod';
import { validateCanonicalGraph } from './canonical-graph.js';
import { assertOntologyValid } from './ontology.js';
import { planCanonicalGraphMigration, type CanonicalGraphMigrationPlan } from './ontology-migration.js';
import { emptyGraph, emptyRelationships, schemaTemplates } from './templates.js';
import type { DecisionRecord, GraphFile, PersonalKgEntry, PersonalOs, RelationshipsFile } from './types.js';

const canonicalFiles = ['graph.json', 'relationships.json', 'personal-kg.jsonl', 'decisions.jsonl'] as const;
const lockName = '.brainbase-ssot.lock';
const stagingPrefix = '.brainbase-staging-';
const transactionPrefix = '.brainbase-transaction-';

interface LockOwner {
  token: string;
  pid: number;
  hostname: string;
}

interface TransactionMetadata {
  version: 1;
  mode: 'initialization' | 'mutation';
  sidecarFiles?: string[];
}

interface TransactionSidecar {
  relativePath: string;
  content: string;
}

const personalKgSchema: z.ZodType<PersonalKgEntry> = z.object({
  id: z.string().min(1),
  type: z.enum(['self', 'work', 'relationship', 'value', 'judgment', 'experience', 'sns_context']),
  text: z.string().min(1),
  tags: z.array(z.string()).optional(),
  source: z.string().optional(),
  updatedAt: z.string().optional()
});

const relationshipSchema = z.object({
  id: z.string().min(1),
  person: z.string().min(1),
  role: z.string().optional(),
  context: z.string().min(1),
  tags: z.array(z.string()).optional(),
  updatedAt: z.string().optional()
});

const relationshipsSchema: z.ZodType<RelationshipsFile> = z.object({
  version: z.literal(1),
  relationships: z.array(relationshipSchema)
});

const decisionSchema: z.ZodType<DecisionRecord> = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  decision: z.string().min(1),
  topic: z.string().min(1).optional(),
  supersedes: z.array(z.string().min(1)).optional(),
  effectiveAt: z.string().datetime({ offset: true }).optional(),
  rationale: z.string().optional(),
  tags: z.array(z.string()).optional(),
  updatedAt: z.string().optional()
});

export async function initializePersonalOs(dataDir: string): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  await withSsotLock(dataDir, async () => {
    await recoverTransactions(dataDir);
    const present = await canonicalPresence(dataDir);
    if (present.length === canonicalFiles.length) {
      await ensureAncillaryDirectories(dataDir);
      return;
    }
    if (present.length > 0) {
      throw new Error(`Partial canonical SSOT set in ${dataDir}: found ${present.join(', ')}`);
    }

    await ensureAncillaryDirectories(dataDir);
    await commitAggregate(dataDir, {
      dataDir,
      graph: emptyGraph,
      relationships: emptyRelationships,
      personalKg: [],
      decisions: [],
      sourceCount: 0
    }, 'initialization');
  });
}

export async function loadPersonalOs(dataDir: string): Promise<PersonalOs> {
  return withSsotLock(dataDir, async () => {
    await recoverTransactions(dataDir);
    assertCompleteCanonicalSet(dataDir, await canonicalPresence(dataDir));
    return loadPersonalOsUnlocked(dataDir);
  });
}

export async function mutatePersonalOs(
  dataDir: string,
  mutator: (current: PersonalOs) => PersonalOs | Promise<PersonalOs>
): Promise<PersonalOs> {
  return withSsotLock(dataDir, async () => {
    await recoverTransactions(dataDir);
    assertCompleteCanonicalSet(dataDir, await canonicalPresence(dataDir));
    const current = await loadPersonalOsUnlocked(dataDir);
    const next = await mutator(current);
    const normalized = { ...next, dataDir, sourceCount: current.sourceCount };
    validateAggregate(normalized);
    await commitAggregate(dataDir, normalized, 'mutation');
    return normalized;
  });
}

export async function mutatePersonalOsWithSidecar<T>(
  dataDir: string,
  sidecarPath: string,
  mutator: (current: PersonalOs) => { next: PersonalOs; sidecarContent: string; result: T } | Promise<{ next: PersonalOs; sidecarContent: string; result: T }>
): Promise<T> {
  assertSafeSidecarPath(sidecarPath);
  return withSsotLock(dataDir, async () => {
    await recoverTransactions(dataDir);
    assertCompleteCanonicalSet(dataDir, await canonicalPresence(dataDir));
    const current = await loadPersonalOsUnlocked(dataDir);
    const mutation = await mutator(current);
    const normalized = { ...mutation.next, dataDir, sourceCount: current.sourceCount };
    validateAggregate(normalized);
    await commitAggregate(dataDir, normalized, 'mutation', [{ relativePath: sidecarPath, content: mutation.sidecarContent }]);
    return mutation.result;
  });
}

export type CanonicalGraphMigrationExecution = CanonicalGraphMigrationPlan & {
  expectedInputDigest: string;
  written: boolean;
};

/**
 * Plans or atomically applies the canonical Graph migration.
 *
 * The input is always recovered, read, and planned while holding the same
 * lock used by every canonical SSOT writer. Omitting `write` is a byte-safe
 * preview; a blocked or already-current plan is never committed.
 */
export async function migrateCanonicalGraph(
  dataDir: string,
  options: { write?: boolean; expectedInputDigest?: string } = {}
): Promise<CanonicalGraphMigrationExecution> {
  return withSsotLock(dataDir, async () => {
    await recoverTransactions(dataDir);
    assertCompleteCanonicalSet(dataDir, await canonicalPresence(dataDir));
    const current = await loadPersonalOsUnlocked(dataDir);
    const plan = planCanonicalGraphMigration({
      graph: current.graph,
      relationships: current.relationships,
      decisions: current.decisions
    });
    if (options.write && options.expectedInputDigest === undefined) {
      return blockMigrationWrite(plan, {
        code: 'expected_input_digest_required',
        recordId: 'canonical-aggregate',
        detail: 'MIGRATION-EXPECTED-INPUT-DIGEST-REQUIRED: preview first and pass its inputDigest before writing'
      });
    }
    if (options.write && options.expectedInputDigest !== plan.inputDigest) {
      return blockMigrationWrite(plan, {
        code: 'input_digest_mismatch',
        recordId: 'canonical-aggregate',
        detail: `MIGRATION-INPUT-DIGEST-MISMATCH: expected ${options.expectedInputDigest}, replanned ${plan.inputDigest}`
      });
    }
    if (!options.write || plan.status !== 'migration_required') {
      return { ...plan, expectedInputDigest: plan.inputDigest, written: false };
    }

    const next = { ...current, graph: plan.graph };
    await commitAggregate(dataDir, next, 'mutation');
    return { ...plan, expectedInputDigest: plan.inputDigest, written: true };
  });
}

function blockMigrationWrite(
  plan: CanonicalGraphMigrationPlan,
  issue: CanonicalGraphMigrationPlan['issues'][number]
): CanonicalGraphMigrationExecution {
  return {
    ...plan,
    status: 'blocked',
    issues: [...plan.issues, issue].sort((left, right) => (
      `${left.recordId}\u0000${left.code}`.localeCompare(`${right.recordId}\u0000${right.code}`, 'en')
    )),
    expectedInputDigest: plan.inputDigest,
    written: false
  };
}

async function loadPersonalOsUnlocked(dataDir: string): Promise<PersonalOs> {
  const graph = parseGraph(await readJson(join(dataDir, 'graph.json')));
  const relationships = relationshipsSchema.parse(await readJson(join(dataDir, 'relationships.json')));
  const personalKg = await readJsonl(join(dataDir, 'personal-kg.jsonl'), personalKgSchema, 'personal-kg.jsonl');
  const decisions = await readJsonl(join(dataDir, 'decisions.jsonl'), decisionSchema, 'decisions.jsonl');
  const sourceCount = await countSources(dataDir);
  return { dataDir, graph, personalKg, relationships, decisions, sourceCount };
}

async function commitAggregate(
  dataDir: string,
  next: PersonalOs,
  mode: TransactionMetadata['mode'],
  sidecars: TransactionSidecar[] = []
): Promise<void> {
  validateAggregate(next);
  const id = randomUUID();
  const stagingDir = join(dataDir, `${stagingPrefix}${id}`);
  const transactionDir = join(dataDir, `${transactionPrefix}${id}`);
  const nextDir = join(stagingDir, 'next');
  const previousDir = join(stagingDir, 'previous');

  await mkdir(nextDir, { recursive: true });
  await writeAggregate(nextDir, next);
  for (const sidecar of sidecars) {
    assertSafeSidecarPath(sidecar.relativePath);
    await mkdir(dirname(join(nextDir, sidecar.relativePath)), { recursive: true });
    await writeFile(join(nextDir, sidecar.relativePath), sidecar.content, { mode: 0o600 });
  }
  if (mode === 'mutation') {
    await mkdir(previousDir, { recursive: true });
    await copyCanonicalSet(dataDir, previousDir);
    for (const sidecar of sidecars) {
      await mkdir(dirname(join(previousDir, sidecar.relativePath)), { recursive: true });
      await copyFile(join(dataDir, sidecar.relativePath), join(previousDir, sidecar.relativePath));
    }
  }
  const metadata: TransactionMetadata = { version: 1, mode, ...(sidecars.length > 0 ? { sidecarFiles: sidecars.map((item) => item.relativePath) } : {}) };
  await writeFile(join(stagingDir, 'transaction.json'), `${JSON.stringify(metadata, null, 2)}\n`);
  await writeFile(join(stagingDir, 'PREPARED'), '');
  await rename(stagingDir, transactionDir);

  try {
    await publishCanonicalSet(dataDir, join(transactionDir, 'next'), id, true, metadata.sidecarFiles ?? []);
    await writeFile(join(transactionDir, 'COMMITTED'), '');
  } catch (error) {
    await recoverTransaction(dataDir, transactionDir).catch(() => undefined);
    throw error;
  }

  await cleanupCommittedTransaction(transactionDir);
}

async function cleanupCommittedTransaction(transactionDir: string): Promise<void> {
  try {
    if (process.env.BRAINBASE_SSOT_FAIL_COMMITTED_CLEANUP === '1') {
      throw new Error('Injected committed SSOT transaction cleanup failure');
    }
    await rm(transactionDir, { recursive: true, force: true });
  } catch (error) {
    warnCleanupFailure(`committed SSOT transaction ${transactionDir}`, error);
  }
}

async function recoverTransactions(dataDir: string): Promise<void> {
  const entries = await readdir(dataDir);
  for (const entry of entries.filter((value) => value.startsWith(stagingPrefix)).sort()) {
    await rm(join(dataDir, entry), { recursive: true, force: true });
  }
  for (const entry of entries.filter((value) => value.startsWith(transactionPrefix)).sort()) {
    await recoverTransaction(dataDir, join(dataDir, entry));
  }
}

async function recoverTransaction(dataDir: string, transactionDir: string): Promise<void> {
  if (await exists(join(transactionDir, 'COMMITTED'))) {
    await rm(transactionDir, { recursive: true, force: true });
    return;
  }
  if (!(await exists(join(transactionDir, 'PREPARED')))) {
    throw new Error(`Incomplete registered SSOT transaction ${transactionDir}`);
  }
  const metadata = await readTransactionMetadata(transactionDir);
  const retainedDir = join(transactionDir, metadata.mode === 'initialization' ? 'next' : 'previous');
  assertCompleteCanonicalSet(retainedDir, await canonicalPresence(retainedDir));
  if (process.env.BRAINBASE_SSOT_FAIL_RECOVERY === '1') {
    throw new Error(`Injected SSOT transaction recovery failure for ${transactionDir}`);
  }
  await publishCanonicalSet(dataDir, retainedDir, `recovery-${randomUUID()}`, false, metadata.sidecarFiles ?? []);
  await rm(transactionDir, { recursive: true, force: true });
}

async function publishCanonicalSet(
  dataDir: string,
  retainedDir: string,
  token: string,
  allowInjectedFailure: boolean,
  sidecarFiles: string[] = []
): Promise<void> {
  let published = 0;
  const failAfter = Number.parseInt(process.env.BRAINBASE_SSOT_FAIL_AFTER_PUBLISH ?? '', 10);
  const pauseAfterPublishMs = parsePositiveInteger(process.env.BRAINBASE_SSOT_PAUSE_AFTER_PUBLISH_MS, 0);
  for (const fileName of canonicalFiles) {
    const temporary = join(dataDir, `.brainbase-${fileName}-${token}.tmp`);
    await copyFile(join(retainedDir, fileName), temporary);
    await rename(temporary, join(dataDir, fileName));
    published += 1;
    if (allowInjectedFailure && pauseAfterPublishMs > 0) {
      await delay(pauseAfterPublishMs);
    }
    if (allowInjectedFailure && Number.isFinite(failAfter) && published === failAfter) {
      throw new Error(`Injected SSOT publish failure after ${published} file(s)`);
    }
  }
  for (const relativePath of sidecarFiles) {
    assertSafeSidecarPath(relativePath);
    const target = join(dataDir, relativePath);
    await mkdir(dirname(target), { recursive: true });
    const temporary = `${target}-${token}.tmp`;
    await copyFile(join(retainedDir, relativePath), temporary);
    await rename(temporary, target);
    published += 1;
    if (allowInjectedFailure && Number.isFinite(failAfter) && published === failAfter) {
      throw new Error(`Injected SSOT publish failure after ${published} file(s)`);
    }
  }
}

async function writeAggregate(targetDir: string, os: PersonalOs): Promise<void> {
  await writeFile(join(targetDir, 'graph.json'), `${JSON.stringify(os.graph, null, 2)}\n`);
  await writeFile(join(targetDir, 'relationships.json'), `${JSON.stringify(os.relationships, null, 2)}\n`);
  await writeFile(join(targetDir, 'personal-kg.jsonl'), serializeJsonl(os.personalKg));
  await writeFile(join(targetDir, 'decisions.jsonl'), serializeJsonl(os.decisions));
}

function validateAggregate(os: PersonalOs): void {
  relationshipsSchema.parse(os.relationships);
  os.personalKg.forEach((entry) => personalKgSchema.parse(entry));
  os.decisions.forEach((decision) => decisionSchema.parse(decision));
  assertOntologyValid(os);
  validateCanonicalGraph(os.graph);
}

function parseGraph(value: unknown): GraphFile {
  try {
    validateCanonicalGraph(value);
  } catch (error) {
    // Duplicate entity IDs are a complete, readable snapshot whose ontology
    // violation must remain available to audit/inference instead of being
    // collapsed into a source-unavailable result. Writers still validate the
    // aggregate strictly before commit.
    if (!(error instanceof Error) || !error.message.startsWith('GRAPH-ENTITY-ID-UNIQUE')) {
      throw error;
    }
    validateCanonicalGraph(value, { allowDuplicateEntityIds: true });
  }
  return value as GraphFile;
}

function serializeJsonl(values: unknown[]): string {
  return values.length === 0 ? '' : `${values.map((value) => JSON.stringify(value)).join('\n')}\n`;
}

async function copyCanonicalSet(sourceDir: string, targetDir: string): Promise<void> {
  for (const fileName of canonicalFiles) {
    await copyFile(join(sourceDir, fileName), join(targetDir, fileName));
  }
}

async function ensureAncillaryDirectories(dataDir: string): Promise<void> {
  for (const relative of ['sources', 'sources/gmail', 'sources/calendar', 'sources/drive', 'sources/tasks', 'candidates', 'schemas']) {
    await mkdir(join(dataDir, relative), { recursive: true });
  }
  for (const [fileName, schema] of Object.entries(schemaTemplates)) {
    await writeFile(join(dataDir, 'schemas', fileName), `${JSON.stringify(schema, null, 2)}\n`, { flag: 'wx' }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error;
    });
  }
}

async function withSsotLock<T>(dataDir: string, operation: () => Promise<T>): Promise<T> {
  await mkdir(dataDir, { recursive: true });
  const owner = await acquireLock(dataDir);
  try {
    return await operation();
  } finally {
    await releaseLock(dataDir, owner).catch((error) => {
      warnCleanupFailure(`canonical SSOT lock ${join(dataDir, lockName)}`, error);
    });
  }
}

async function acquireLock(dataDir: string): Promise<LockOwner> {
  const lockDir = join(dataDir, lockName);
  const timeoutMs = parsePositiveInteger(process.env.BRAINBASE_SSOT_LOCK_TIMEOUT_MS, 5_000);
  const retryMs = parsePositiveInteger(process.env.BRAINBASE_SSOT_LOCK_RETRY_MS, 20);
  const deadline = Date.now() + timeoutMs;
  const owner: LockOwner = { token: randomUUID(), pid: process.pid, hostname: hostname() };

  while (true) {
    try {
      await mkdir(lockDir);
      await writeFile(join(lockDir, 'owner.json'), `${JSON.stringify(owner)}\n`, { flag: 'wx' });
      return owner;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') {
        await rm(lockDir, { recursive: true, force: true }).catch(() => undefined);
        throw error;
      }
      await quarantineDeadSameHostLock(dataDir, lockDir);
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for canonical SSOT lock ${lockDir}`);
      }
      await delay(retryMs);
    }
  }
}

async function quarantineDeadSameHostLock(dataDir: string, lockDir: string): Promise<void> {
  const current = await readLockOwner(lockDir);
  if (!current || current.hostname !== hostname() || isProcessAlive(current.pid)) return;
  const quarantine = join(dataDir, `.brainbase-ssot-lock-stale-${randomUUID()}`);
  try {
    await rename(lockDir, quarantine);
    await rm(quarantine, { recursive: true, force: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

async function releaseLock(dataDir: string, owner: LockOwner): Promise<void> {
  const lockDir = join(dataDir, lockName);
  const current = await readLockOwner(lockDir);
  if (current?.token === owner.token) {
    await rm(lockDir, { recursive: true, force: true });
  }
}

async function readLockOwner(lockDir: string): Promise<LockOwner | undefined> {
  try {
    const value = JSON.parse(await readFile(join(lockDir, 'owner.json'), 'utf8')) as Partial<LockOwner>;
    if (typeof value.token === 'string' && typeof value.pid === 'number' && typeof value.hostname === 'string') {
      return value as LockOwner;
    }
  } catch {
    // Missing or malformed owner metadata is never safe to steal.
  }
  return undefined;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

async function canonicalPresence(dataDir: string): Promise<string[]> {
  const result: string[] = [];
  for (const fileName of canonicalFiles) {
    if (await exists(join(dataDir, fileName))) result.push(fileName);
  }
  return result;
}

function assertCompleteCanonicalSet(dataDir: string, present: string[]): void {
  if (present.length !== canonicalFiles.length) {
    throw new Error(`Partial canonical SSOT set in ${dataDir}: found ${present.join(', ') || 'none'}`);
  }
}

async function readTransactionMetadata(transactionDir: string): Promise<TransactionMetadata> {
  const value = await readJson(join(transactionDir, 'transaction.json')) as Partial<TransactionMetadata>;
  if (value.version !== 1 || (value.mode !== 'initialization' && value.mode !== 'mutation')) {
    throw new Error(`Invalid registered SSOT transaction metadata in ${transactionDir}`);
  }
  if (value.sidecarFiles !== undefined && (!Array.isArray(value.sidecarFiles) || value.sidecarFiles.some((path) => typeof path !== 'string'))) {
    throw new Error(`Invalid registered SSOT transaction sidecars in ${transactionDir}`);
  }
  for (const path of value.sidecarFiles ?? []) assertSafeSidecarPath(path);
  return value as TransactionMetadata;
}

function assertSafeSidecarPath(relativePath: string): void {
  const resolvedRoot = resolve('.');
  const resolvedPath = resolve(resolvedRoot, relativePath);
  const containment = relative(resolvedRoot, resolvedPath);
  const caseFoldedPath = relativePath.toLocaleLowerCase('en-US');
  const topLevel = caseFoldedPath.split('/')[0];
  const collidesWithManagedPath = canonicalFiles.includes(caseFoldedPath as typeof canonicalFiles[number])
    || topLevel === lockName.toLocaleLowerCase('en-US')
    || topLevel.startsWith(stagingPrefix.toLocaleLowerCase('en-US'))
    || topLevel.startsWith(transactionPrefix.toLocaleLowerCase('en-US'));
  if (!relativePath
    || relativePath.includes('\\')
    || isAbsolute(relativePath)
    || win32.isAbsolute(relativePath)
    || containment === '..'
    || containment.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
    || relativePath.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
    || collidesWithManagedPath) {
    throw new Error(`Unsafe SSOT transaction sidecar path: ${relativePath}`);
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Failed to read canonical SSOT file ${filePath}: ${formatError(error)}`);
  }
}

async function readJsonl<T>(filePath: string, schema: z.ZodType<T>, label: string): Promise<T[]> {
  let content = '';
  try {
    content = await readFile(filePath, 'utf8');
  } catch (error) {
    throw new Error(`Failed to read canonical SSOT file ${filePath}: ${formatError(error)}`);
  }
  const rows = content.split('\n').map((line) => line.trim()).filter(Boolean);
  return rows.map((line, index) => {
    try {
      return schema.parse(JSON.parse(line));
    } catch (error) {
      throw new Error(`Invalid ${label} line ${index + 1}: ${formatError(error)}`);
    }
  });
}

async function countSources(dataDir: string): Promise<number> {
  return countSourceFiles(join(dataDir, 'sources'));
}

async function countSourceFiles(sourceDir: string): Promise<number> {
  try {
    const entries = await readdir(sourceDir);
    const counts = await Promise.all(entries.filter((entry) => !entry.startsWith('.')).map(async (entry) => {
      const entryPath = join(sourceDir, entry);
      const entryStat = await stat(entryPath);
      return entryStat.isDirectory() ? countSourceFiles(entryPath) : entryStat.isFile() ? 1 : 0;
    }));
    return counts.reduce((sum, count) => sum + count, 0);
  } catch {
    return 0;
  }
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function warnCleanupFailure(resource: string, error: unknown): void {
  process.emitWarning(`Failed to clean up ${resource}: ${formatError(error)}`);
}
