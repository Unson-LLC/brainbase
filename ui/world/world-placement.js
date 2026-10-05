/*
 * Where a judgment stands in the world (ledger D6 placement).
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

/**
 * The lots around a city's landmark for `count` districts: a square grid of `step` spacing whose cells
 * outside the landmark's lot hold at least `count` districts (a 2x2 grid lies wholly inside it).
 */
export function districtLots(count, step = 2.5) {
  let cols = Math.max(2, Math.ceil(Math.sqrt(count + 1)));
  for (;;) {
    const cells = [];
    for (let row = 0; row < cols; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const cx = -((cols - 1) * step) / 2 + col * step;
        const cz = -((cols - 1) * step) / 2 + row * step;
        if (Math.abs(cx) < 2.2 && Math.abs(cz) < 2.2) continue; // the landmark's lot
        cells.push([cx, cz]);
      }
    }
    if (cells.length >= count) return { cols, cells };
    cols += 1;
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How a city reads (story-world-size-and-activity-v1): its size is the engagements still going, its
 * height and lit windows are what happened in the last 30 days (decisions the Graph records for it,
 * and judgments placed in it when the host has them).  Finished engagements stay as empty lots but do
 * not make the city bigger.
 */
export function cityMeasures(business, { isFinished, judgments = [], now = Date.now() } = {}) {
  const engagements = Array.isArray(business?.engagements) ? business.engagements : [];
  const open = engagements.filter((engagement) => !isFinished?.(engagement.status)).length;
  const since = now - (business?.activity?.window_days ?? 30) * DAY_MS;
  const recentJudgments = judgments.filter((entry) => {
    const at = Date.parse(entry?.item?.proof?.recorded_at ?? '');
    return Number.isFinite(at) && at >= since && at <= now;
  }).length;
  const decisions = Number.isInteger(business?.activity?.decisions) ? business.activity.decisions : 0;
  const recent = decisions + recentJudgments;
  return {
    open,
    finished: engagements.length - open,
    decisions,
    judgments: recentJudgments,
    recent,
    towerHeight: 3.2 + Math.min(Math.log2(1 + recent) * 1.6, 5.5),
    lit: recent > 0,
  };
}
