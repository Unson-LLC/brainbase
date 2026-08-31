import { createHash, randomUUID } from 'node:crypto';
import { link, lstat, mkdir, open, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import {
  validateJudgmentDAG,
  type JudgmentDAG,
  type JudgmentDAGRunnerType
} from './judgment-dag-core.js';
import type {
  JudgmentDAGDependencyOutput,
  JudgmentDAGJSONValue,
  JudgmentDAGNodeRunRecord,
  JudgmentDAGRunRecord,
  JudgmentDAGRunnerVersion
} from './judgment-dag-runner.js';

export const JUDGMENT_DAG_RUN_ARTIFACT_VERSION = 'judgment-dag-run-artifact.v1' as const;

export type JudgmentDAGRunArtifactId = `sha256:${string}`;

export interface SaveJudgmentDAGRunArtifactRequest {
  readonly root: string;
  readonly record: JudgmentDAGRunRecord;
}

export interface LoadJudgmentDAGRunArtifactRequest {
  readonly root: string;
  readonly artifact_id: string;
}

export interface JudgmentDAGRunArtifactReceipt {
  readonly artifact_id: JudgmentDAGRunArtifactId;
  readonly artifact_version: typeof JUDGMENT_DAG_RUN_ARTIFACT_VERSION;
  readonly run_id: string;
  readonly status: 'created' | 'existing';
}

export type JudgmentDAGArtifactErrorCode =
  | 'invalid_request'
  | 'invalid_artifact_id'
  | 'not_found'
  | 'invalid_artifact'
  | 'integrity_mismatch'
  | 'storage_io_error';

export class JudgmentDAGArtifactError extends Error {
  readonly code: JudgmentDAGArtifactErrorCode;

  constructor(code: JudgmentDAGArtifactErrorCode, message: string) {
    super(message);
    this.name = 'JudgmentDAGArtifactError';
    this.code = code;
  }
}

interface JudgmentDAGRunArtifactPayload {
  readonly artifact_version: typeof JUDGMENT_DAG_RUN_ARTIFACT_VERSION;
  readonly record: JudgmentDAGRunRecord;
}

interface JudgmentDAGRunArtifactEnvelope extends JudgmentDAGRunArtifactPayload {
  readonly artifact_id: JudgmentDAGRunArtifactId;
}

const ARTIFACT_ID_PATTERN = /^sha256:([0-9a-f]{64})$/u;
const RUN_RECORD_KEYS = ['dag', 'execution_order', 'input', 'nodes', 'run_id', 'runner_versions'];
const RUNNER_VERSION_KEYS = ['runner_type', 'version'];
const NODE_RECORD_KEYS = [
  'dependency_outputs', 'input', 'input_contract', 'node_id', 'output',
  'output_contract', 'runner_type', 'runner_version'
];
const DEPENDENCY_OUTPUT_KEYS = ['node_id', 'output'];
const ENVELOPE_KEYS = ['artifact_id', 'artifact_version', 'record'];

function compareUnicodeCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left, (character) => character.codePointAt(0) as number);
  const rightPoints = Array.from(right, (character) => character.codePointAt(0) as number);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    if (leftPoints[index] !== rightPoints[index]) return leftPoints[index] - rightPoints[index];
  }
  return leftPoints.length - rightPoints.length;
}

function artifactError(code: JudgmentDAGArtifactErrorCode, message: string): JudgmentDAGArtifactError {
  return new JudgmentDAGArtifactError(code, message);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function canonicalSnapshot(
  value: unknown,
  active: Set<object> = new Set()
): JudgmentDAGJSONValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw artifactError('invalid_request', 'artifact values must be finite JSON numbers');
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== 'object') {
    throw artifactError('invalid_request', 'artifact values must be JSON-compatible');
  }
  if (active.has(value)) throw artifactError('invalid_request', 'artifact values must not be cyclic');
  active.add(value);
  try {
    if (Array.isArray(value)) {
      const result: JudgmentDAGJSONValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!(index in value)) throw artifactError('invalid_request', 'artifact arrays must not be sparse');
        result.push(canonicalSnapshot(value[index], active));
      }
      return result;
    }
    if (!isPlainRecord(value)) throw artifactError('invalid_request', 'artifact objects must be plain records');
    const result: Record<string, JudgmentDAGJSONValue> = Object.create(null) as Record<string, JudgmentDAGJSONValue>;
    for (const key of Object.keys(value).sort(compareUnicodeCodePoints)) {
      result[key] = canonicalSnapshot(value[key], active);
    }
    return result;
  } finally {
    active.delete(value);
  }
}

function canonicalJSON(value: unknown): string {
  return JSON.stringify(canonicalSnapshot(value));
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function jsonEqual(left: unknown, right: unknown): boolean {
  return canonicalJSON(left) === canonicalJSON(right);
}

function requireString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateRunnerVersions(value: unknown): readonly JudgmentDAGRunnerVersion[] {
  if (!Array.isArray(value)) throw artifactError('invalid_request', 'record.runner_versions must be an array');
  const seen = new Set<string>();
  const result = value.map((candidate) => {
    if (!isPlainRecord(candidate) || !hasExactKeys(candidate, RUNNER_VERSION_KEYS) ||
        !requireString(candidate.runner_type) || !requireString(candidate.version) ||
        seen.has(candidate.runner_type)) {
      throw artifactError('invalid_request', 'record.runner_versions is invalid');
    }
    seen.add(candidate.runner_type);
    return {
      runner_type: candidate.runner_type as JudgmentDAGRunnerType,
      version: candidate.version
    };
  });
  const sorted = [...result].sort((left, right) => left.runner_type.localeCompare(right.runner_type));
  if (!jsonEqual(result, sorted)) throw artifactError('invalid_request', 'record.runner_versions must be sorted');
  return result;
}

function validateDependencyOutputs(value: unknown): readonly JudgmentDAGDependencyOutput[] {
  if (!Array.isArray(value)) throw artifactError('invalid_request', 'node dependency outputs must be an array');
  return value.map((candidate) => {
    if (!isPlainRecord(candidate) || !hasExactKeys(candidate, DEPENDENCY_OUTPUT_KEYS) ||
        !requireString(candidate.node_id)) {
      throw artifactError('invalid_request', 'node dependency output is invalid');
    }
    return {
      node_id: candidate.node_id,
      output: canonicalSnapshot(candidate.output)
    };
  });
}

function validateRunRecord(value: unknown): JudgmentDAGRunRecord {
  if (!isPlainRecord(value) || !hasExactKeys(value, RUN_RECORD_KEYS) || !requireString(value.run_id)) {
    throw artifactError('invalid_request', 'run artifact record shape is invalid');
  }

  const dag = canonicalSnapshot(value.dag) as unknown as JudgmentDAG;
  let validation;
  try {
    validation = validateJudgmentDAG(dag);
  } catch {
    throw artifactError('invalid_request', 'run artifact DAG is invalid');
  }
  const input = canonicalSnapshot(value.input);
  if (!Array.isArray(value.execution_order) ||
      value.execution_order.some((nodeId) => !requireString(nodeId)) ||
      !jsonEqual(value.execution_order, validation.execution_order)) {
    throw artifactError('invalid_request', 'record.execution_order does not match the DAG');
  }
  const runnerVersions = validateRunnerVersions(value.runner_versions);
  const expectedRunnerTypes = [...new Set(dag.nodes.map((node) => node.runner_type))]
    .sort((left, right) => left.localeCompare(right));
  if (!jsonEqual(runnerVersions.map((entry) => entry.runner_type), expectedRunnerTypes)) {
    throw artifactError('invalid_request', 'record.runner_versions must exactly match the DAG runner types');
  }
  const versionByRunner = new Map(runnerVersions.map((entry) => [entry.runner_type, entry.version]));
  if (!Array.isArray(value.nodes) || value.nodes.length !== validation.execution_order.length) {
    throw artifactError('invalid_request', 'record.nodes does not match the execution order');
  }
  const dagNodeById = new Map(dag.nodes.map((node) => [node.id, node]));
  const outputByNode = new Map<string, JudgmentDAGJSONValue>();
  const nodes: JudgmentDAGNodeRunRecord[] = [];

  for (let index = 0; index < value.nodes.length; index += 1) {
    const candidate = value.nodes[index];
    const expectedId = validation.execution_order[index];
    const dagNode = dagNodeById.get(expectedId);
    if (!isPlainRecord(candidate) || !hasExactKeys(candidate, NODE_RECORD_KEYS) || dagNode === undefined ||
        candidate.node_id !== expectedId || candidate.runner_type !== dagNode.runner_type ||
        candidate.input_contract !== dagNode.input_contract || candidate.output_contract !== dagNode.output_contract ||
        candidate.runner_version !== versionByRunner.get(dagNode.runner_type) ||
        !jsonEqual(candidate.input, input)) {
      throw artifactError('invalid_request', 'record node does not match the DAG and runner versions');
    }
    const dependencyOutputs = validateDependencyOutputs(candidate.dependency_outputs);
    const expectedDependencies = dagNode.depends_on.slice().sort().map((nodeId) => ({
      node_id: nodeId,
      output: outputByNode.get(nodeId)
    }));
    if (expectedDependencies.some((entry) => entry.output === undefined) ||
        !jsonEqual(dependencyOutputs, expectedDependencies)) {
      throw artifactError('invalid_request', 'record dependency outputs do not match prior node outputs');
    }
    const output = canonicalSnapshot(candidate.output);
    outputByNode.set(expectedId, output);
    nodes.push({
      node_id: expectedId,
      runner_type: dagNode.runner_type,
      runner_version: candidate.runner_version as string,
      input_contract: dagNode.input_contract,
      output_contract: dagNode.output_contract,
      input,
      dependency_outputs: dependencyOutputs,
      output
    });
  }

  return deepFreeze({
    run_id: value.run_id,
    dag,
    input,
    execution_order: [...validation.execution_order],
    runner_versions: runnerVersions,
    nodes
  });
}

function requireRoot(value: unknown): string {
  if (!requireString(value) || value.includes('\0')) {
    throw artifactError('invalid_request', 'artifact root must be a non-empty filesystem path');
  }
  return path.resolve(value);
}

function payloadFor(record: JudgmentDAGRunRecord): JudgmentDAGRunArtifactPayload {
  return { artifact_version: JUDGMENT_DAG_RUN_ARTIFACT_VERSION, record };
}

function artifactIdFor(payload: JudgmentDAGRunArtifactPayload): JudgmentDAGRunArtifactId {
  return `sha256:${createHash('sha256').update(canonicalJSON(payload), 'utf8').digest('hex')}`;
}

function locator(root: string, artifactId: string): string {
  if (typeof artifactId !== 'string') {
    throw artifactError('invalid_artifact_id', 'artifact_id must be sha256:<64 lowercase hex>');
  }
  const match = ARTIFACT_ID_PATTERN.exec(artifactId);
  if (match === null) throw artifactError('invalid_artifact_id', 'artifact_id must be sha256:<64 lowercase hex>');
  return path.join(root, 'artifacts', `${match[1]}.json`);
}

async function assertArtifactDirectory(root: string): Promise<string> {
  const directory = path.join(root, 'artifacts');
  let rootDetails;
  try {
    rootDetails = await lstat(root);
  } catch {
    throw artifactError('invalid_request', 'artifact root must be an existing regular directory');
  }
  if (!rootDetails.isDirectory() || rootDetails.isSymbolicLink()) {
    throw artifactError('invalid_request', 'artifact root must be an existing regular directory');
  }
  let details;
  try {
    details = await lstat(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw artifactError('storage_io_error', 'artifact directory metadata could not be read');
    }
    try {
      await mkdir(directory, { mode: 0o700 });
    } catch (mkdirError) {
      if ((mkdirError as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw artifactError('storage_io_error', 'artifact directory could not be prepared');
      }
    }
    details = await lstat(directory);
  }
  if (!details.isDirectory() || details.isSymbolicLink()) {
    throw artifactError('invalid_artifact', 'artifact directory must be a regular directory');
  }
  return directory;
}

async function requireArtifactDirectory(root: string): Promise<void> {
  const rootDetails = await lstat(root).catch(() => undefined);
  if (rootDetails === undefined || !rootDetails.isDirectory() || rootDetails.isSymbolicLink()) {
    throw artifactError('invalid_request', 'artifact root must be an existing regular directory');
  }
  const details = await lstat(path.join(root, 'artifacts')).catch(() => undefined);
  if (details === undefined) throw artifactError('not_found', 'run artifact was not found');
  if (!details.isDirectory() || details.isSymbolicLink()) {
    throw artifactError('invalid_artifact', 'artifact directory must be a regular directory');
  }
}

async function readRegularArtifact(file: string): Promise<string> {
  let details;
  try {
    details = await lstat(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw artifactError('not_found', 'run artifact was not found');
    throw artifactError('storage_io_error', 'run artifact metadata could not be read');
  }
  if (!details.isFile() || details.isSymbolicLink()) {
    throw artifactError('invalid_artifact', 'run artifact must be a regular file');
  }
  try {
    return await readFile(file, 'utf8');
  } catch {
    throw artifactError('storage_io_error', 'run artifact bytes could not be read');
  }
}

function receipt(
  artifactId: JudgmentDAGRunArtifactId,
  record: JudgmentDAGRunRecord,
  status: JudgmentDAGRunArtifactReceipt['status']
): JudgmentDAGRunArtifactReceipt {
  return deepFreeze({
    artifact_id: artifactId,
    artifact_version: JUDGMENT_DAG_RUN_ARTIFACT_VERSION,
    run_id: record.run_id,
    status
  });
}

export async function saveJudgmentDAGRunArtifact(
  request: SaveJudgmentDAGRunArtifactRequest
): Promise<JudgmentDAGRunArtifactReceipt> {
  if (!isPlainRecord(request)) throw artifactError('invalid_request', 'save request must be a plain object');
  const root = requireRoot(request.root);
  const record = validateRunRecord(request.record);
  const payload = payloadFor(record);
  const artifactId = artifactIdFor(payload);
  const envelope: JudgmentDAGRunArtifactEnvelope = {
    artifact_id: artifactId,
    artifact_version: JUDGMENT_DAG_RUN_ARTIFACT_VERSION,
    record
  };
  const bytes = `${canonicalJSON(envelope)}\n`;
  let directory: string;
  try {
    directory = await assertArtifactDirectory(root);
  } catch (error) {
    if (error instanceof JudgmentDAGArtifactError) throw error;
    throw artifactError('storage_io_error', 'artifact directory could not be prepared');
  }
  const file = locator(root, artifactId);
  try {
    const existing = await readRegularArtifact(file);
    if (existing !== bytes) throw artifactError('integrity_mismatch', 'existing artifact bytes do not match their content address');
    return receipt(artifactId, record, 'existing');
  } catch (error) {
    if (!(error instanceof JudgmentDAGArtifactError) || error.code !== 'not_found') throw error;
  }

  const temporary = path.join(directory, `.tmp-${process.pid}-${randomUUID()}`);
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(bytes, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    try {
      await link(temporary, file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const existing = await readRegularArtifact(file);
      if (existing !== bytes) throw artifactError('integrity_mismatch', 'existing artifact bytes do not match their content address');
      return receipt(artifactId, record, 'existing');
    }
    return receipt(artifactId, record, 'created');
  } catch (error) {
    if (error instanceof JudgmentDAGArtifactError) throw error;
    throw artifactError('storage_io_error', 'run artifact could not be saved');
  } finally {
    if (handle !== undefined) await handle.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
  }
}

export async function loadJudgmentDAGRunArtifact(
  request: LoadJudgmentDAGRunArtifactRequest
): Promise<JudgmentDAGRunRecord> {
  if (!isPlainRecord(request)) throw artifactError('invalid_request', 'load request must be a plain object');
  const root = requireRoot(request.root);
  const file = locator(root, request.artifact_id);
  await requireArtifactDirectory(root);
  const bytes = await readRegularArtifact(file);
  if (!bytes.endsWith('\n')) throw artifactError('integrity_mismatch', 'stored artifact bytes are not canonical');
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.slice(0, -1));
  } catch {
    throw artifactError('integrity_mismatch', 'stored artifact bytes are not complete JSON');
  }
  if (!isPlainRecord(parsed) || !hasExactKeys(parsed, ENVELOPE_KEYS) ||
      parsed.artifact_version !== JUDGMENT_DAG_RUN_ARTIFACT_VERSION ||
      typeof parsed.artifact_id !== 'string') {
    throw artifactError('invalid_artifact', 'stored artifact envelope is invalid');
  }
  let record: JudgmentDAGRunRecord;
  try {
    record = validateRunRecord(parsed.record);
  } catch {
    throw artifactError('invalid_artifact', 'stored run record is invalid');
  }
  const payload = payloadFor(record);
  const computedId = artifactIdFor(payload);
  if (computedId !== request.artifact_id || parsed.artifact_id !== request.artifact_id) {
    throw artifactError('integrity_mismatch', 'stored artifact identity does not match its content');
  }
  const canonicalBytes = `${canonicalJSON({
    artifact_id: computedId,
    artifact_version: JUDGMENT_DAG_RUN_ARTIFACT_VERSION,
    record
  })}\n`;
  if (bytes !== canonicalBytes) throw artifactError('integrity_mismatch', 'stored artifact bytes are not canonical');
  return record;
}
