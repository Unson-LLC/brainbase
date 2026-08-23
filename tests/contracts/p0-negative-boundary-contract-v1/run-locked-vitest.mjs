import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rm, symlink } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const runnerDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(runnerDir, '../../..');
const contractPath = resolve(repoRoot, '.vibepro/spec/story-p0-negative-boundary-contract-v1/locked-runner.json');

const sha256 = value => createHash('sha256').update(value).digest('hex');
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
const isWithin = (parent, child) => {
  const candidate = relative(parent, child);
  return candidate !== '' && candidate !== '..' && !candidate.startsWith(`..${sep}`) && !isAbsolute(candidate);
};

const reject = message => { throw new Error(`runner-lock: ${message}`); };
const assertEqual = (actual, expected, label) => {
  if (actual !== expected) reject(`${label} mismatch`);
};

export const assertLockedRunnerDescriptor = descriptor => {
  if (!descriptor || typeof descriptor !== 'object') reject('descriptor is required');
  const { contract } = descriptor;
  if (!contract || typeof contract !== 'object') reject('contract is required');
  if (!Array.isArray(descriptor.command) || descriptor.command.length < 3) reject('command is invalid');
  if (descriptor.command.some(value => /(^|\/)(?:npx|npm|pnpx)(?:$|\/)/i.test(value))) reject('package runner is forbidden');
  if (/(?:^|\/)(?:\.npm|_npx|cache|tmp|var\/folders)(?:\/|$)/i.test(descriptor.install_root)) reject('cache or temporary install root is forbidden');
  assertEqual(descriptor.network_acquisition, false, 'network acquisition');
  assertEqual(contract.network_acquisition, false, 'contract network acquisition');
  assertEqual(descriptor.node_modules_root, resolve(descriptor.install_root, 'node_modules'), 'node_modules root');
  for (const [label, path] of [
    ['runner path', descriptor.runner_path],
    ['runner bin path', descriptor.runner_bin_path],
    ['AJV path', descriptor.ajv_path]
  ]) {
    if (!isWithin(descriptor.node_modules_root, path)) reject(`${label} is outside the locked install`);
  }
  assertEqual(descriptor.command[1], descriptor.runner_path, 'command runner path');
  assertEqual(descriptor.command[2], 'run', 'runner action');
  assertEqual(descriptor.runner_bin_path, descriptor.runner_path, 'runner binary resolution');
  assertEqual(descriptor.package_lock_sha256, contract.package_lock_sha256, 'current package-lock digest');
  assertEqual(descriptor.installed_package_lock_sha256, contract.package_lock_sha256, 'installed package-lock digest');
  for (const [actual, expected, label] of [
    [descriptor.runner_version, contract.runner.version, 'runner version'],
    [descriptor.runner_lock_version, contract.runner.version, 'runner lock version'],
    [descriptor.runner_lock_integrity, contract.runner.lock_integrity, 'runner lock integrity'],
    [descriptor.runner_package_sha256, contract.runner.package_sha256, 'runner package digest'],
    [descriptor.runner_entrypoint_sha256, contract.runner.entrypoint_sha256, 'runner entrypoint digest'],
    [descriptor.ajv_version, contract.schema_validator.version, 'AJV version'],
    [descriptor.ajv_lock_version, contract.schema_validator.version, 'AJV lock version'],
    [descriptor.ajv_lock_integrity, contract.schema_validator.lock_integrity, 'AJV lock integrity'],
    [descriptor.ajv_package_sha256, contract.schema_validator.package_sha256, 'AJV package digest'],
    [descriptor.ajv_entrypoint_sha256, contract.schema_validator.entrypoint_sha256, 'AJV entrypoint digest']
  ]) assertEqual(actual, expected, label);
  assertEqual(descriptor.runner_path, resolve(descriptor.install_root, contract.runner.entrypoint), 'runner contract path');
  assertEqual(descriptor.ajv_path, resolve(descriptor.install_root, contract.schema_validator.entrypoint), 'AJV contract path');
  return descriptor;
};

export const resolveLockedRunner = async installRootInput => {
  if (!installRootInput) throw new Error('runner-lock: P0_LOCK_INSTALL_ROOT is required');
  const installRoot = await realpath(resolve(installRootInput));
  const currentLockBytes = await readFile(resolve(repoRoot, 'package-lock.json'));
  const installedLockBytes = await readFile(resolve(installRoot, 'package-lock.json'));
  const currentLock = JSON.parse(currentLockBytes);
  const installedLock = JSON.parse(installedLockBytes);
  const contract = await readJson(contractPath);
  const runnerPackagePath = resolve(installRoot, 'node_modules/vitest/package.json');
  const runnerEntrypointPath = await realpath(resolve(installRoot, contract.runner.entrypoint));
  const runnerBinPath = await realpath(resolve(installRoot, 'node_modules/.bin/vitest'));
  const ajvPackagePath = resolve(installRoot, 'node_modules/ajv/package.json');
  const ajvEntrypointPath = await realpath(resolve(installRoot, contract.schema_validator.entrypoint));
  const runnerPackageBytes = await readFile(runnerPackagePath);
  const runnerEntrypointBytes = await readFile(runnerEntrypointPath);
  const ajvPackageBytes = await readFile(ajvPackagePath);
  const ajvEntrypointBytes = await readFile(ajvEntrypointPath);
  const runnerPackage = JSON.parse(runnerPackageBytes);
  const ajvPackage = JSON.parse(ajvPackageBytes);
  return assertLockedRunnerDescriptor({
    command: [process.execPath, runnerEntrypointPath, 'run'],
    install_root: installRoot,
    package_lock_sha256: sha256(currentLockBytes),
    installed_package_lock_sha256: sha256(installedLockBytes),
    runner_path: runnerEntrypointPath,
    runner_bin_path: runnerBinPath,
    runner_version: runnerPackage.version,
    runner_lock_version: currentLock.packages['node_modules/vitest'].version,
    runner_lock_integrity: installedLock.packages['node_modules/vitest'].integrity,
    runner_package_sha256: sha256(runnerPackageBytes),
    runner_entrypoint_sha256: sha256(runnerEntrypointBytes),
    ajv_path: ajvEntrypointPath,
    ajv_version: ajvPackage.version,
    ajv_lock_version: currentLock.packages['node_modules/ajv'].version,
    ajv_lock_integrity: installedLock.packages['node_modules/ajv'].integrity,
    ajv_package_sha256: sha256(ajvPackageBytes),
    ajv_entrypoint_sha256: sha256(ajvEntrypointBytes),
    node_modules_root: resolve(installRoot, 'node_modules'),
    contract,
    network_acquisition: false
  });
};

const run = async () => {
  const descriptor = await resolveLockedRunner(process.env.P0_LOCK_INSTALL_ROOT);
  process.stdout.write(`P0_LOCKED_RUNNER_METADATA=${JSON.stringify(descriptor)}\n`);
  const localNodeModules = resolve(repoRoot, 'node_modules');
  const localAjv = resolve(localNodeModules, 'ajv');
  try {
    await lstat(localAjv);
    reject('local AJV path already exists; refusing to replace user state');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await mkdir(localNodeModules, { recursive: true });
  await symlink(resolve(descriptor.install_root, 'node_modules/ajv'), localAjv, 'dir');
  try {
    const result = await new Promise((fulfil, rejectSpawn) => {
      const child = spawn(process.execPath, [
        descriptor.runner_path,
        'run',
        '--config',
        '.vibepro/spec/story-p0-negative-boundary-contract-v1/vitest.config.mjs',
        'tests/contracts/p0-negative-boundary-contract-v1/contract.test.js',
        'tests/contracts/p0-negative-boundary-contract-v1/planning-source-lock.test.js'
      ], {
        cwd: repoRoot,
        env: {
          ...process.env,
          npm_config_offline: 'true',
          npm_config_audit: 'false',
          npm_config_fund: 'false'
        },
        stdio: 'inherit'
      });
      child.once('error', rejectSpawn);
      child.once('exit', (code, signal) => fulfil({ code, signal }));
    });
    if (result.signal) process.kill(process.pid, result.signal);
    if (result.code !== 0) process.exitCode = result.code ?? 1;
  } finally {
    await rm(localAjv);
  }
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}
