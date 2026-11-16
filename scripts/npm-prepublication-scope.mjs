import { execFileSync, spawnSync } from 'node:child_process';
import { planRelease } from './npm-release.mjs';

export const RELEASE_EVIDENCE_BASE_ENV = 'BRAINBASE_RELEASE_EVIDENCE_BASE';

// Exact message thrown by scripts/npm-prepublication-evidence.mjs when the registry step fails.
// The evidence script runs this step only after the clean worktree, production audit, and
// tarball integrity checks have passed.
export const REGISTRY_ABSENCE_FAILURE = 'Target npm version is not proven absent';

// Every other failure the evidence script can raise. None of them may be turned into N/A.
const NON_REGISTRY_FAILURES = [
  'Prepublication evidence requires a clean worktree',
  'Production dependency audit reported vulnerabilities',
  'npm pack integrity does not match the generated tarball',
  'Repository changed while prepublication evidence was collected'
];

function resolveCommit(root, ref, role) {
  try {
    return execFileSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
  } catch {
    throw new Error(`Release evidence ${role} ref cannot be read: ${ref}`);
  }
}

function packageVersionAt(root, sha, ref, role) {
  let raw;
  try {
    raw = execFileSync('git', ['show', `${sha}:package.json`], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch {
    throw new Error(`Release evidence ${role} ref has no package.json: ${ref}`);
  }
  const manifest = JSON.parse(raw);
  if (typeof manifest.version !== 'string' || manifest.version === '') {
    throw new Error(`package.json at ${role} ref ${ref} has no version`);
  }
  return manifest.version;
}

function isStrictAncestor(root, baseSha, headSha) {
  const result = spawnSync('git', ['merge-base', '--is-ancestor', baseSha, headSha], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  throw new Error(`Release evidence cannot check ancestry of ${baseSha} and ${headSha}: ${result.stderr ?? ''}`.trim());
}

/**
 * Decide whether the "target npm version is absent from the registry" check applies.
 *
 * The decision uses the same version comparison as `planRelease` (before/after package.json
 * versions only). It never consults the registry, and it does not use the `release:plan` CLI
 * shortcut that reports release_required=false for a version already published at the same
 * gitHead. An already published version can never make a publishing change skip the check.
 *
 * not_applicable only when ALL hold; anything else fails closed (required):
 * - a base ref is given and resolves to a commit (unreadable refs throw),
 * - the base commit is a different commit from HEAD,
 * - the base commit is an ancestor of HEAD,
 * - planRelease(base version, head version) says release_required=false.
 *
 * not_applicable narrows only the registry absence step. Callers must still run the evidence
 * script on HEAD, require every other check to pass, and record the step as N/A, never PASS.
 */
export function resolveRegistryAbsenceScope({ root = process.cwd(), baseRef, headRef = 'HEAD' } = {}) {
  if (baseRef === undefined || baseRef === null || `${baseRef}`.trim() === '') {
    return {
      registry_absence: 'required',
      reason: `no ${RELEASE_EVIDENCE_BASE_ENV}; treated as a publishing candidate`
    };
  }
  const base = `${baseRef}`.trim();
  const baseSha = resolveCommit(root, base, 'base');
  const headSha = resolveCommit(root, headRef, 'head');
  const beforeVersion = packageVersionAt(root, baseSha, base, 'base');
  const afterVersion = packageVersionAt(root, headSha, headRef, 'head');
  const common = {
    base_sha: baseSha,
    head_sha: headSha,
    before_version: beforeVersion,
    after_version: afterVersion
  };

  if (baseSha === headSha) {
    return {
      registry_absence: 'required',
      reason: `base ${base} is the same commit as head (${headSha}); a commit cannot prove it does not publish by comparing with itself`,
      ...common
    };
  }
  if (!isStrictAncestor(root, baseSha, headSha)) {
    return {
      registry_absence: 'required',
      reason: `base ${base} (${baseSha}) is not an ancestor of head (${headSha})`,
      ...common
    };
  }
  const { releaseRequired } = planRelease(beforeVersion, afterVersion);
  return releaseRequired
    ? {
        registry_absence: 'required',
        reason: `release_required=true (${beforeVersion} -> ${afterVersion})`,
        ...common
      }
    : {
        registry_absence: 'not_applicable',
        reason: `release_required=false (${beforeVersion} -> ${afterVersion}); this change does not publish`,
        ...common
      };
}

/**
 * Interpret one run of scripts/npm-prepublication-evidence.mjs against a scope.
 *
 * - exit 0: the full pass JSON is required, whatever the scope.
 * - non-zero, scope required: fail.
 * - non-zero, scope not_applicable: N/A only if the run failed with the registry absence
 *   message and with no other evidence failure. Clean worktree, audit, tarball, and repository
 *   change failures always fail. The caller must separately confirm that HEAD and the worktree
 *   did not change, because the evidence script stops before its own after-run check.
 */
export function interpretPrepublicationEvidenceRun({ scope, status, stdout = '', stderr = '' }) {
  const output = `${stdout ?? ''}\n${stderr ?? ''}`;
  if (status === 0) {
    let evidence;
    try {
      evidence = JSON.parse(stdout);
    } catch {
      throw new Error(`Prepublication evidence exited 0 without pass JSON:\n${output}`);
    }
    if (evidence?.status !== 'pass') {
      throw new Error(`Prepublication evidence exited 0 without status=pass:\n${output}`);
    }
    return { registry_absence: 'pass', evidence };
  }
  const otherFailure = NON_REGISTRY_FAILURES.find((message) => output.includes(message));
  if (otherFailure) {
    throw new Error(`Prepublication evidence failed before or outside the registry step: ${otherFailure}\n${output}`);
  }
  if (scope?.registry_absence !== 'not_applicable') {
    throw new Error(`Prepublication evidence failed with registry absence required (${scope?.reason ?? 'unknown scope'}):\n${output}`);
  }
  if (!output.includes(REGISTRY_ABSENCE_FAILURE)) {
    throw new Error(`Prepublication evidence failed for a reason other than registry absence:\n${output}`);
  }
  return {
    registry_absence: 'not_applicable',
    line: `[release-evidence] registry absence for current HEAD: N/A (not PASS) - ${scope.reason}; clean worktree, production audit, and tarball integrity passed before the registry step`
  };
}
