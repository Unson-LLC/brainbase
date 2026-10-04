/*
 * Where a judgment stands in the world (experimental, M3).
 *
 * The judgment Host records the repository a turn worked in (`project_code`,
 * the session's repository name).  A judgment is placed in a business only by
 * a relation the organization Graph already states:
 *   1. the business registers that repository in `repository_roots`, or
 *   2. the business code equals the repository name.
 * Anything else stays in the plaza with the reason.  The place is where the
 * work happened, which is not always what the judgment was about.
 */

export const WORLD_PLACEMENT_CONTRACT_VERSION = 'brainbase.world-placement.v0';

export const UNPLACED_REASON_TEXT = Object.freeze({
  workspace_unrecorded: '作業した場所の記録が無い',
  workspace_unregistered: '作業した場所が、どの事業にも登録されていない',
});

/** @returns {{ business: object, basis: 'repository' | 'code' } | { business: null, reason: keyof UNPLACED_REASON_TEXT }} */
export function placeJudgment(workspace, businesses) {
  if (typeof workspace !== 'string' || !workspace.trim()) return { business: null, reason: 'workspace_unrecorded' };
  const name = workspace.trim();
  const byRepository = businesses.find((business) => Array.isArray(business.repositories) && business.repositories.includes(name));
  if (byRepository) return { business: byRepository, basis: 'repository' };
  const byCode = businesses.find((business) => business.code === name);
  if (byCode) return { business: byCode, basis: 'code' };
  return { business: null, reason: 'workspace_unregistered' };
}

/** Groups judgment places by business code; unplaced ones are listed with their reason. */
export function groupJudgmentPlaces(places, businesses) {
  const byBusiness = new Map();
  const unplaced = [];
  for (const place of places) {
    const result = placeJudgment(place.workspace, businesses);
    if (result.business) {
      if (!byBusiness.has(result.business.code)) byBusiness.set(result.business.code, []);
      byBusiness.get(result.business.code).push({ ...place, basis: result.basis });
    } else {
      unplaced.push({ ...place, reason: result.reason });
    }
  }
  return { byBusiness, unplaced };
}
