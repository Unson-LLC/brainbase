import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const rootDefault = path.resolve(path.dirname(scriptPath), '..');
export const EXPECTED_PACKAGE_NAME = '@unson/brainbase-mcp';

function isDirectInvocation() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(scriptPath);
  } catch {
    return path.resolve(process.argv[1]) === scriptPath;
  }
}

export function parseSemver(value) {
  const match = `${value}`.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u);
  if (!match) throw new Error(`Invalid SemVer: ${value}`);
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4]?.split('.') ?? []
  };
}

export function compareSemver(leftValue, rightValue) {
  const left = parseSemver(leftValue);
  const right = parseSemver(rightValue);
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] > right[key] ? 1 : -1;
  }
  if (!left.prerelease.length && right.prerelease.length) return 1;
  if (left.prerelease.length && !right.prerelease.length) return -1;
  for (let index = 0; index < Math.max(left.prerelease.length, right.prerelease.length); index += 1) {
    const leftPart = left.prerelease[index];
    const rightPart = right.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    const leftNumeric = /^\d+$/u.test(leftPart);
    const rightNumeric = /^\d+$/u.test(rightPart);
    if (leftNumeric && rightNumeric) return Number(leftPart) > Number(rightPart) ? 1 : -1;
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftPart > rightPart ? 1 : -1;
  }
  return 0;
}

export function npmDistTag(version) {
  const { prerelease } = parseSemver(version);
  if (!prerelease.length) return 'latest';
  const candidate = prerelease[0].toLowerCase();
  const looksLikeSemverRange = candidate === 'x' || /^v\d+(?:\.\d+){0,2}(?:[-+].*)?$/iu.test(candidate);
  return /^[a-z][a-z0-9._-]*$/u.test(candidate) && !looksLikeSemverRange ? candidate : 'next';
}

export function releaseStagingTag(expectedSha) {
  if (!/^[0-9a-f]{40}$/u.test(expectedSha)) throw new Error('release staging tag requires a full lowercase git SHA');
  return `release-${expectedSha.slice(0, 12)}`;
}

export function planRelease(beforeVersion, afterVersion) {
  return {
    releaseRequired: compareSemver(afterVersion, beforeVersion) > 0,
    version: afterVersion
  };
}

function run(command, args, cwd = rootDefault) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  if (result.error || result.status !== 0) {
    const error = new Error(result.error?.message ?? `Command failed: ${command} (exit ${result.status ?? 'unknown'})`);
    error.stdout = result.stdout;
    error.stderr = result.stderr;
    throw error;
  }
  const diagnostic = redactCommandDiagnostic(result.stderr).trim();
  if (diagnostic) process.stderr.write(`${diagnostic}\n`);
  return result.stdout.trim();
}

function redactCommandDiagnostic(value) {
  return `${value ?? ''}`
    .replace(/(?:npm|npmrc)_[A-Za-z0-9]{20,}/gu, '[REDACTED_NPM_TOKEN]')
    .replace(/((?:NPM_TOKEN|NODE_AUTH_TOKEN)\s*=\s*)\S+/giu, '$1[REDACTED]')
    .replace(/(\/\/[\w.-]+\/[\w./-]*:_authToken\s*=\s*)\S+/giu, '$1[REDACTED]');
}

export function commandFailureMessage(error) {
  const parts = [error?.message, error?.stdout, error?.stderr]
    .map(redactCommandDiagnostic)
    .map((part) => part.trim())
    .filter(Boolean);
  return [...new Set(parts)].join('\n');
}

function packageAt(root, ref) {
  return JSON.parse(run('git', ['show', `${ref}:package.json`], root));
}

function gitSha(root, ref = 'HEAD') {
  return run('git', ['rev-parse', ref], root);
}

async function currentPackage(root) {
  return JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
}

export function readNpmMetadata(packageName, version, root = rootDefault, spawn = spawnSync) {
  const result = spawn('npm', ['view', `${packageName}@${version}`, 'version', 'gitHead', 'dist.integrity', '--json'], {
    cwd: root,
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    const diagnostic = `${result.stderr ?? ''}\n${result.stdout ?? ''}`;
    if (/E404|404 Not Found|is not in this registry/iu.test(diagnostic)) return null;
    throw new Error(`npm metadata lookup failed for ${packageName}@${version}: ${diagnostic.trim() || `exit ${result.status}`}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`npm metadata lookup returned invalid JSON: ${error.message}`);
  }
}

function publishedIntegrity(metadata) {
  return metadata?.['dist.integrity'] ?? metadata?.dist?.integrity;
}

export function assertPublishedMetadata(metadata, packageName, version, expectedSha, expectedIntegrity = undefined) {
  if (!metadata || metadata.version !== version || metadata.gitHead !== expectedSha) {
    throw new Error(`${packageName}@${version} does not match expected gitHead ${expectedSha}; published versions are immutable`);
  }
  if (expectedIntegrity && publishedIntegrity(metadata) !== expectedIntegrity) {
    throw new Error(`${packageName}@${version} registry integrity does not match the validated release artifact; published versions are immutable`);
  }
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function retry(operation, attempts = 6, delay = wait) {
  let lastError;
  for (let index = 0; index < attempts; index += 1) {
    try {
      const result = await operation();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    if (index < attempts - 1) await delay(2 ** index * 1000);
  }
  if (lastError) throw lastError;
  throw new Error(`npm registry did not converge after ${attempts} attempts`);
}

export async function reconcileDistTag(packageName, version, root, execute = run) {
  const tag = npmDistTag(version);
  const versions = JSON.parse(execute('npm', ['view', packageName, 'versions', '--json'], root));
  const list = Array.isArray(versions) ? versions : [versions];
  const eligible = list.filter((candidate) => npmDistTag(candidate) === tag).sort(compareSemver);
  const desired = eligible.at(-1);
  if (!desired) throw new Error(`No published version is eligible for npm dist-tag ${tag}`);
  const currentTags = JSON.parse(execute('npm', ['view', packageName, 'dist-tags', '--json'], root));
  const current = currentTags[tag];
  if (current && npmDistTag(current) === tag && compareSemver(current, desired) >= 0) {
    return { tag, version: current };
  }
  if (current !== desired) {
    execute('npm', ['dist-tag', 'add', `${packageName}@${desired}`, tag], root);
  }
  return { tag, version: desired };
}

async function removeReleaseStagingTag(packageName, version, expectedSha, root, execute = run) {
  const tag = releaseStagingTag(expectedSha);
  const currentTags = JSON.parse(execute('npm', ['view', packageName, 'dist-tags', '--json'], root));
  if (currentTags[tag] !== version) return { status: 'not_present', tag };
  try {
    execute('npm', ['dist-tag', 'rm', packageName, tag], root);
    return { status: 'removed', tag };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/\bE403\b|403 Forbidden/iu.test(message)) {
      return { status: 'blocked', tag, reason: 'registry_permission_denied' };
    }
    throw error;
  }
}

function expectedDistTag(packageName, version, root, execute = run) {
  const tag = npmDistTag(version);
  const versions = JSON.parse(execute('npm', ['view', packageName, 'versions', '--json'], root));
  const list = Array.isArray(versions) ? versions : [versions];
  const eligible = list.filter((candidate) => npmDistTag(candidate) === tag).sort(compareSemver);
  const desired = eligible.at(-1);
  if (!desired) throw new Error(`No published version is eligible for npm dist-tag ${tag}`);
  const currentTags = JSON.parse(execute('npm', ['view', packageName, 'dist-tags', '--json'], root));
  return { tag, desired, current: currentTags[tag] };
}

export function assertTrustedCommit(root, expectedSha, trustedRef, execute = run) {
  if (!trustedRef) throw new Error('publish requires --trusted-ref <reviewed-default-branch-ref>');
  try {
    execute('git', ['merge-base', '--is-ancestor', expectedSha, trustedRef], root);
  } catch {
    throw new Error(`release commit ${expectedSha} is not reachable from trusted ref ${trustedRef}`);
  }
}

export function assertCleanCheckout(root, execute = run) {
  const status = execute('git', ['status', '--porcelain=v1', '--untracked-files=all'], root);
  if (status) throw new Error('release checkout must be clean and identical to git HEAD');
}

async function sha256(file) {
  return createHash('sha256').update(await readFile(file)).digest('hex');
}

async function sha512Integrity(file) {
  return `sha512-${createHash('sha512').update(await readFile(file)).digest('base64')}`;
}

function packedResult(output, expectedVersion) {
  const packed = JSON.parse(output);
  const result = Array.isArray(packed) ? packed[0] : packed;
  if (result?.name !== EXPECTED_PACKAGE_NAME || result?.version !== expectedVersion || !result?.filename) {
    throw new Error('npm pack did not produce the expected Brainbase package artifact');
  }
  return result;
}

export async function createReleaseArtifact(root, artifactDirectory, expectedVersion, expectedSha, execute = run) {
  const stagingDirectory = await mkdtemp(path.join(artifactDirectory, '.brainbase-npm-pack-'));
  try {
    const initial = packedResult(execute(
      'npm',
      ['pack', '--ignore-scripts', '--json', '--pack-destination', stagingDirectory],
      root
    ), expectedVersion);
    const initialTarball = path.resolve(stagingDirectory, initial.filename);
    execute('tar', ['-xzf', initialTarball, '-C', stagingDirectory], root);

    const stagedPackageRoot = path.join(stagingDirectory, 'package');
    const stagedManifestPath = path.join(stagedPackageRoot, 'package.json');
    const stagedManifest = JSON.parse(await readFile(stagedManifestPath, 'utf8'));
    if (stagedManifest.name !== EXPECTED_PACKAGE_NAME || stagedManifest.version !== expectedVersion) {
      throw new Error('packed manifest does not match the expected Brainbase package identity');
    }
    stagedManifest.gitHead = expectedSha;
    await writeFile(stagedManifestPath, `${JSON.stringify(stagedManifest, null, 2)}\n`);

    const final = packedResult(execute(
      'npm',
      ['pack', stagedPackageRoot, '--ignore-scripts', '--json', '--pack-destination', artifactDirectory],
      root
    ), expectedVersion);
    const tarballPath = path.resolve(artifactDirectory, final.filename);
    if (!tarballPath.startsWith(`${artifactDirectory}${path.sep}`)) {
      throw new Error('npm pack returned an artifact outside the validation directory');
    }

    const inspectionDirectory = path.join(stagingDirectory, 'inspection');
    await mkdir(inspectionDirectory);
    execute('tar', ['-xzf', tarballPath, '-C', inspectionDirectory], root);
    const finalManifest = JSON.parse(await readFile(path.join(inspectionDirectory, 'package', 'package.json'), 'utf8'));
    if (finalManifest.name !== EXPECTED_PACKAGE_NAME || finalManifest.version !== expectedVersion || finalManifest.gitHead !== expectedSha) {
      throw new Error('release tarball manifest is not bound to the expected package, version, and git HEAD');
    }
    return {
      tarballPath,
      tarballSha256: await sha256(tarballPath),
      tarballIntegrity: await sha512Integrity(tarballPath)
    };
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true });
  }
}

export async function validateRelease(root, proofFile, expectedVersion, expectedSha, execute = run, createArtifact = createReleaseArtifact) {
  execute('npm', ['run', 'build'], root);
  execute('npm', ['test'], root);
  execute('npm', ['audit', '--omit=dev'], root);
  const artifactDirectory = path.resolve(path.dirname(proofFile));
  return createArtifact(root, artifactDirectory, expectedVersion, expectedSha, execute);
}

export async function validateReleaseCandidate({
  root = rootDefault,
  packageName,
  version,
  expectedSha,
  trustedRef,
  proofFile,
  execute = run,
  validate = validateRelease,
  createArtifact = createReleaseArtifact
}) {
  if (packageName !== EXPECTED_PACKAGE_NAME) {
    throw new Error(`publication authority is fixed to ${EXPECTED_PACKAGE_NAME}`);
  }
  const packageJson = await currentPackage(root);
  if (packageJson.name !== packageName) throw new Error(`package name mismatch: expected ${packageName}, found ${packageJson.name}`);
  if (packageJson.version !== version) throw new Error(`package version mismatch: expected ${version}, found ${packageJson.version}`);
  const checkoutSha = gitSha(root);
  if (checkoutSha !== expectedSha) throw new Error(`git HEAD mismatch: expected ${expectedSha}, found ${checkoutSha}`);
  assertTrustedCommit(root, expectedSha, trustedRef, execute);
  assertCleanCheckout(root, execute);
  if (!proofFile) throw new Error('validation requires an external proof file path');
  assertProofOutsideRepository(root, proofFile);
  const artifact = await validate(root, proofFile, version, expectedSha, execute, createArtifact);
  assertCleanCheckout(root, execute);
  return { packageName, version, expectedSha, trustedRef, ...artifact };
}

function assertValidationProof(proof, expected) {
  for (const key of ['packageName', 'version', 'expectedSha', 'trustedRef']) {
    if (proof?.[key] !== expected[key]) throw new Error(`validation proof mismatch for ${key}`);
  }
  if (!proof?.tarballPath || !proof?.tarballSha256 || !proof?.tarballIntegrity) {
    throw new Error('validation proof is missing the release artifact digest');
  }
}

async function assertValidatedArtifact(root, proof) {
  assertProofOutsideRepository(root, proof.tarballPath);
  const actualSha256 = await sha256(proof.tarballPath);
  const actualIntegrity = await sha512Integrity(proof.tarballPath);
  if (actualSha256 !== proof.tarballSha256 || actualIntegrity !== proof.tarballIntegrity) {
    throw new Error('validated release artifact digest mismatch');
  }
}

export async function reconcileNpmRelease({
  root = rootDefault,
  packageName,
  version,
  expectedSha,
  trustedRef,
  provenance = false,
  metadata = readNpmMetadata,
  execute = run,
  delay = wait,
  validationProof,
  reconcileTag = reconcileDistTag,
  cleanupStagingTag = removeReleaseStagingTag
}) {
  if (packageName !== EXPECTED_PACKAGE_NAME) {
    throw new Error(`publication authority is fixed to ${EXPECTED_PACKAGE_NAME}`);
  }
  const packageJson = await currentPackage(root);
  if (packageJson.name !== packageName) throw new Error(`package name mismatch: expected ${packageName}, found ${packageJson.name}`);
  if (packageJson.version !== version) throw new Error(`package version mismatch: expected ${version}, found ${packageJson.version}`);
  const checkoutSha = gitSha(root);
  if (checkoutSha !== expectedSha) throw new Error(`git HEAD mismatch: expected ${expectedSha}, found ${checkoutSha}`);
  assertTrustedCommit(root, expectedSha, trustedRef, execute);
  assertCleanCheckout(root, execute);
  assertValidationProof(validationProof, { packageName, version, expectedSha, trustedRef });
  await assertValidatedArtifact(root, validationProof);

  let published = await metadata(packageName, version, root);
  if (published) {
    assertPublishedMetadata(published, packageName, version, expectedSha, validationProof.tarballIntegrity);
  } else {
    const args = ['publish', validationProof.tarballPath, '--ignore-scripts', '--access', 'public', '--tag', releaseStagingTag(expectedSha)];
    if (provenance) args.push('--provenance');
    execute('npm', args, root);
    published = await retry(async () => {
      const candidate = await metadata(packageName, version, root);
      if (!candidate) return null;
      assertPublishedMetadata(candidate, packageName, version, expectedSha, validationProof.tarballIntegrity);
      return candidate;
    }, 6, delay);
  }
  const distTag = await reconcileTag(packageName, version, root, execute);
  const stagingTagCleanup = await cleanupStagingTag(packageName, version, expectedSha, root, execute);
  return {
    packageName,
    version,
    gitHead: published.gitHead,
    integrity: publishedIntegrity(published),
    distTag,
    stagingTagCleanup
  };
}

export async function verifyNpmRelease({
  root = rootDefault,
  packageName,
  version,
  expectedSha,
  metadata = readNpmMetadata,
  execute = run
}) {
  if (packageName !== EXPECTED_PACKAGE_NAME) {
    throw new Error(`publication authority is fixed to ${EXPECTED_PACKAGE_NAME}`);
  }
  const packageJson = await currentPackage(root);
  if (packageJson.name !== packageName || packageJson.version !== version) {
    throw new Error(`package identity mismatch: expected ${packageName}@${version}`);
  }
  if (gitSha(root) !== expectedSha) throw new Error(`git HEAD mismatch: expected ${expectedSha}`);
  const published = await metadata(packageName, version, root);
  if (!published) throw new Error(`${packageName}@${version} is not published`);
  assertPublishedMetadata(published, packageName, version, expectedSha);
  const distTag = expectedDistTag(packageName, version, root, execute);
  if (distTag.current !== distTag.desired) {
    throw new Error(`npm dist-tag ${distTag.tag} points to ${distTag.current ?? 'nothing'}, expected ${distTag.desired}`);
  }
  return { packageName, version, gitHead: published.gitHead, distTag: { tag: distTag.tag, version: distTag.desired } };
}

async function writeOutputs(values) {
  const content = Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n') + '\n';
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, content);
  else process.stdout.write(content);
}

function option(args, name, fallback = undefined) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

function assertProofOutsideRepository(root, proofFile) {
  const repository = path.resolve(root) + path.sep;
  const proof = path.resolve(proofFile);
  if (proof === path.resolve(root) || proof.startsWith(repository)) {
    throw new Error('validation proof must be written outside the repository');
  }
}

function decodeJwtPayload(token) {
  const segments = token.split('.');
  if (segments.length !== 3) throw new Error('GitHub Actions OIDC response is not a JWT');
  try {
    return JSON.parse(Buffer.from(segments[1], 'base64url').toString('utf8'));
  } catch {
    throw new Error('GitHub Actions OIDC JWT payload is invalid');
  }
}

export function classifyOidcEndpoint(rawEndpoint) {
  const result = {
    url_present: typeof rawEndpoint === 'string' && rawEndpoint.length > 0,
    parse_ok: false,
    protocol_https: false,
    hostname_trusted: false,
    raw_authority_colon: false,
    userinfo_present: false,
    normalized_nondefault_port: false
  };
  if (!result.url_present) return result;
  try {
    const endpoint = new URL(rawEndpoint);
    const rawAuthority = rawEndpoint.match(/^https?:\/\/([^/?#]*)/iu)?.[1] ?? '';
    result.parse_ok = true;
    result.protocol_https = endpoint.protocol === 'https:';
    result.hostname_trusted = /^[a-z0-9-]+\.actions\.githubusercontent\.com$/u.test(endpoint.hostname);
    result.raw_authority_colon = rawAuthority.includes(':');
    result.userinfo_present = Boolean(endpoint.username || endpoint.password);
    result.normalized_nondefault_port = endpoint.port !== '';
    return result;
  } catch {
    return result;
  }
}

export async function assertSerializedPublicationContext(environment = process.env, request = fetch) {
  if (environment.BRAINBASE_NPM_OIDC_DIAGNOSTIC === 'true') {
    const classification = classifyOidcEndpoint(environment.ACTIONS_ID_TOKEN_REQUEST_URL);
    throw new Error(`GitHub Actions OIDC diagnostic ${JSON.stringify(classification)}`);
  }
  if (
    environment.GITHUB_ACTIONS !== 'true' ||
    environment.GITHUB_REPOSITORY !== 'Unson-LLC/brainbase' ||
    !environment.GITHUB_RUN_ID ||
    environment.BRAINBASE_NPM_PUBLISH_SERIALIZED !== 'true' ||
    !environment.ACTIONS_ID_TOKEN_REQUEST_URL ||
    !environment.ACTIONS_ID_TOKEN_REQUEST_TOKEN
  ) {
    throw new Error('publish is restricted to the serialized GitHub Actions workflow; use `gh workflow run npm-publish.yml --ref develop -f release_ref=<ref>`');
  }
  let oidcUrl;
  try {
    oidcUrl = new URL(environment.ACTIONS_ID_TOKEN_REQUEST_URL);
  } catch {
    throw new Error('GitHub Actions OIDC endpoint is not trusted');
  }
  const rawAuthority = environment.ACTIONS_ID_TOKEN_REQUEST_URL.match(/^https?:\/\/([^/?#]*)/iu)?.[1] ?? '';
  const trustedOidcHostname = /^[a-z0-9-]+\.actions\.githubusercontent\.com$/u;
  if (
    oidcUrl.protocol !== 'https:' ||
    !trustedOidcHostname.test(oidcUrl.hostname) ||
    rawAuthority.includes(':') ||
    oidcUrl.username ||
    oidcUrl.password
  ) {
    throw new Error('GitHub Actions OIDC endpoint is not trusted');
  }
  const audience = 'brainbase-npm-publish';
  oidcUrl.searchParams.set('audience', audience);
  const response = await request(oidcUrl, {
    headers: { Authorization: `Bearer ${environment.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` },
    redirect: 'error'
  });
  if (!response.ok) throw new Error(`GitHub Actions OIDC attestation failed with HTTP ${response.status}`);
  const body = await response.json();
  if (!body || typeof body.value !== 'string') throw new Error('GitHub Actions OIDC response did not contain a token');
  const claims = decodeJwtPayload(body.value);
  const trustedWorkflowRef = 'Unson-LLC/brainbase/.github/workflows/npm-publish.yml@refs/heads/develop';
  if (
    claims.iss !== 'https://token.actions.githubusercontent.com' ||
    claims.aud !== audience ||
    claims.repository !== environment.GITHUB_REPOSITORY ||
    String(claims.run_id) !== String(environment.GITHUB_RUN_ID) ||
    claims.workflow_ref !== trustedWorkflowRef ||
    claims.ref !== 'refs/heads/develop'
  ) {
    throw new Error('GitHub Actions OIDC claims do not match the serialized npm publication workflow');
  }
}

async function main(args) {
  const [command, ...rest] = args;
  if (command === 'plan') {
    const before = option(rest, '--before');
    const after = option(rest, '--after');
    if (!before || !after) throw new Error('Usage: npm-release.mjs plan --before <git-ref> --after <git-ref>');
    const beforePackage = packageAt(rootDefault, before);
    const afterPackage = packageAt(rootDefault, after);
    if (beforePackage.name !== EXPECTED_PACKAGE_NAME || afterPackage.name !== EXPECTED_PACKAGE_NAME) {
      throw new Error(`publication authority is fixed to ${EXPECTED_PACKAGE_NAME}`);
    }
    const plan = planRelease(beforePackage.version, afterPackage.version);
    await writeOutputs({
      release_required: plan.releaseRequired,
      package_name: afterPackage.name,
      version: plan.version,
      sha: gitSha(rootDefault, after)
    });
    return;
  }
  if (command === 'validate' || command === 'publish' || command === 'verify') {
    const packageJson = await currentPackage(rootDefault);
    const version = option(rest, '--version', packageJson.version);
    const expectedSha = gitSha(rootDefault, option(rest, '--sha', 'HEAD'));
    const trustedRef = option(rest, '--trusted-ref');
    if (command === 'validate') {
      const proofFile = option(rest, '--proof-file');
      if (!proofFile) throw new Error('validate requires --proof-file <path-outside-repository>');
      assertProofOutsideRepository(rootDefault, proofFile);
      const result = await validateReleaseCandidate({
        packageName: EXPECTED_PACKAGE_NAME,
        version,
        expectedSha,
        trustedRef,
        proofFile
      });
      await writeFile(proofFile, `${JSON.stringify(result)}\n`, { mode: 0o600 });
      process.stdout.write(`${JSON.stringify(result)}\n`);
      return;
    }
    let result;
    if (command === 'verify') {
      result = await verifyNpmRelease({ packageName: EXPECTED_PACKAGE_NAME, version, expectedSha });
    } else {
      await assertSerializedPublicationContext();
      const proofFile = option(rest, '--proof-file');
      if (!proofFile) throw new Error('publish requires --proof-file <validated-release-proof>');
      assertProofOutsideRepository(rootDefault, proofFile);
      const validationProof = JSON.parse(await readFile(proofFile, 'utf8'));
      const tarballFile = option(rest, '--tarball-file');
      if (tarballFile) validationProof.tarballPath = path.resolve(tarballFile);
      result = await reconcileNpmRelease({
          packageName: EXPECTED_PACKAGE_NAME,
          version,
          expectedSha,
          trustedRef,
          provenance: rest.includes('--provenance'),
          validationProof
      });
    }
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  throw new Error('Usage: npm-release.mjs <plan|validate|publish|verify>');
}

if (isDirectInvocation()) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(commandFailureMessage(error));
    process.exitCode = 1;
  });
}
