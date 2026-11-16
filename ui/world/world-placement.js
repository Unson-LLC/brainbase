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

/**
 * Which lot a task's site stands on, in a district that grows in rings round its hall
 * (story-world-district-rings-v1).  The hall and its plaza are the centre.  Work stated to be for the same
 * thing (`purpose_label`, from the Task record) is one gathering and takes one sector of the circle; the
 * sectors run clockwise from the gate's avenue in the order of their oldest task, and work with no label
 * takes the last one, by the gate.  Inside a sector the lots fill ring by ring, from the plaza outward, in
 * order of creation (`created_at`, then id): more work makes the town one ring wider, never one street
 * longer.
 *
 * A sector's width follows a coarse step of its count (`districtStreetWeight`), so the town stays round
 * when one gathering is much larger than the others.  A new task in a gathering, or a change of state,
 * therefore never moves an older site; the sectors are re-divided only when a gathering begins or ends, or
 * crosses a step.
 *
 * Returns `{ lots: { [taskId]: { x, z, yaw, street, ring } }, streets: [{ key, label, count, from, to,
 * sign: { x, z }, name: { x, z }, box: { minX, maxX, minZ, maxZ } }], roads: [radius…], plaza, radius,
 * open: [{ x, z, ring }] }`.  `open` are the places left on the rings the town already reaches.  Angles are
 * measured clockwise from the gate's avenue (+z); `yaw` turns a lot's front to its ring road; `label` is
 * null for the unlabelled; `radius` is how far the built town reaches.
 */
export const DISTRICT_STREETS = Object.freeze({ main: 2, lot: 2.8, pitch: 3.3, road: 1.6, spoke: 1.4, plaza: 7.5, setback: 2.5, band: 8.2 });

function byCreation(a, b) {
  const at = String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''));
  return at !== 0 ? at : String(a.task_id).localeCompare(String(b.task_id));
}

/** How many shares of the circle a gathering of `count` tasks takes: 1 up to 4, 2 up to 16, 3 up to 36… */
export function districtStreetWeight(count) {
  return Math.max(1, Math.ceil(Math.sqrt(Math.max(count, 0) / 4)));
}

/** The radius of the `ring`th ring of lots (0 is the one facing the plaza's road), given the first road. */
function lotRing(ring, firstRoad) {
  if (ring === 0) return { radius: firstRoad + DISTRICT_STREETS.setback, road: 0, inward: true };
  const road = Math.ceil(ring / 2);
  const inward = ring % 2 === 0;
  return { radius: firstRoad + road * DISTRICT_STREETS.band + (inward ? 1 : -1) * DISTRICT_STREETS.setback, road, inward };
}

export function districtRingLots(sites) {
  const S = DISTRICT_STREETS;
  const groups = new Map();
  for (const site of sites ?? []) {
    const label = typeof site.purpose_label === 'string' && site.purpose_label.trim() ? site.purpose_label.trim() : null;
    const key = label ?? '';
    if (!groups.has(key)) groups.set(key, { key, label, sites: [] });
    groups.get(key).sites.push(site);
  }
  const blocks = [...groups.values()].map((group) => ({ ...group, sites: group.sites.sort(byCreation) }));
  blocks.sort((a, b) => {
    if ((a.label === null) !== (b.label === null)) return a.label === null ? 1 : -1;
    const first = byCreation(a.sites[0], b.sites[0]);
    return first !== 0 ? first : a.key.localeCompare(b.key);
  });
  const round = (value) => Math.round(value * 100) / 100;
  // Shares are counted against the smallest gathering, so a town of equally large ones has no wider plaza.
  const steps = blocks.map((block) => districtStreetWeight(block.sites.length));
  const smallest = Math.min(...steps, Infinity);
  const weights = steps.map((step) => step / smallest);
  const units = weights.reduce((sum, weight) => sum + weight, 0);
  // Kept clear on each side of a sector: half a lane between sectors.  The gate's avenue takes its own
  // slice of the circle first, and the sectors share the rest.
  const lane = S.spoke / 2 + 0.2;
  const avenue = S.main + 0.8;
  // The first ring holds at least one lot for each share, so a town of many gatherings has a wider plaza.
  const around = units * (S.pitch + lane * 2) + avenue * 2;
  const plaza = round(Math.max(S.plaza, around / (Math.PI * 2) - S.road / 2 - 0.1 - S.setback));
  const firstRoad = plaza + S.road / 2 + 0.1;
  const gap = avenue / (firstRoad + S.setback);
  const share = (Math.PI * 2 - gap * 2) / Math.max(units, 1);
  const lots = {};
  const streets = [];
  const open = [];
  let cursor = gap;
  let lastRing = 0;
  blocks.forEach((block, index) => {
    const from = cursor;
    const to = cursor + share * weights[index];
    cursor = to;
    const box = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
    let placed = 0;
    let reach = 0;
    const spare = [];
    for (let ring = 0; placed < block.sites.length && ring < 400; ring += 1) {
      const { radius, inward } = lotRing(ring, firstRoad);
      const usable = (to - from) * radius - lane * 2;
      const slots = Math.floor(usable / S.pitch);
      if (slots < 1) continue;
      // Slots are fixed places on the ring; they fill from the middle of the sector outward.
      const order = Array.from({ length: slots }, (_, slot) => slot).sort((a, b) => Math.abs(a - (slots - 1) / 2) - Math.abs(b - (slots - 1) / 2) || a - b);
      for (const slot of order) {
        const angle = from + (lane + (usable - slots * S.pitch) / 2 + (slot + 0.5) * S.pitch) / radius;
        const x = round(Math.sin(angle) * radius);
        const z = round(Math.cos(angle) * radius);
        if (placed >= block.sites.length) {
          spare.push({ x, z, ring });
          continue;
        }
        lots[block.sites[placed].task_id] = { x, z, yaw: Math.round((inward ? angle + Math.PI : angle) * 10000) / 10000, street: block.key, ring };
        box.minX = Math.min(box.minX, x); box.maxX = Math.max(box.maxX, x); box.minZ = Math.min(box.minZ, z); box.maxZ = Math.max(box.maxZ, z);
        placed += 1;
        reach = radius;
        lastRing = Math.max(lastRing, ring);
      }
    }
    open.push(...spare);
    // The sign stands on the plaza's rim, in front of its sector.
    const middle = (from + to) / 2;
    const sign = { x: round(Math.sin(middle) * (plaza - 0.7)), z: round(Math.cos(middle) * (plaza - 0.7)) };
    // Its name floats over the middle of its lots.
    const heart = (firstRoad + S.setback + reach) / 2;
    const name = { x: round(Math.sin(middle) * heart), z: round(Math.cos(middle) * heart) };
    streets.push({ key: block.key, label: block.label, count: block.sites.length, name, from: Math.round(from * 10000) / 10000, to: Math.round(to * 10000) / 10000, sign, box });
  });
  const outer = lotRing(lastRing, firstRoad);
  const roads = Array.from({ length: outer.road + 1 }, (_, road) => round(firstRoad + road * S.band));
  const radius = round(Math.max(outer.radius + S.lot / 2, roads[roads.length - 1] + S.road / 2) + 0.8);
  return { lots, streets, roads, plaza, radius, open };
}

/**
 * Where the hall, its forecourt and the gate stand in a district laid out by `districtRingLots`.  The hall
 * is the centre of the plaza; the avenue runs from beyond the gate to the plaza's rim and never into it.
 */
export function districtRingPlan(layout) {
  return {
    plazaRadius: layout.plaza,
    hallZ: -1.6,
    courtZ: 3.4,
    gateZ: round2(layout.radius + 3.5),
    street: { from: layout.plaza, to: round2(layout.radius + 11.5) },
  };
}
function round2(value) {
  return Math.round(value * 100) / 100;
}

/*
 * The straight-street layout of 0.50.13 and earlier, kept only so that a hosting page which still holds
 * an older world module can import these names from this file during a deploy.  Nothing in this package
 * calls them; remove them once every host checks exports per screen rather than per file.
 */
const LEGACY_STREETS = Object.freeze({ frontLot: 4, backLot: 10, row: 3.4, cross: 2.6 });
const LEGACY_LOT_COLUMNS = Object.freeze([
  { x: -LEGACY_STREETS.frontLot, facing: 1 },
  { x: LEGACY_STREETS.frontLot, facing: -1 },
  { x: -LEGACY_STREETS.backLot, facing: 1 },
  { x: LEGACY_STREETS.backLot, facing: -1 },
]);

/** @deprecated since 0.50.14; districts are laid out by `districtRingLots`. */
export function districtStreetLots(sites, { minRows = 4 } = {}) {
  const groups = new Map();
  for (const site of sites ?? []) {
    const label = typeof site.purpose_label === 'string' && site.purpose_label.trim() ? site.purpose_label.trim() : null;
    const key = label ?? '';
    if (!groups.has(key)) groups.set(key, { key, label, sites: [] });
    groups.get(key).sites.push(site);
  }
  const blocks = [...groups.values()].map((group) => ({ ...group, sites: group.sites.sort(byCreation) }));
  blocks.sort((a, b) => {
    if ((a.label === null) !== (b.label === null)) return a.label === null ? 1 : -1;
    const first = byCreation(a.sites[0], b.sites[0]);
    return first !== 0 ? first : a.key.localeCompare(b.key);
  });
  const rowsOf = (block) => Math.max(1, Math.ceil(block.sites.length / LEGACY_LOT_COLUMNS.length));
  const rows = blocks.reduce((sum, block) => sum + rowsOf(block), 0);
  const used = rows * LEGACY_STREETS.row + Math.max(0, blocks.length - 1) * LEGACY_STREETS.cross;
  const length = Math.max(used, minRows * LEGACY_STREETS.row);
  const lots = {};
  const streets = [];
  let cursor = -used / 2;
  for (const block of blocks) {
    const blockRows = rowsOf(block);
    block.sites.forEach((site, index) => {
      const row = Math.floor(index / LEGACY_LOT_COLUMNS.length);
      const column = LEGACY_LOT_COLUMNS[index % LEGACY_LOT_COLUMNS.length];
      lots[site.task_id] = { x: column.x, z: round2(cursor + (row + 0.5) * LEGACY_STREETS.row), facing: column.facing, street: block.key };
    });
    streets.push({ key: block.key, label: block.label, count: block.sites.length, z_from: round2(cursor), z_to: round2(cursor + blockRows * LEGACY_STREETS.row) });
    cursor += blockRows * LEGACY_STREETS.row + LEGACY_STREETS.cross;
  }
  return { lots, streets, rows, length };
}

/** @deprecated since 0.50.14; districts are laid out by `districtRingPlan`. */
export function districtGroundPlan(length) {
  const plazaRadius = 3.85;
  const plazaZ = -length / 2 - 1.5 - plazaRadius;
  return {
    gateZ: length / 2 + 4,
    plazaZ,
    plazaRadius,
    hallZ: plazaZ - 5.4,
    street: { from: plazaZ + plazaRadius, to: length / 2 + 12 },
  };
}

/*
 * The town grows (story-world-work-sites-and-gaps-v1, AC-22〜24).  It grows only from evidenced outcomes
 * and closed gaps, never from activity: counting completions or edits would let splitting work inflate it.
 */
const WORKER_GAPS = new Set(['assignee_unrecorded', 'assignee_unlinked_mentioned']);
const PATH_GAPS = new Set(['source_unlinked', 'outcome_unlinked']);
const OPEN_STATES = new Set(['pending', 'in_progress', 'waiting']);

export const DISTRICT_CHANGE_TEXT = Object.freeze({
  new: '新しい現場ができた',
  left: '区画を出た仕事がある（取消・付け替え）',
  built: '家が建った（完了）',
  evidenced: 'プレハブが本設の建物になった（成果の記録がつながった）',
  started: '着工した（未着手→進行中）',
  held: 'シートがかかった（→待ち）',
  resumed: 'シートが外れた（待ち→進行中）',
  worker_in: '作業員が入った（担当がつながった）',
  worker_out: '作業員がいなくなった（担当が外れた）',
  path_linked: '道がつながった（出典・成果の記録がついた）',
  weeds_cleared: '雑草が抜けた（見直された）',
  weeds_grew: '雑草が生えた（見直し予定を過ぎた）',
});

const hasEvidence = (site) => (site.source_refs?.length ?? 0) > 0;

/** What this viewer saw of a district, kept in their browser to tell what changed next time. */
export function districtSnapshot(sites, at) {
  const kept = {};
  for (const site of sites ?? []) {
    if (site.work?.status === 'cancelled') continue;
    kept[site.task_id] = {
      s: site.work?.status ?? null,
      g: [...new Set((site.gaps ?? []).map((gap) => gap.kind))].sort(),
      l: site.purpose_label ?? null,
      e: hasEvidence(site),
    };
  }
  return { v: 1, at, sites: kept };
}

/** What changed in a district since `previous` (a snapshot), in the words of the street. */
export function districtChanges(previous, sites, at) {
  if (!previous || previous.v !== 1 || typeof previous.sites !== 'object' || previous.sites === null) {
    return { first: true, since: null, at, items: [], counts: {} };
  }
  const now = districtSnapshot(sites, at).sites;
  const items = [];
  const add = (taskId, kind) => items.push({ task_id: taskId, kind, text: DISTRICT_CHANGE_TEXT[kind] });
  for (const [taskId, after] of Object.entries(now)) {
    const before = previous.sites[taskId];
    if (!before) {
      add(taskId, 'new');
      continue;
    }
    if (OPEN_STATES.has(before.s) && after.s === 'completed') add(taskId, 'built');
    if (before.s === 'completed' && after.s === 'completed' && !before.e && after.e) add(taskId, 'evidenced');
    if (before.s === 'pending' && after.s === 'in_progress') add(taskId, 'started');
    if (before.s !== 'waiting' && OPEN_STATES.has(before.s) && after.s === 'waiting') add(taskId, 'held');
    if (before.s === 'waiting' && after.s === 'in_progress') add(taskId, 'resumed');
    const had = (gaps, set) => (gaps ?? []).some((kind) => set.has(kind));
    if (had(before.g, WORKER_GAPS) && !had(after.g, WORKER_GAPS)) add(taskId, 'worker_in');
    if (!had(before.g, WORKER_GAPS) && had(after.g, WORKER_GAPS)) add(taskId, 'worker_out');
    if (had(before.g, PATH_GAPS) && !had(after.g, PATH_GAPS)) add(taskId, 'path_linked');
    const overdue = new Set(['review_overdue']);
    if (had(before.g, overdue) && !had(after.g, overdue)) add(taskId, 'weeds_cleared');
    if (!had(before.g, overdue) && had(after.g, overdue)) add(taskId, 'weeds_grew');
  }
  for (const taskId of Object.keys(previous.sites)) if (!now[taskId]) add(taskId, 'left');
  const counts = {};
  for (const item of items) counts[item.kind] = (counts[item.kind] ?? 0) + 1;
  return { first: false, since: previous.at ?? null, at, items, counts };
}

export const DISTRICT_STAGES = Object.freeze([
  { key: 'vacant', label: '更地', min: 0 },
  { key: 'village', label: '村', min: 1 },
  { key: 'town', label: '町', min: 3 },
  { key: 'street', label: '街', min: 7 },
  { key: 'city', label: '都市', min: 15 },
]);

/** The stage of a district: counted from completed work with a record of its source (a permanent building). */
export function districtStage(sites) {
  const live = (sites ?? []).filter((site) => site.work?.status !== 'cancelled');
  const completed = live.filter((site) => site.work?.status === 'completed');
  const permanent = completed.filter(hasEvidence).length;
  const open = live.filter((site) => OPEN_STATES.has(site.work?.status));
  let index = 0;
  DISTRICT_STAGES.forEach((stage, i) => { if (permanent >= stage.min) index = i; });
  const stage = DISTRICT_STAGES[index];
  const following = DISTRICT_STAGES[index + 1] ?? null;
  return {
    key: stage.key,
    label: stage.label,
    level: index,
    permanent,
    prefab: completed.length - permanent,
    open: open.length,
    clear_open: open.filter((site) => (site.gaps?.length ?? 0) === 0).length,
    next: following ? { label: following.label, needed: following.min - permanent } : null,
  };
}

/** Optional host-supplied actors. Movement needs current host-confirmed runtime evidence and an in-progress Task. */
export function districtTaskActors(site, now = Date.now()) {
  if (site?.actors_state !== 'confirmed' || !Array.isArray(site.actors)) return [];
  const seen = new Set();
  return site.actors.filter(actor => {
    if (!actor || typeof actor.id !== 'string' || !actor.id || typeof actor.name !== 'string' || !actor.name || actor.task_id !== site.task_id || actor.state !== site.work?.status || seen.has(actor.id)) return false;
    seen.add(actor.id); return true;
  }).map(actor => {
    const age = now - Date.parse(actor.activity?.heartbeat_at ?? '');
    return { ...actor, moving: site.work.status === 'in_progress' && actor.activity?.moving === true && actor.activity?.state === 'running' && Number.isFinite(age) && age >= 0 && age <= 300000 };
  });
}

/*
 * The pulse of the work (story-world-three-scales-v1): what each scale of the world says about how the
 * work is going.  The world says which businesses have work in progress; a district says how far each
 * gathering of work (a street) has come and who is on it; a street says which agent is on which work and
 * how.  All of it is counted from the same records the lots are drawn from.  "動いている" is said of an
 * agent only on the evidence `districtTaskActors` asks for (an in-progress Task and a runtime heartbeat
 * confirmed within five minutes); a count of in-progress Tasks stays "進行中", the record's own word.
 */

/** Soft colours an agent keeps wherever it appears (its figure in the street and its mark in the panel). */
export const ACTOR_TONES = Object.freeze(['#e8927c', '#6fa8dc', '#8fbf7f', '#b39ddb', '#e6b655', '#5fb8b0']);

export function actorTone(id) {
  let h = 2166136261;
  for (const char of String(id ?? '')) {
    h ^= char.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  return ACTOR_TONES[(h >>> 0) % ACTOR_TONES.length];
}

export const ACTOR_PRESENCE = Object.freeze({
  running: Object.freeze({ key: 'running', label: '動いている', rank: 0 }),
  quiet: Object.freeze({ key: 'quiet', label: '知らせが途絶えている', rank: 1 }),
  waiting: Object.freeze({ key: 'waiting', label: '待っている', rank: 2 }),
  unconfirmed: Object.freeze({ key: 'unconfirmed', label: '稼働は未確認', rank: 3 }),
  queued: Object.freeze({ key: 'queued', label: 'これから', rank: 4 }),
  done: Object.freeze({ key: 'done', label: '終えた', rank: 5 }),
});

const STALE_HEARTBEAT_MS = 300000;

/** What the street a work stands on is called: its purpose, or '' for the unlabelled lots by the gate. */
export function streetKeyOf(site) {
  return typeof site?.purpose_label === 'string' && site.purpose_label.trim() ? site.purpose_label.trim() : '';
}

/**
 * The agents on a work, each with how it is there now.  Only actors the host confirmed for this Task in
 * its recorded state are returned (see `districtTaskActors`).
 */
export function siteActors(site, now = Date.now()) {
  return districtTaskActors(site, now).map((actor) => {
    const status = site.work?.status ?? null;
    const at = Date.parse(actor.activity?.heartbeat_at ?? '');
    const age = Number.isFinite(at) ? now - at : Number.NaN;
    let presence = ACTOR_PRESENCE.unconfirmed;
    if (status === 'completed') presence = ACTOR_PRESENCE.done;
    else if (status === 'waiting') presence = ACTOR_PRESENCE.waiting;
    else if (status === 'pending') presence = ACTOR_PRESENCE.queued;
    else if (status === 'in_progress') presence = actor.moving ? ACTOR_PRESENCE.running : Number.isFinite(age) && age > STALE_HEARTBEAT_MS ? ACTOR_PRESENCE.quiet : ACTOR_PRESENCE.unconfirmed;
    return {
      id: actor.id,
      name: actor.name,
      kind: actor.kind ?? null,
      tone: actorTone(actor.id),
      task_id: site.task_id,
      presence: presence.key,
      label: presence.label,
      heartbeat_at: Number.isFinite(at) ? actor.activity.heartbeat_at : null,
      /** Whole minutes since the last confirmed heartbeat; null when there is none to count from. */
      minutes: Number.isFinite(age) && age >= 0 ? Math.floor(age / 60000) : null,
      waiting_on: status === 'waiting' ? site.work?.waiting_on ?? null : null,
    };
  });
}

const emptyCounts = () => ({ total: 0, done: 0, in_progress: 0, waiting: 0, pending: 0 });
function countSite(counts, site) {
  counts.total += 1;
  const status = site.work?.status;
  if (status === 'completed') counts.done += 1;
  else if (status === 'in_progress') counts.in_progress += 1;
  else if (status === 'waiting') counts.waiting += 1;
  else counts.pending += 1;
}

function gatherActors(entries) {
  const byId = new Map();
  for (const { site, actor } of entries) {
    if (!byId.has(actor.id)) byId.set(actor.id, { id: actor.id, name: actor.name, kind: actor.kind, tone: actor.tone, presence: actor.presence, label: actor.label, works: [] });
    const entry = byId.get(actor.id);
    entry.works.push({ task_id: site.task_id, title: site.title, street: streetKeyOf(site), presence: actor.presence, label: actor.label, minutes: actor.minutes, waiting_on: actor.waiting_on });
    if (ACTOR_PRESENCE[actor.presence].rank < ACTOR_PRESENCE[entry.presence].rank) {
      entry.presence = actor.presence;
      entry.label = actor.label;
    }
  }
  const actors = [...byId.values()];
  for (const actor of actors) actor.works.sort((a, b) => ACTOR_PRESENCE[a.presence].rank - ACTOR_PRESENCE[b.presence].rank || a.title.localeCompare(b.title, 'ja'));
  return actors.sort((a, b) => ACTOR_PRESENCE[a.presence].rank - ACTOR_PRESENCE[b.presence].rank || a.name.localeCompare(b.name, 'ja'));
}

/**
 * How a district's work is going: its counts by recorded state, its agents with where each is, and the
 * same for each street in the order the streets stand (`districtRingLots`).  Cancelled work is left
 * out, as it is from the streets.  `actors_unconfirmed` counts work whose agents the host could not
 * confirm: for those, no agent is not "nobody".
 */
export function districtPulse(sites, now = Date.now()) {
  const live = (Array.isArray(sites) ? sites : []).filter((site) => site?.work?.status !== 'cancelled');
  const counts = emptyCounts();
  const entries = [];
  const streets = new Map();
  const order = districtRingLots(live.map((site) => ({ task_id: site.task_id, created_at: site.work?.created_at, purpose_label: site.purpose_label }))).streets;
  for (const street of order) streets.set(street.key, { key: street.key, label: street.label, counts: emptyCounts(), task_ids: [], entries: [], actors_unconfirmed: 0 });
  let unconfirmed = 0;
  for (const site of live) {
    countSite(counts, site);
    const street = streets.get(streetKeyOf(site));
    countSite(street.counts, site);
    street.task_ids.push(site.task_id);
    if (site.actors_state === 'unconfirmed') {
      unconfirmed += 1;
      street.actors_unconfirmed += 1;
    }
    for (const actor of siteActors(site, now)) {
      entries.push({ site, actor });
      street.entries.push({ site, actor });
    }
  }
  const running = (list) => list.filter((actor) => actor.presence === 'running').length;
  const actors = gatherActors(entries);
  return {
    counts,
    actors,
    running: running(actors),
    actors_unconfirmed: unconfirmed,
    streets: [...streets.values()].map(({ entries: own, ...street }) => {
      const streetActors = gatherActors(own);
      return { ...street, actors: streetActors, running: running(streetActors) };
    }),
  };
}

/**
 * How a business's work stands as the world's summary records it (`by_status`), or null when the summary
 * was not read: unread work is never shown as none.
 */
export function cityPulse(summary) {
  if (!summary || (summary.state !== 'complete' && summary.state !== 'partial') || !summary.by_status || typeof summary.by_status !== 'object') return null;
  const count = (key) => (Number.isInteger(summary.by_status[key]) && summary.by_status[key] > 0 ? summary.by_status[key] : 0);
  return { in_progress: count('in_progress'), waiting: count('waiting'), pending: count('pending'), done: count('completed'), partial: summary.state === 'partial' };
}

/**
 * The businesses of the world with their pulse, the ones with the most work in progress first (then the
 * most waiting, then by name).  The order is a way to find where things move; it is not a score.
 */
export function worldPulse(businesses, summaries) {
  const rows = (Array.isArray(businesses) ? businesses : []).map((business) => ({ code: business.code, name: business.name, pulse: cityPulse(summaries?.[business.code]) }));
  rows.sort((a, b) => (b.pulse?.in_progress ?? -1) - (a.pulse?.in_progress ?? -1) || (b.pulse?.waiting ?? -1) - (a.pulse?.waiting ?? -1) || String(a.name).localeCompare(String(b.name), 'ja'));
  const read = rows.filter((row) => row.pulse);
  return { rows, read: read.length, active: read.filter((row) => row.pulse.in_progress > 0).length };
}
