#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CONTRACT_ARTIFACT_NAMES = ['schema', 'fixture', 'sourceLock', 'digest'];

function run(command, args, cwd, environment) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  if (result.error || result.status !== 0) {
    throw new Error([
      result.error?.message ?? `Command failed: ${command} ${args.join(' ')} (exit ${result.status ?? 'unknown'})`,
      result.stdout,
      result.stderr
    ].filter(Boolean).join('\n'));
  }
  return result.stdout.trim();
}

function credentialFreeEnvironment(environment) {
  const allowedNames = [
    'LANG', 'LC_ALL', 'LC_CTYPE',
    'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT'
  ];
  return Object.fromEntries(allowedNames.flatMap((name) => (
    typeof environment[name] === 'string' && environment[name] !== '' ? [[name, environment[name]]] : []
  )));
}

function assertIncludes(output, expected, command) {
  if (!output.includes(expected)) throw new Error(`${command} did not include ${JSON.stringify(expected)}`);
}

function consumerProbeSource() {
  return `import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  JudgmentDAGValidationError,
  validateJudgmentDAG
} from '@unson/brainbase-mcp/judgment-dag';

const legacyOntology = await import('@unson/brainbase-mcp/dist/ontology.js');
if (Object.keys(legacyOntology).length === 0) {
  throw new Error('legacy dist/ontology.js deep import returned no exports');
}
const contractArtifactPaths = {
  schema: '@unson/brainbase-mcp/contracts/judgment-dag/schema.json',
  fixture: '@unson/brainbase-mcp/contracts/judgment-dag/fixture.json',
  sourceLock: '@unson/brainbase-mcp/contracts/judgment-dag/source-lock.json',
  digest: '@unson/brainbase-mcp/contracts/judgment-dag/digest.json'
};
const contractArtifacts = {};
const artifactContents = {};
for (const [name, packagePath] of Object.entries(contractArtifactPaths)) {
  const resolved = await import.meta.resolve(packagePath);
  const contents = await readFile(new URL(resolved), 'utf8');
  artifactContents[name] = JSON.parse(contents);
  contractArtifacts[name] = { packagePath, resolved, bytes: Buffer.byteLength(contents) };
}

const sourceLockPath = fileURLToPath(contractArtifacts.sourceLock.resolved);
const packageRoot = path.resolve(path.dirname(sourceLockPath), '../..');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const snapshot = (value) => JSON.stringify(value, (key, entry) => (
  entry === undefined ? '__undefined__' : entry
));
function packageRelativeFile(relativePath) {
  const windowsAbsolute = typeof relativePath === 'string' && relativePath.length >= 3 &&
    relativePath[1] === ':' && (relativePath[2] === '/' || relativePath.charCodeAt(2) === 92);
  if (typeof relativePath !== 'string' || relativePath.length === 0 || path.isAbsolute(relativePath) ||
      windowsAbsolute || relativePath.indexOf(String.fromCharCode(92)) !== -1 ||
      relativePath.split('/').includes('..')) {
    throw new Error('contract hash path is not a package-relative file: ' + String(relativePath));
  }
  const resolved = path.resolve(packageRoot, relativePath);
  const packageBoundary = packageRoot + path.sep;
  if (resolved !== packageRoot && !resolved.startsWith(packageBoundary)) {
    throw new Error('contract hash path escapes the package root: ' + relativePath);
  }
  return resolved;
}
async function verifyFileHash(file) {
  const actual = sha256(await readFile(packageRelativeFile(file.path)));
  if (actual !== file.sha256) {
    throw new Error('contract hash mismatch for ' + file.path);
  }
}
const sourceLock = artifactContents.sourceLock;
if (sourceLock.repository !== 'https://github.com/Unson-LLC/brainbase' ||
    !/^[0-9a-f]{40}$/.test(sourceLock.accepted_base_commit)) {
  throw new Error('source-lock immutable source identity is incomplete');
}
if (!Array.isArray(sourceLock.sources) ||
    new Set(sourceLock.sources.map((source) => source.path)).size !== sourceLock.sources.length) {
  throw new Error('source-lock contains duplicate or invalid source paths');
}
for (const source of sourceLock.sources) await verifyFileHash(source);

const digest = artifactContents.digest;
if (!Array.isArray(digest.files)) throw new Error('digest does not contain file hashes');
const digestPaths = digest.files.map((file) => file.path);
if (new Set(digestPaths).size !== digestPaths.length ||
    JSON.stringify(digestPaths) !== JSON.stringify([...digestPaths].sort((left, right) => left.localeCompare(right)))) {
  throw new Error('digest file paths are not unique and canonically ordered');
}
for (const file of digest.files) await verifyFileHash(file);
const canonicalDigest = digest.files.map((file) => (
  file.path + String.fromCharCode(0) + file.sha256 + String.fromCharCode(10)
)).join('');
if (sha256(canonicalDigest) !== digest.digest) {
  throw new Error('digest aggregate does not match its canonical file hashes');
}

const fixture = artifactContents.fixture;
const expectedExecutionOrder = [
  'context.account', 'context.customer', 'judgment.fit', 'resource.scope',
  'execution.proposal', 'execution.outcome', 'evaluation.result'
];
function cloneFixture() {
  return structuredClone(fixture);
}
function expectValidationCode(label, candidate, expectedCode) {
  const before = snapshot(candidate);
  let error;
  try {
    validateJudgmentDAG(candidate);
  } catch (caught) {
    error = caught;
  }
  if (!(error instanceof JudgmentDAGValidationError) || error.code !== expectedCode) {
    throw new Error(label + ' returned ' + (error?.code ?? 'no error') + ', expected ' + expectedCode);
  }
  if (snapshot(candidate) !== before) throw new Error(label + ' mutated its input');
  return error.code;
}
const fixtureBefore = snapshot(fixture);
const fixtureResult = validateJudgmentDAG(fixture);
if (JSON.stringify(fixtureResult.execution_order) !== JSON.stringify(expectedExecutionOrder)) {
  throw new Error('canonical fixture execution order was not read back');
}
if (snapshot(fixture) !== fixtureBefore) throw new Error('valid fixture validation mutated its input');
const reorderedFixture = cloneFixture();
reorderedFixture.nodes.reverse();
reorderedFixture.edges.reverse();
if (JSON.stringify(validateJudgmentDAG(reorderedFixture).execution_order) !== JSON.stringify(expectedExecutionOrder)) {
  throw new Error('canonical fixture execution order is not stable under input ordering');
}
const missingDependency = cloneFixture();
missingDependency.nodes.find((node) => node.id === 'judgment.fit').depends_on = ['context.missing'];
const missingDependencyCode = expectValidationCode('missing dependency', missingDependency, 'missing_dependency');
const cycle = cloneFixture();
cycle.nodes.find((node) => node.id === 'context.account').depends_on = ['context.customer'];
cycle.nodes.find((node) => node.id === 'context.customer').depends_on = ['context.account'];
cycle.edges.push(
  { from: 'context.account', to: 'context.customer', relation: 'depends_on' },
  { from: 'context.customer', to: 'context.account', relation: 'depends_on' }
);
const cycleCode = expectValidationCode('cycle', cycle, 'cycle');
const mirrorMismatch = cloneFixture();
mirrorMismatch.edges.shift();
const mirrorMismatchCode = expectValidationCode('depends_on mirror mismatch', mirrorMismatch, 'invalid_contract');
const scopeBoundary = cloneFixture();
scopeBoundary.nodes.find((node) => node.id === 'context.customer').scope = {
  type: 'project', id: 'project-outside-j0-fixture'
};
const scopeBoundaryCode = expectValidationCode(
  'scope boundary', scopeBoundary, 'scope_boundary_violation'
);
const invalidMetadata = cloneFixture();
invalidMetadata.nodes.find((node) => node.id === 'context.account').authority = {
  owner: { displayName: undefined }
};
const invalidMetadataCode = expectValidationCode('invalid recursive metadata', invalidMetadata, 'invalid_contract');

const [serverEntrypoint, dataDir] = process.argv.slice(2);
for (const forbiddenName of ['NODE_OPTIONS', 'NODE_PATH', 'HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY']) {
  if (process.env[forbiddenName]) throw new Error(\`consumer environment leaked \${forbiddenName}\`);
}
if (process.env.NPM_CONFIG_REGISTRY !== 'https://registry.npmjs.org/') {
  throw new Error('consumer environment did not force the public npm registry');
}
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverEntrypoint],
  env: { ...process.env, BRAINBASE_PERSONAL_OS_DIR: dataDir },
  stderr: 'pipe'
});
const client = new Client({ name: 'brainbase-release-consumer-smoke', version: '1.0.0' });
try {
  await client.connect(transport);
  const result = await client.listTools();
  if (!Array.isArray(result.tools) || result.tools.length === 0) {
    throw new Error('tools/list returned no tools');
  }
  const contextResult = await client.callTool({ name: 'get_context', arguments: { dataDir } });
  if (contextResult.isError) throw new Error('get_context returned an MCP tool error');
  const contextText = contextResult.content
    .filter((item) => item.type === 'text')
    .map((item) => item.text)
    .join('');
  const context = JSON.parse(contextText);
  const projectReadback = context.projects?.some((project) => project.name === 'Atlas');
  const relationshipReadback = context.relationships?.some((relationship) => relationship.person === '田中');
  const decisionReadback = context.decisions?.some((decision) => decision.decision === '正規エンティティ同士をIDで接続する');
  if (!projectReadback || !relationshipReadback || !decisionReadback) {
    throw new Error('get_context did not read back the seeded Atlas, 田中, and decision principle facts');
  }
  process.stdout.write(JSON.stringify({
    toolCount: result.tools.length,
    toolNames: result.tools.map((tool) => tool.name),
    contextReadback: { project: 'Atlas', relationship: '田中', decisionPrinciple: '正規エンティティ同士をIDで接続する' },
    legacyDeepImport: 'passed',
    contractArtifacts: Object.fromEntries(Object.keys(contractArtifacts).map((name) => [name, 'passed'])),
    judgmentDag: {
      contractVerification: {
        sourceLockSources: sourceLock.sources.length,
        digestFiles: digest.files.length,
        aggregateDigest: digest.digest
      },
      executionOrder: fixtureResult.execution_order,
      negativeBoundaries: {
        missing_dependency: { status: 'passed', errorCode: missingDependencyCode },
        cycle: { status: 'passed', errorCode: cycleCode },
        mirror_mismatch: { status: 'passed', errorCode: mirrorMismatchCode },
        scope_boundary_violation: { status: 'passed', errorCode: scopeBoundaryCode },
        invalid_contract: { status: 'passed', errorCode: invalidMetadataCode }
      }
    }
  }));
} finally {
  await client.close();
}
`;
}

function packageBinTarget(manifest, installedPackageRoot, name) {
  const target = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[name];
  if (typeof target !== 'string') throw new Error(`installed Brainbase package does not define the ${name} bin`);
  const resolved = path.resolve(installedPackageRoot, target);
  const packageBoundary = `${path.resolve(installedPackageRoot)}${path.sep}`;
  if (!resolved.startsWith(packageBoundary)) throw new Error(`installed Brainbase ${name} bin escapes the package root`);
  return { resolved, target: target.replaceAll('\\', '/') };
}

function isolatedConsumerEnvironment(environment, consumerRoot) {
  const systemPaths = process.platform === 'win32'
    ? [path.dirname(process.execPath), path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32')]
    : [path.dirname(process.execPath), '/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', '/bin'];
  return {
    ...credentialFreeEnvironment(environment),
    HOME: consumerRoot,
    USERPROFILE: consumerRoot,
    TMPDIR: path.join(consumerRoot, 'tmp'),
    TEMP: path.join(consumerRoot, 'tmp'),
    TMP: path.join(consumerRoot, 'tmp'),
    PATH: [path.join(consumerRoot, 'node_modules', '.bin'), ...systemPaths].join(path.delimiter),
    NPM_CONFIG_USERCONFIG: path.join(consumerRoot, 'user-npmrc'),
    NPM_CONFIG_GLOBALCONFIG: path.join(consumerRoot, 'global-npmrc'),
    NPM_CONFIG_CACHE: path.join(consumerRoot, 'npm-cache'),
    NPM_CONFIG_REGISTRY: 'https://registry.npmjs.org/'
  };
}

function resolveNpmEntrypoint(environment) {
  const executableDirectory = path.dirname(process.execPath);
  const launcherCandidates = [
    environment.npm_execpath,
    path.join(executableDirectory, 'npm'),
    path.join(executableDirectory, 'npm.cmd'),
    ...(process.platform === 'win32'
      ? [path.join(executableDirectory, 'node_modules', 'npm', 'bin', 'npm-cli.js')]
      : ['/usr/local/bin/npm', '/opt/homebrew/bin/npm', '/usr/bin/npm'])
  ].filter((candidate) => typeof candidate === 'string' && path.isAbsolute(candidate));
  const cliCandidates = launcherCandidates.flatMap((launcher) => {
    const resolved = existsSync(launcher) ? realpathSync(launcher) : launcher;
    return [
      resolved,
      path.join(path.dirname(launcher), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
      path.resolve(path.dirname(launcher), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')
    ];
  });
  const npmEntrypoint = cliCandidates.find((candidate) => (
    path.basename(candidate).toLowerCase() === 'npm-cli.js' && existsSync(candidate)
  ));
  if (!npmEntrypoint) {
    throw new Error('consumer smoke could not resolve npm-cli.js from Node or the system npm installation');
  }
  return npmEntrypoint;
}

function installTarball(tarballPath, consumerRoot, environment) {
  const npmEntrypoint = resolveNpmEntrypoint(environment);
  run(process.execPath, [
    npmEntrypoint,
    'install', '--ignore-scripts', '--no-audit', '--no-fund', tarballPath
  ], consumerRoot, environment);
}

export async function runConsumerSmoke(tarballPath, options = {}) {
  const absoluteTarball = path.resolve(tarballPath);
  const consumerRoot = await mkdtemp(path.join(tmpdir(), 'brainbase-npm-consumer-'));
  try {
    const npmUserConfig = path.join(consumerRoot, 'user-npmrc');
    const npmGlobalConfig = path.join(consumerRoot, 'global-npmrc');
    await mkdir(path.join(consumerRoot, 'tmp'));
    await writeFile(npmUserConfig, '');
    await writeFile(npmGlobalConfig, '');
    const environment = isolatedConsumerEnvironment(options.environment ?? process.env, consumerRoot);
    await writeFile(path.join(consumerRoot, 'package.json'), `${JSON.stringify({
      name: 'brainbase-release-consumer-smoke',
      version: '1.0.0',
      private: true,
      type: 'module'
    }, null, 2)}\n`);
    installTarball(absoluteTarball, consumerRoot, environment);

    const installedPackageRoot = path.join(consumerRoot, 'node_modules/@unson/brainbase-mcp');
    const manifest = JSON.parse(await readFile(path.join(installedPackageRoot, 'package.json'), 'utf8'));
    await access(path.join(installedPackageRoot, 'dist'));
    await access(path.join(installedPackageRoot, 'dist/judgment-dag.js'));
    await access(path.join(installedPackageRoot, 'dist/judgment-dag.d.ts'));
    await access(path.join(installedPackageRoot, 'contracts/judgment-dag/schema.json'));
    await access(path.join(installedPackageRoot, 'src')).then(
      () => { throw new Error('installed Brainbase package unexpectedly contains repository source files'); },
      () => undefined
    );
    const brainbase = packageBinTarget(manifest, installedPackageRoot, 'brainbase');
    const brainbaseMcp = packageBinTarget(manifest, installedPackageRoot, 'brainbase-mcp');
    const dataDir = path.join(consumerRoot, 'personal-os');

    const help = run(process.execPath, [brainbase.resolved, '--help'], consumerRoot, environment);
    assertIncludes(help, 'brainbase onboard:start', 'brainbase --help');
    const start = run(process.execPath, [brainbase.resolved, 'onboard:start', '--target', 'codex', '--dir', dataDir, '--format', 'json'], consumerRoot, environment);
    const startResult = JSON.parse(start);
    if (!startResult.initialized) throw new Error('brainbase onboard:start did not initialize the consumer data directory');
    const seed = run(process.execPath, [brainbase.resolved,
      'onboard:seed', '--dir', dataDir,
      '--name', 'Release Consumer',
      '--value', '正規Graphを先に確認する',
      '--project', 'Atlas',
      '--decision-principle', '正規エンティティ同士をIDで接続する',
      '--relationship', '田中|最終判断者|Atlas導入の判断を担当'
    ], consumerRoot, environment);
    assertIncludes(seed, 'Brainbaseへ保存しました', 'brainbase onboard:seed');
    const doctor = JSON.parse(run(process.execPath, [brainbase.resolved, 'doctor', '--dir', dataDir], consumerRoot, environment));
    if (doctor.localBackend?.connected !== true || doctor.valueDemo?.ready !== true) {
      throw new Error('brainbase doctor did not report the seeded consumer data as ready');
    }

    const probePath = path.join(consumerRoot, 'mcp-tools-list.mjs');
    await writeFile(probePath, consumerProbeSource());
    const mcp = JSON.parse(run(process.execPath, [probePath, brainbaseMcp.resolved, dataDir], consumerRoot, environment));
    if (!mcp.toolNames.includes('get_context')) throw new Error('brainbase-mcp tools/list omitted get_context');
    if (!mcp.contextReadback) throw new Error('brainbase-mcp get_context readback was not verified');
    if (mcp.legacyDeepImport !== 'passed') throw new Error('legacy dist/ontology.js deep import was not verified');
    if (!CONTRACT_ARTIFACT_NAMES.every((name) => mcp.contractArtifacts?.[name] === 'passed')) {
      throw new Error('all Judgment DAG contract artifacts were not read through package subpaths');
    }

    return {
      packageName: manifest.name,
      version: manifest.version,
      consumerRoot,
      cli: { help: 'passed', start: 'passed', seed: 'passed', doctor: 'passed' },
      mcp: { toolsList: 'passed', contextReadback: 'passed', toolCount: mcp.toolCount },
      judgmentDag: {
        subpathImport: 'passed',
        legacyDeepImport: mcp.legacyDeepImport,
        contractArtifacts: Object.fromEntries(CONTRACT_ARTIFACT_NAMES.map((name) => [name, mcp.contractArtifacts[name]])),
        ...mcp.judgmentDag
      },
      runtime: { command: process.execPath, cliTarget: brainbase.target, mcpTarget: brainbaseMcp.target }
    };
  } finally {
    await rm(consumerRoot, { recursive: true, force: true });
  }
}

function isDirectInvocation() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isDirectInvocation()) {
  const tarballPath = process.argv[2];
  if (!tarballPath) {
    console.error('Usage: npm-consumer-smoke.mjs <release-tarball.tgz>');
    process.exitCode = 1;
  } else {
    runConsumerSmoke(tarballPath)
      .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
      .catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      });
  }
}
