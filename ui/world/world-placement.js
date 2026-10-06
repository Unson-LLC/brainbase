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

/**
 * The sky for an hour of the day (scenery only; it represents no data).  `mode` 'auto' follows the hour;
 * 'day', 'dusk' and 'night' fix it.  At night lit windows and street lamps glow the most, so the cities
 * that moved lately read best then.
 */
export function skyAt(hour, mode = 'auto') {
  const phase = mode !== 'auto' ? mode
    : hour >= 5 && hour < 7 ? 'dawn'
      : hour >= 7 && hour < 17 ? 'day'
        : hour >= 17 && hour < 19 ? 'dusk'
          : 'night';
  const skies = {
    dawn: { top: '#c9d6ef', middle: '#f3d9c4', bottom: '#f6ead8', fog: 0xf1e2d2, sun: 0xffd2a8, sunIntensity: 1.6, hemi: 0.95, exposure: 1.0, glow: 1.1, lamps: true, stars: false },
    day: { top: '#bfdcf0', middle: '#e3f0f2', bottom: '#f4f1e6', fog: 0xe9f1ee, sun: 0xfff1dc, sunIntensity: 2.7, hemi: 1.25, exposure: 1.05, glow: 0.6, lamps: false, stars: false },
    dusk: { top: '#5d6f9e', middle: '#e7a77e', bottom: '#f3cfa4', fog: 0xe6bf9c, sun: 0xffb27a, sunIntensity: 1.3, hemi: 0.75, exposure: 0.95, glow: 1.5, lamps: true, stars: false },
    night: { top: '#0d1730', middle: '#1c2b4c', bottom: '#33456a', fog: 0x2a3a5a, sun: 0x9fb4ff, sunIntensity: 0.35, hemi: 0.35, exposure: 0.9, glow: 2.4, lamps: true, stars: true },
  };
  return { phase, ...skies[phase] };
}

/**
 * What moved since the viewer last opened the world: cities whose newest decision or a placed judgment
 * is newer than `lastVisit`, and plaza buildings whose newest judgment is.  Null on a first visit.
 */
export function changesSince(lastVisit, businesses, judgmentsByBusiness, rows) {
  const since = Date.parse(lastVisit ?? '');
  if (!Number.isFinite(since)) return null;
  const newer = (at) => {
    const time = Date.parse(at ?? '');
    return Number.isFinite(time) && time > since;
  };
  const cities = [];
  for (const business of businesses ?? []) {
    const judgments = judgmentsByBusiness?.get?.(business.code) ?? [];
    if (newer(business.activity?.latest_decision_at) || judgments.some((entry) => newer(entry?.item?.proof?.recorded_at))) cities.push(business.code);
  }
  const plaza = (rows ?? []).filter((row) => newer(row.latest_recorded_at)).map((row) => row.key);
  return { since: new Date(since).toISOString(), cities, plaza };
}

function placementHash(value) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

/**
 * Where the work of a city stands (story-world-work-sites-and-gaps-v1): small sites on square rings
 * just outside the city's plate, away from the road that enters it.  A site's cell comes from its task
 * id, and sites are taken oldest first (by `created_at`, then id), so a new task never moves an older
 * one; the number of rings grows only when the count outgrows them.  The state of the work never moves
 * a site.  Returns `{ [taskId]: [dx, dz] }` relative to the city's centre, and the rings used.
 */
export function workSiteCells(sites, { size, roadAngle = null, spacing = 1.45 } = {}) {
  const ordered = [...(sites ?? [])].sort((a, b) => {
    const at = String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''));
    return at !== 0 ? at : String(a.task_id).localeCompare(String(b.task_id));
  });
  const ringCells = (k) => {
    const half = size / 2 + 1.0 + k * spacing;
    const count = Math.max(4, Math.floor((8 * half) / spacing));
    const cells = [];
    for (let i = 0; i < count; i += 1) {
      // Walk the square's perimeter at even steps.
      const d = (i / count) * 8 * half;
      const side = Math.floor(d / (2 * half));
      const t = d - side * 2 * half - half;
      const [x, z] = side === 0 ? [t, -half] : side === 1 ? [half, t] : side === 2 ? [-t, half] : [-half, -t];
      if (roadAngle !== null) {
        // Keep the road that enters the city clear.
        const along = x * Math.cos(roadAngle) + z * Math.sin(roadAngle);
        const across = -x * Math.sin(roadAngle) + z * Math.cos(roadAngle);
        if (along > 0 && Math.abs(across) < 1.6) continue;
      }
      cells.push([Math.round(x * 100) / 100, Math.round(z * 100) / 100]);
    }
    return cells;
  };
  const needed = Math.ceil(ordered.length * 1.3);
  const cells = [];
  let rings = 0;
  while (cells.length < Math.max(needed, 1)) {
    cells.push(...ringCells(rings));
    rings += 1;
  }
  const taken = new Set();
  const placed = {};
  for (const site of ordered) {
    let index = Math.floor(placementHash(String(site.task_id)) * cells.length);
    while (taken.has(index)) index = (index + 1) % cells.length;
    taken.add(index);
    placed[site.task_id] = cells[index];
  }
  return { cells: placed, rings };
}
