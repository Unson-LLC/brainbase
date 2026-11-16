import { execFileSync } from 'node:child_process';
import { planRelease } from './npm-release.mjs';

export const RELEASE_EVIDENCE_BASE_ENV = 'BRAINBASE_RELEASE_EVIDENCE_BASE';

function packageVersionAt(root, ref) {
  let raw;
  try {
    raw = execFileSync('git', ['show', `${ref}:package.json`], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch {
    throw new Error(`Release evidence base ref cannot be read: ${ref}`);
  }
  const manifest = JSON.parse(raw);
  if (typeof manifest.version !== 'string' || manifest.version === '') {
    throw new Error(`package.json at ${ref} has no version`);
  }
  return manifest.version;
}

/**
 * Decide whether the "target npm version is absent from the registry" check applies.
 *
 * The decision uses the same version comparison as `release:plan` (before/after
 * package.json versions only). It never consults the registry, so an already
 * published version can never make a publishing change skip the absence check.
 *
 * - No base ref: fail closed. The absence check is required.
 * - release_required=true (version raised): the absence check is required.
 * - release_required=false (version not raised, e.g. a normal develop PR): the
 *   absence check is not applicable. Callers must record it as N/A, never as PASS.
 */
export function resolveRegistryAbsenceScope({ root = process.cwd(), baseRef, headRef = 'HEAD' } = {}) {
  if (baseRef === undefined || baseRef === null || `${baseRef}`.trim() === '') {
    return {
      registry_absence: 'required',
      reason: `no ${RELEASE_EVIDENCE_BASE_ENV}; treated as a publishing candidate`
    };
  }
  const base = `${baseRef}`.trim();
  const beforeVersion = packageVersionAt(root, base);
  const afterVersion = packageVersionAt(root, headRef);
  const { releaseRequired } = planRelease(beforeVersion, afterVersion);
  return releaseRequired
    ? {
        registry_absence: 'required',
        reason: `release_required=true (${beforeVersion} -> ${afterVersion})`,
        before_version: beforeVersion,
        after_version: afterVersion
      }
    : {
        registry_absence: 'not_applicable',
        reason: `release_required=false (${beforeVersion} -> ${afterVersion}); this change does not publish`,
        before_version: beforeVersion,
        after_version: afterVersion
      };
}
