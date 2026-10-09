/*
 * World view (ledger P17, adopted 2026-10-04): the home's upper layer.
 *
 * A read-only 3D projection of two existing sources:
 *   - projects from the same Graph the other screens read (the organization
 *     Graph under C1, else this Mac's Graph; GET /api/extensions/world/businesses),
 *     top-level projects as cities and their sub-projects as districts, in the
 *     Graph's own kinds and statuses as the host's vocabulary names them;
 *   - the delegation map of the value-proof home (GET /api/value-proofs/home),
 *     drawn as buildings in the plaza, one per judgment kind.
 * Judgments do not record a project yet (W4), so every judgment building stands
 * in the plaza; nothing is assigned to a city by guesswork (P9).  The world
 * never writes. Selecting something opens its facts in the rail and hands off
 * to the existing screens.
 *
 * Inside a city (story-world-work-sites-and-gaps-v1) the host's Canonical Tasks
 * stand as small work sites around the plate, read only when the city is
 * opened.  A site's wall is its recorded state; a sign says something about it
 * cannot be seen from the records (an empty assignee field, no source link, a
 * review date passed); a dashed ring says the text names a person the assignee
 * field does not.  Above the cities, a sign counts the open work with such a
 * gap, and a grey sign says the work could not be read (never zero).
 */

import { THREE, MapControls } from './world-vendor.js';
import { changesSince, cityMeasures, districtChanges, districtLots, districtSnapshot, districtStage, groupJudgmentPlaces, skyAt, UNPLACED_REASON_TEXT } from './world-placement.js';
import { createDistrictView, DISTRICT_LEGEND } from './world-district.js';
import { createWorldCanvasUI } from './world-canvas-ui.js';
import { workCanvasNotes } from './world-canvas-notes.js';
import { canvasTexture, drawFacade, FACADE_SIZES, FACADE_UNITS, gableRoof, hashUnit, muted, paintVertices, roundedPlate, valueNoise } from './world-scenery.js';
import { WORK_STATES, workCityBlocks, workGrowthBlock, workPickBlock, workSign, workSiteBlocks } from './world-work-rail.js';
import {
  makeWorkspaceElement as el,
  workspacePageHeader,
  workspaceRailHead,
  workspaceRailBlock,
  workspaceDefinition,
  workspaceDetailEmpty,
  workspaceButton,
} from '../../workspace-kit.js';

export const WORLD_VIEW_CONTRACT_VERSION = 'brainbase.world-view.v0';
/** Optional full-canvas presentation; the standard host contract remains unchanged. */
export const WORLD_CANVAS_PRESENTATION_VERSION = 'brainbase.world-canvas.v1';

const STATE_LABELS = Object.freeze({ delegated: '任せている', verifying: '確かめ中', returned: '戻している' });
const STATE_COLORS = Object.freeze({ delegated: 0x087d62, verifying: 0xc99a3a, returned: 0xd92335 });
const REASON_LABELS = Object.freeze({
  routine_in_scope: '範囲内の定型作業',
  irreversible_action: '取り消せない操作',
  owner_value_choice: '本人の価値判断',
  missing_authority: '権限が足りない',
  required_input_unavailable: '必要な情報が無い',
  evidenced_terminal_blocker: '進められない障害',
});
const BUSINESS_STATE_TEXT = Object.freeze({
  not_initialized: 'Graphがまだありません',
  migration_required: 'Graphの形式を移す必要があります',
  unavailable: 'Graphを読めません',
});

/*
 * The words the world draws with come from the host (`vocabulary` in the
 * businesses answer): the Graph's own kinds and statuses, labelled by the
 * owner's vocabulary when one is given.  Nothing here names an organization's
 * kinds.  Until the answer arrives, everything is unclassified and active.
 */
let worldVocabulary = { kinds: [], statuses: [] };
const kindEntry = (key) => worldVocabulary.kinds.find((entry) => entry.key === (key ?? null))
  ?? { key: key ?? null, label: key ?? '分類なし', definition: null, form: 'office', color: '#69746d' };
const kindColor = (key) => Number.parseInt(kindEntry(key).color.slice(1), 16);
const statusEntry = (status) => worldVocabulary.statuses.find((entry) => entry.key === status) ?? null;
const statusPhase = (status) => statusEntry(status)?.phase ?? 'active';
const isFinished = (status) => statusPhase(status) === 'finished';
const SECTION_TEXT = Object.freeze({ needs_human: 'あなたに戻した', blocked: '止まった', continued: '聞かずに進めた', other: 'その他' });
const BASIS_TEXT = Object.freeze({ repository: '作業したリポジトリがこの事業に登録されている', code: '作業したリポジトリ名がこの事業のコードと同じ' });
const statusText = (status) => (status ? statusEntry(status)?.label ?? status : '未記録');

const PLAZA_RADIUS = 7;
const CITY_RING = 30;

async function readJson(fetcher, path) {
  try {
    const response = await fetcher(path);
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };
    return { ok: true, data: await response.json() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'request_failed' };
  }
}

function rowLabel(row) {
  if (row.source === 'unrecorded') return '種類の記録なし';
  if (row.source === 'reason_code') return REASON_LABELS[row.label] ?? row.label ?? '理由不明';
  return row.label ?? '名前なし';
}

/** Waiting for the owner now: returned to them, not answered, and the conversation did not move on. */
function isWaiting(item) {
  return Boolean(item && item.section === 'needs_human' && !item.conversation_moved_on_at && !item.answer);
}

function proofIndex(home) {
  const index = new Map();
  const sections = home && typeof home.sections === 'object' ? home.sections : {};
  for (const items of Object.values(sections)) {
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      const proof = item?.proof;
      if (proof?.decision_attempt_id) index.set(proof.decision_attempt_id, item);
    }
  }
  return index;
}

/**
 * Lays businesses out around the plaza, grouped by kind.  Every city gets an
 * equal slice of the circle (with a small gap between kinds) and neighbours
 * alternate between an inner and an outer ring so plates do not overlap.
 * Returns the cities, the centre angle of each kind and the world's extent.
 */
export function layoutWorld(businesses) {
  const kinds = worldVocabulary.kinds.map((entry) => entry.key);
  const order = (kind) => {
    const index = kinds.indexOf(kind ?? null);
    return index === -1 ? kinds.length : index;
  };
  const ordered = [...businesses].sort((a, b) => order(a.kind) - order(b.kind));
  const kindCount = new Set(ordered.map((business) => business.kind)).size;
  const gap = 0.35;
  const slot = (Math.PI * 2 - gap * kindCount) / Math.max(ordered.length, 1);
  const cities = [];
  const kindAngles = new Map();
  let angle = -Math.PI / 2 - slot / 2;
  let previousKind = null;
  let extent = PLAZA_RADIUS;
  ordered.forEach((business, index) => {
    if (business.kind !== previousKind) {
      angle += gap;
      previousKind = business.kind;
    }
    angle += slot;
    // The city's size is the engagements still going (finished ones stay as empty lots).
    const n = business.engagements.filter((engagement) => !isFinished(engagement.status)).length;
    const size = 7 + 2.6 * Math.ceil(Math.sqrt(Math.max(n, 1)));
    const ring = CITY_RING + (index % 2) * 16 + size * 0.35;
    const city = { business, kind: business.kind, size, angle, x: Math.cos(angle) * ring, z: Math.sin(angle) * ring };
    cities.push(city);
    if (!kindAngles.has(business.kind ?? null)) kindAngles.set(business.kind ?? null, []);
    kindAngles.get(business.kind ?? null).push(angle);
    extent = Math.max(extent, ring + size * 0.75);
  });
  const sectors = [...kindAngles].map(([kind, angles]) => ({ kind, angle: angles.reduce((sum, value) => sum + value, 0) / angles.length }));
  return { cities, sectors, extent };
}

function makeLabel(doc, text, className) {
  const label = el(doc, 'div', { className: `bb-world-label ${className ?? ''}`.trim(), text });
  label.setAttribute('aria-hidden', 'true');
  return label;
}

function webglAvailable(doc) {
  try {
    const canvas = doc.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Scene (M2). Everything drawn here is a projection of the loaded facts; the
// shapes only encode kind and state, never invented quantities.
// ---------------------------------------------------------------------------

const RECENT_MS = 24 * 60 * 60 * 1000;
const LABEL_PRIORITY = Object.freeze({ selected: 0, plaza: 1, city: 2, sector: 3, judgment: 4, engagement: 5, site: 6 });
const WORK_COLORS = Object.freeze(Object.fromEntries(WORK_STATES.map((state) => [state.key, state.color])));
const GAP_SHORT_TEXT = Object.freeze({
  assignee_unlinked_mentioned: '担当欄に未接続（本文に人物）',
  assignee_unrecorded: '担当の記録なし',
  outcome_unlinked: '成果物の記録が未接続',
  source_unlinked: '出典リンクなし',
  review_overdue: '見直し超過',
});

function createScene({ doc, stage, labelsLayer, reducedMotion, onPick, onClear, onEscape }) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio ?? 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.domElement.className = 'bb-world-canvas';
  renderer.domElement.tabIndex = 0;
  stage.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  // Scenery (sky, sea, land, mountains, trees, lamps) represents no data: it only sets the place.
  let skyMode = 'auto';
  let sky = skyAt(new Date().getHours(), skyMode);
  function skyTexture(current) {
    return canvasTexture(doc, 256, 256, (ctx, w, h) => {
      const gradient = ctx.createLinearGradient(0, 0, 0, h);
      gradient.addColorStop(0, current.top);
      gradient.addColorStop(0.55, current.middle);
      gradient.addColorStop(1, current.bottom);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);
      if (current.stars) {
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        for (let i = 0; i < 90; i += 1) {
          const sx = hashUnit(`star${i}x`) * w;
          const sy = hashUnit(`star${i}y`) * h * 0.55;
          ctx.fillRect(sx, sy, hashUnit(`star${i}s`) > 0.85 ? 1.6 : 0.9, hashUnit(`star${i}s`) > 0.85 ? 1.6 : 0.9);
        }
      }
    });
  }
  scene.background = skyTexture(sky);
  scene.fog = new THREE.Fog(sky.fog, 170, 340);

  const camera = new THREE.OrthographicCamera(-50, 50, 50, -50, 0.1, 1000);
  const home = { position: new THREE.Vector3(90, 95, 90), target: new THREE.Vector3(0, 0, 0), zoom: 1 };
  camera.position.copy(home.position);
  camera.lookAt(home.target);

  const controls = new MapControls(camera, renderer.domElement);
  controls.enableDamping = !reducedMotion;
  controls.dampingFactor = 0.08;
  controls.screenSpacePanning = false;
  controls.minZoom = 0.5;
  controls.maxZoom = 7;
  controls.maxPolarAngle = Math.PI / 2.5;
  controls.minPolarAngle = Math.PI / 6;
  controls.target.copy(home.target);

  const hemisphere = new THREE.HemisphereLight(0xf4f8ff, 0xd8ccb2, sky.hemi);
  scene.add(hemisphere);
  const sun = new THREE.DirectionalLight(sky.sun, sky.sunIntensity);
  sun.position.set(70, 110, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.radius = 4;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  Object.assign(sun.shadow.camera, { left: -150, right: 150, top: 150, bottom: -150, near: 1, far: 420 });
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xdfe9ff, 0.6);
  fill.position.set(-80, 60, -60);
  scene.add(fill);

  // Lit windows and street lamps follow the sky (brightest at night); their meaning does not change.
  const litMaterials = new Set();
  const lampMaterials = [];
  const animated = { water: null, jets: [], sparkles: [], clouds: [], foam: null };
  const maxAnisotropy = renderer.capabilities.getMaxAnisotropy?.() ?? 1;

  const pickables = [];
  const labels = [];
  const beacons = [];
  const glows = [];
  const highlightable = new Map();

  function addLabel(text, position, className, { minZoom = 0, priority = LABEL_PRIORITY.city, owner = null } = {}) {
    const node = makeLabel(doc, text, className);
    labelsLayer.append(node);
    const label = { node, position: position.clone(), minZoom, priority, owner, size: null };
    labels.push(label);
    return label;
  }

  function mesh(geometry, material, { x = 0, y = 0, z = 0, shadow = true } = {}) {
    const object = new THREE.Mesh(geometry, material);
    object.position.set(x, y, z);
    object.castShadow = shadow;
    object.receiveShadow = true;
    return object;
  }

  function standard(color, options = {}) {
    return new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0.03, ...options });
  }

  const facadeCache = new Map();
  function facadeTiles(style, wall, lit) {
    const key = `${style}|${new THREE.Color(wall).getHexString()}|${lit}`;
    if (!facadeCache.has(key)) {
      const make = (glowOnly) => {
        const size = FACADE_SIZES[style] ?? 128;
        const texture = canvasTexture(doc, size, size, (ctx, w, h) => drawFacade(ctx, w, h, style, wall, lit, glowOnly));
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.anisotropy = maxAnisotropy;
        return texture;
      };
      facadeCache.set(key, { map: make(false), glow: lit ? make(true) : null });
    }
    return facadeCache.get(key);
  }

  /** A wall material for a face `span` wide and `h` tall: windows on the wall, glowing if the building is lit. */
  function facadeMaterial(style, wall, lit, span, h, options = {}) {
    const tiles = facadeTiles(style, wall, lit);
    const [unitW, unitH] = FACADE_UNITS[style] ?? [1, 1];
    const repeat = unitW === 0 ? [1, Math.max(1, Math.round(h / 1.1))] : [Math.max(1, Math.round(span / unitW)), Math.max(1, Math.round(h / unitH))];
    const map = tiles.map.clone();
    map.needsUpdate = true;
    map.repeat.set(...repeat);
    const glass = style === 'glass';
    const material = standard(0xffffff, { map, roughness: glass ? 0.32 : 0.85, metalness: glass ? 0.18 : 0.02, ...options });
    if (tiles.glow) {
      const glow = tiles.glow.clone();
      glow.needsUpdate = true;
      glow.repeat.copy(map.repeat);
      material.emissive = new THREE.Color(0xffc867);
      material.emissiveMap = glow;
      material.emissiveIntensity = sky.glow;
      litMaterials.add(material);
    }
    return material;
  }

  /** A block with facades on its four walls and a plain roof; stands on y = 0 of its parent. */
  function block(w, h, d, { style = 'office', wall = 0xe9e4da, lit = false, roof = 0xc9c5bb, ...options } = {}) {
    const alongX = facadeMaterial(style, wall, lit, d, h, options);
    const alongZ = facadeMaterial(style, wall, lit, w, h, options);
    const top = standard(roof, { roughness: 0.95, ...options });
    return mesh(new THREE.BoxGeometry(w, h, d), [alongX, alongX, top, top, alongZ, alongZ], { y: h / 2 });
  }

  function register(group, data) {
    group.userData = data;
    pickables.push(group);
    const materials = new Set();
    group.traverse((child) => {
      if (!child.isMesh) return;
      for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
        if (material?.emissive) materials.add(material);
      }
    });
    highlightable.set(group, [...materials].map((material) => ({ material, base: material.emissive.clone(), intensity: material.emissiveIntensity })));
  }

  const roadMaterials = {
    asphalt: standard(0x8e938f, { roughness: 0.95 }),
    walk: standard(0xe4dfd2, { roughness: 1 }),
  };
  const dashTexture = canvasTexture(doc, 8, 64, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(1, 0, w - 2, h * 0.55);
  });
  dashTexture.wrapT = THREE.RepeatWrapping;
  dashTexture.anisotropy = maxAnisotropy;
  function road(from, to, width = 1.9) {
    const length = from.distanceTo(to);
    const angle = -Math.atan2(to.z - from.z, to.x - from.x) + Math.PI / 2;
    const at = { x: (from.x + to.x) / 2, z: (from.z + to.z) / 2 };
    const strip = (stripWidth, material, y, offset = 0) => {
      const surface = mesh(new THREE.PlaneGeometry(stripWidth, length), material, { x: at.x, y, z: at.z, shadow: false });
      surface.rotation.set(-Math.PI / 2, 0, angle);
      if (offset !== 0) surface.translateX(offset);
      scene.add(surface);
    };
    // Sidewalks on both sides, asphalt between, a dashed centre line.
    strip(width + 0.7, roadMaterials.walk, 0.025);
    strip(width, roadMaterials.asphalt, 0.04);
    const dashes = dashTexture.clone();
    dashes.needsUpdate = true;
    dashes.repeat.set(1, Math.max(1, Math.round(length / 1.6)));
    strip(0.1, new THREE.MeshBasicMaterial({ map: dashes, transparent: true, opacity: 0.85, color: 0xf6f3e6 }), 0.055);
  }

  // Trees are many; they are drawn as instanced meshes (trunks, conifers, broadleaves) once the world is built.
  const treePlacements = [];
  function tree(x, z, scale = 1, y = 0) {
    treePlacements.push([x, z, scale, y]);
  }
  function plantTrees() {
    if (treePlacements.length === 0) return;
    const conifers = [];
    const broadleaves = [];
    for (const placement of treePlacements) (hashUnit(`${placement[0]},${placement[1]}k`) < 0.42 ? conifers : broadleaves).push(placement);
    const foliage = (color) => standard(color, { roughness: 0.9, flatShading: true });
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.1, 0.15, 0.8, 6), standard(0x7d6249, { roughness: 1 }), treePlacements.length);
    const lower = new THREE.InstancedMesh(new THREE.ConeGeometry(0.78, 1.3, 7), foliage(0xffffff), Math.max(conifers.length, 1));
    const upper = new THREE.InstancedMesh(new THREE.ConeGeometry(0.55, 1.05, 7), foliage(0xffffff), Math.max(conifers.length, 1));
    const crowns = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.72, 0), foliage(0xffffff), Math.max(broadleaves.length, 1));
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    const tint = new THREE.Color();
    const up = new THREE.Vector3(0, 1, 0);
    const place = (instanced, index, x, y, z, sx, sy, sz, spin) => {
      rotation.setFromAxisAngle(up, spin);
      matrix.compose(new THREE.Vector3(x, y, z), rotation, new THREE.Vector3(sx, sy, sz));
      instanced.setMatrixAt(index, matrix);
    };
    treePlacements.forEach(([x, z, scale, y], index) => place(trunks, index, x, y + 0.4 * scale, z, scale, scale, scale, 0));
    conifers.forEach(([x, z, scale, y], index) => {
      const spin = hashUnit(`${x}${z}s`) * Math.PI;
      const tall = 0.9 + hashUnit(`${z}${x}t`) * 0.35;
      place(lower, index, x, y + 1.15 * scale * tall, z, scale, scale * tall, scale, spin);
      place(upper, index, x, y + 1.85 * scale * tall, z, scale, scale * tall, scale, spin);
      const shade = tint.setHSL(0.37 + (hashUnit(`${x},${z}`) - 0.5) * 0.04, 0.34, 0.3 + hashUnit(`${z},${x}`) * 0.08);
      lower.setColorAt(index, shade);
      upper.setColorAt(index, shade.offsetHSL(0, 0, 0.04));
    });
    broadleaves.forEach(([x, z, scale, y], index) => {
      const squash = 0.85 + hashUnit(`${x}${z}q`) * 0.25;
      place(crowns, index, x, y + 1.25 * scale, z, scale * squash, scale, scale * (1.9 - squash), hashUnit(`${x}${z}s`) * Math.PI);
      crowns.setColorAt(index, tint.setHSL(0.24 + hashUnit(`${x},${z}h`) * 0.08, 0.38, 0.4 + hashUnit(`${z},${x}l`) * 0.12));
    });
    lower.count = conifers.length;
    upper.count = conifers.length;
    crowns.count = broadleaves.length;
    for (const instanced of [trunks, lower, upper, crowns]) {
      instanced.castShadow = true;
      instanced.receiveShadow = true;
      scene.add(instanced);
    }
    treePlacements.length = 0;
  }

  // --- scenery (no data) -----------------------------------------------------
  function pavingTexture() {
    const texture = canvasTexture(doc, 256, 256, (ctx, w, h) => {
      ctx.fillStyle = '#f1ece1';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(176,164,140,0.5)';
      ctx.lineWidth = 1.5;
      for (let r = 16; r < w / 2; r += 18) {
        ctx.beginPath();
        ctx.arc(w / 2, h / 2, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      for (let i = 0; i < 24; i += 1) {
        const a = (i / 24) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(w / 2 + Math.cos(a) * 16, h / 2 + Math.sin(a) * 16);
        ctx.lineTo(w / 2 + Math.cos(a) * w / 2, h / 2 + Math.sin(a) * h / 2);
        ctx.stroke();
      }
    });
    texture.anisotropy = maxAnisotropy;
    return texture;
  }

  const grass = { low: new THREE.Color(0x9fbf8c), high: new THREE.Color(0xd3e4bd), warm: new THREE.Color(0xd9d6a6), sand: new THREE.Color(0xeadfc2) };
  /** Land, beach, sea and a far shore of mountains around the cities; scenery only. */
  function buildTerrain(extent) {
    const landRadius = extent + 22;
    // Land: gentle, non-repeating colour variation (a repeating texture shimmered into stripes).
    const land = mesh(paintVertices(new THREE.RingGeometry(0.01, landRadius, 160, 48), (color, x, y) => {
      const broad = valueNoise(x / 16, y / 16, 'land');
      const fine = valueNoise(x / 4.5, y / 4.5, 'tuft');
      color.copy(grass.low).lerp(grass.high, broad * 0.7 + fine * 0.3);
      if (valueNoise(x / 22, y / 22, 'dry') > 0.68) color.lerp(grass.warm, 0.35);
      const shore = Math.max(0, (Math.hypot(x, y) - (landRadius - 3)) / 3);
      color.lerp(grass.sand, shore * 0.8);
    }), standard(0xffffff, { vertexColors: true, roughness: 1 }), { shadow: false });
    land.rotation.x = -Math.PI / 2;
    land.receiveShadow = true;
    scene.add(land);
    // Beach sloping into the water.
    const beachGeometry = new THREE.RingGeometry(landRadius, landRadius + 5, 160, 3);
    const beachPositions = beachGeometry.attributes.position;
    for (let i = 0; i < beachPositions.count; i += 1) {
      const t = (Math.hypot(beachPositions.getX(i), beachPositions.getY(i)) - landRadius) / 5;
      beachPositions.setZ(i, -t * 0.42);
    }
    beachGeometry.computeVertexNormals();
    const beach = mesh(paintVertices(beachGeometry, (color, x, y) => color.set(0xeadfc2).lerp(new THREE.Color(0xd7c8a3), (Math.hypot(x, y) - landRadius) / 5)), standard(0xffffff, { vertexColors: true, roughness: 1 }), { shadow: false });
    beach.rotation.x = -Math.PI / 2;
    scene.add(beach);
    // Sea: shallow turquoise near the shore, deeper blue further out; a soft line of foam on the beach.
    const sea = mesh(paintVertices(new THREE.RingGeometry(landRadius + 2.5, 760, 160, 24), (color, x, y) => {
      const t = Math.min(1, Math.max(0, (Math.hypot(x, y) - landRadius - 2.5) / 140));
      color.set(0x9ad3d3).lerp(new THREE.Color(0x3f7fa6), Math.sqrt(t));
      color.lerp(new THREE.Color(0xb7dfe3), (valueNoise(x / 9, y / 9, 'swell') - 0.5) * 0.18);
    }), standard(0xffffff, { vertexColors: true, roughness: 0.3, metalness: 0.08 }), { y: -0.36, shadow: false });
    sea.rotation.x = -Math.PI / 2;
    sea.receiveShadow = false;
    scene.add(sea);
    const foam = mesh(new THREE.RingGeometry(landRadius + 4.0, landRadius + 4.7, 160, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false }), { y: -0.35, shadow: false });
    foam.rotation.x = -Math.PI / 2;
    scene.add(foam);
    animated.foam = foam;
    // A far shore: low, faceted mountains across the water, faded by the fog.
    const rock = new THREE.Color(0xa7a497);
    const snow = new THREE.Color(0xf3f5f5);
    for (let i = 0; i < 22; i += 1) {
      const angle = Math.PI * 0.85 + (i / 21) * Math.PI * 0.95 + (hashUnit(`m${i}a`) - 0.5) * 0.08;
      const distance = landRadius + 115 + hashUnit(`m${i}d`) * 55;
      const peak = 10 + hashUnit(`m${i}h`) * 18;
      const radius = 11 + hashUnit(`m${i}r`) * 10;
      const geometry = new THREE.IcosahedronGeometry(1, 2);
      const positions = geometry.attributes.position;
      for (let v = 0; v < positions.count; v += 1) {
        const px = positions.getX(v);
        const py = positions.getY(v);
        const pz = positions.getZ(v);
        const bump = 0.82 + valueNoise(px * 2.2 + i, pz * 2.2, 'ridge') * 0.36;
        positions.setXYZ(v, px * radius * bump, Math.max(0, py) * peak * bump, pz * radius * bump);
      }
      geometry.computeVertexNormals();
      paintVertices(geometry, (color, _x, y) => {
        const t = y / peak;
        color.set(0x86a383).lerp(rock, Math.min(1, t * 1.6));
        if (peak > 20 && t > 0.72) color.lerp(snow, Math.min(1, (t - 0.72) * 5));
      });
      const mountain = mesh(geometry, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), { x: Math.cos(angle) * distance, y: -0.5, z: Math.sin(angle) * distance, shadow: false });
      mountain.rotation.y = hashUnit(`m${i}y`) * Math.PI;
      mountain.receiveShadow = false;
      scene.add(mountain);
    }
    // Clouds drifting over the far water, behind the island, so they never cover a city.
    const cloudMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, flatShading: true });
    animated.cloudMaterial = cloudMaterial;
    for (let i = 0; i < 7; i += 1) {
      const cloud = new THREE.Group();
      const puffs = 3 + Math.floor(hashUnit(`c${i}n`) * 3);
      for (let p = 0; p < puffs; p += 1) {
        const r = 2.6 + hashUnit(`c${i}p${p}`) * 2.4;
        const puff = mesh(new THREE.IcosahedronGeometry(r, 1), cloudMaterial, { x: (p - puffs / 2) * 2.8, y: hashUnit(`c${i}y${p}`) * 1.2, z: (hashUnit(`c${i}z${p}`) - 0.5) * 2.5, shadow: false });
        puff.scale.y = 0.62;
        puff.receiveShadow = false;
        cloud.add(puff);
      }
      cloud.userData = { angle: Math.PI * (0.95 + (i / 6) * 0.6) + (hashUnit(`c${i}a`) - 0.5) * 0.1, distance: landRadius + 34 + hashUnit(`c${i}d`) * 60, height: 24 + hashUnit(`c${i}h`) * 10, speed: 0.00002 + hashUnit(`c${i}s`) * 0.00002, phase: hashUnit(`c${i}f`) * Math.PI * 2 };
      scene.add(cloud);
      animated.clouds.push(cloud);
    }
    placeClouds(0);
    // Keep the sun's shadow map on the land so shadows stay crisp.
    const reach = landRadius + 6;
    Object.assign(sun.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach });
    sun.shadow.camera.updateProjectionMatrix();
    return landRadius;
  }

  function placeClouds(time) {
    for (const cloud of animated.clouds) {
      const { angle, distance, height, speed, phase } = cloud.userData;
      const a = angle + Math.sin(time * speed + phase) * 0.08;
      cloud.position.set(Math.cos(a) * distance, height, Math.sin(a) * distance);
      cloud.rotation.y = -a;
    }
  }

  const lampPlacements = [];
  function streetLamp(x, z, y = 0) {
    lampPlacements.push([x, z, y]);
  }
  function placeLamps() {
    if (lampPlacements.length === 0) return;
    const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.05, 0.07, 1.6, 6), standard(0x3f4844, { roughness: 0.6, metalness: 0.4 }), lampPlacements.length);
    const arms = new THREE.InstancedMesh(new THREE.BoxGeometry(0.42, 0.05, 0.06), standard(0x3f4844, { roughness: 0.6, metalness: 0.4 }), lampPlacements.length);
    const bulbMaterial = standard(0xfff3d6, { emissive: new THREE.Color(0xffd27a), emissiveIntensity: sky.lamps ? 1.8 : 0 });
    lampMaterials.push(bulbMaterial);
    const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.14, 10, 8), bulbMaterial, lampPlacements.length);
    // A warm pool of light on the ground under each lamp, shown only when the lamps are on.
    const falloff = canvasTexture(doc, 64, 64, (ctx, w, h) => {
      const gradient = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      gradient.addColorStop(0, '#ffffff');
      gradient.addColorStop(0.45, '#6b6b6b');
      gradient.addColorStop(1, '#000000');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);
    });
    const poolMaterial = new THREE.MeshBasicMaterial({ color: 0xffc46a, map: falloff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    animated.poolMaterial = poolMaterial;
    const pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(3.4, 3.4).rotateX(-Math.PI / 2), poolMaterial, lampPlacements.length);
    const matrix = new THREE.Matrix4();
    lampPlacements.forEach(([x, z, y], index) => {
      poles.setMatrixAt(index, matrix.makeTranslation(x, y + 0.8, z));
      arms.setMatrixAt(index, matrix.makeTranslation(x + 0.18, y + 1.58, z));
      bulbs.setMatrixAt(index, matrix.makeTranslation(x + 0.36, y + 1.5, z));
      pools.setMatrixAt(index, matrix.makeTranslation(x + 0.36, y + 0.07, z));
    });
    poles.castShadow = true;
    pools.renderOrder = 1;
    scene.add(poles, arms, bulbs, pools);
    applyLampPools();
    lampPlacements.length = 0;
  }
  function applyLampPools() {
    if (animated.poolMaterial) animated.poolMaterial.opacity = sky.lamps ? Math.min(0.55, 0.15 + sky.glow * 0.16) : 0;
  }

  /** Trees and lamps along a road, kept off the plaza and the city plates. */
  function avenue(from, to, keepOut) {
    const length = from.distanceTo(to);
    const dir = to.clone().sub(from).normalize();
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    for (let d = 3; d < length - 2; d += 4.2) {
      const point = from.clone().addScaledVector(dir, d);
      if (keepOut(point)) continue;
      const index = Math.round(d / 4.2);
      for (const sign of [-1, 1]) {
        const at = point.clone().addScaledVector(side, sign * 1.9);
        if (index % 3 === 0 && sign === 1) streetLamp(at.x, at.z);
        else tree(at.x, at.z, 0.55 + hashUnit(`${from.x}${d}${sign}`) * 0.2);
      }
    }
  }

  /** Groves and fields between the cities; scenery only (no houses, which could read as engagements). */
  function countryside(landRadius, cities, roads) {
    const blocked = (x, z, margin) => {
      if (Math.hypot(x, z) < PLAZA_RADIUS + 8) return true;
      if (Math.hypot(x, z) > landRadius - 4) return true;
      if (cities.some((city) => Math.hypot(x - city.x, z - city.z) < city.size * 0.8 + margin)) return true;
      return roads.some(([a, b]) => {
        const ab = b.clone().sub(a);
        const t = Math.max(0, Math.min(1, new THREE.Vector3(x, 0, z).sub(a).dot(ab) / ab.lengthSq()));
        return a.clone().addScaledVector(ab, t).distanceTo(new THREE.Vector3(x, 0, z)) < margin;
      });
    };
    let groves = 0;
    for (let i = 0; i < 90 && groves < 26; i += 1) {
      const angle = hashUnit(`grove${i}a`) * Math.PI * 2;
      const radius = PLAZA_RADIUS + 10 + hashUnit(`grove${i}r`) * (landRadius - PLAZA_RADIUS - 14);
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      if (blocked(x, z, 4)) continue;
      groves += 1;
      if (hashUnit(`grove${i}k`) > 0.7) {
        // A field: a flat patch in a crop colour.
        const field = mesh(new THREE.PlaneGeometry(6 + hashUnit(`f${i}w`) * 5, 4 + hashUnit(`f${i}h`) * 4), new THREE.MeshLambertMaterial({ color: hashUnit(`f${i}c`) > 0.5 ? 0xe7dca0 : 0xbfd69b }), { x, y: 0.02, z, shadow: false });
        field.rotation.set(-Math.PI / 2, 0, hashUnit(`f${i}r`) * Math.PI);
        scene.add(field);
        continue;
      }
      const count = 4 + Math.floor(hashUnit(`grove${i}n`) * 6);
      for (let t = 0; t < count; t += 1) {
        const a = hashUnit(`grove${i}t${t}a`) * Math.PI * 2;
        const r = hashUnit(`grove${i}t${t}r`) * 3.2;
        tree(x + Math.cos(a) * r, z + Math.sin(a) * r, 0.6 + hashUnit(`grove${i}t${t}s`) * 0.5);
      }
    }
  }

  function applySky() {
    sky = skyAt(new Date().getHours(), skyMode);
    scene.background?.dispose?.();
    scene.background = skyTexture(sky);
    scene.fog.color.setHex(sky.fog);
    sun.color.setHex(sky.sun);
    sun.intensity = sky.sunIntensity;
    hemisphere.intensity = sky.hemi;
    renderer.toneMappingExposure = sky.exposure;
    for (const material of litMaterials) if (!highlightedMaterials.has(material)) material.emissiveIntensity = sky.glow;
    for (const material of lampMaterials) material.emissiveIntensity = sky.lamps ? 1.8 : 0;
    applyLampPools();
    animated.cloudMaterial?.color.set(sky.phase === 'night' ? 0x5a6782 : sky.phase === 'dusk' ? 0xf4d6c6 : 0xffffff);
  }
  const highlightedMaterials = new Set();

  // --- plaza ---------------------------------------------------------------
  function buildPlaza(rows, rowItems, waitingOf, now) {
    const plaza = new THREE.Group();
    plaza.add(mesh(new THREE.CylinderGeometry(PLAZA_RADIUS + 2.2, PLAZA_RADIUS + 2.6, 0.3, 64), standard(0x9fbf9d, { roughness: 1 }), { y: 0.15 }));
    plaza.add(mesh(new THREE.CylinderGeometry(PLAZA_RADIUS, PLAZA_RADIUS + 0.4, 0.7, 64), standard(0xf3efe6, { roughness: 0.9 }), { y: 0.35 }));
    plaza.add(mesh(new THREE.TorusGeometry(PLAZA_RADIUS - 0.3, 0.08, 6, 64), standard(0xd8cfbd), { y: 0.72 }));
    plaza.children[2].rotation.x = Math.PI / 2;
    const paving = mesh(new THREE.CircleGeometry(PLAZA_RADIUS - 0.05, 64), standard(0xffffff, { map: pavingTexture(), roughness: 0.95 }), { y: 0.705, shadow: false });
    paving.rotation.x = -Math.PI / 2;
    plaza.add(paving);
    if (rows.length !== 1) {
      // A fountain in the middle of the plaza (scenery; the kinds of judgment stand around it).
      plaza.add(mesh(new THREE.CylinderGeometry(1.5, 1.7, 0.45, 32), standard(0xd9d1c1), { y: 0.92 }));
      const pool = mesh(new THREE.CircleGeometry(1.3, 32), standard(0x9fd0de, { roughness: 0.2, metalness: 0.1 }), { y: 1.15, shadow: false });
      pool.rotation.x = -Math.PI / 2;
      plaza.add(pool);
      plaza.add(mesh(new THREE.CylinderGeometry(0.18, 0.24, 0.9, 12), standard(0xd9d1c1), { y: 1.5 }));
      const jet = mesh(new THREE.CylinderGeometry(0.05, 0.16, 1.2, 10), new THREE.MeshBasicMaterial({ color: 0xe8f6fb, transparent: true, opacity: 0.7 }), { y: 2.5, shadow: false });
      plaza.add(jet);
      animated.jets.push(jet);
    }
    scene.add(plaza);
    register(plaza, { kind: 'plaza' });
    addLabel('広場（判断）', new THREE.Vector3(0, 0.8, PLAZA_RADIUS + 2.8), 'is-plaza', { priority: LABEL_PRIORITY.plaza });
    for (let i = 0; i < 10; i += 1) {
      const angle = (i / 10) * Math.PI * 2 + 0.3;
      tree(Math.cos(angle) * (PLAZA_RADIUS + 1.3), Math.sin(angle) * (PLAZA_RADIUS + 1.3), 0.7);
    }
    rows.forEach((row, index) => {
      const angle = (index / Math.max(rows.length, 1)) * Math.PI * 2 - Math.PI / 2;
      const r = rows.length === 1 ? 0 : PLAZA_RADIUS * 0.56;
      const total = row.counts.continued + row.counts.returned;
      const height = 1.6 + Math.log2(1 + total) * 1.7;
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;
      const recent = Number.isFinite(Date.parse(row.latest_recorded_at)) && now - Date.parse(row.latest_recorded_at) < RECENT_MS;
      const group = new THREE.Group();
      group.position.set(x, 0.7, z);
      const color = STATE_COLORS[row.state] ?? 0x929b95;
      group.add(mesh(new THREE.BoxGeometry(2.7, 0.25, 2.7), standard(0xe6ded0), { y: 0.12 }));
      const wall = new THREE.Color(color);
      const body = block(2.1, height, 2.1, { style: 'civic', wall, lit: recent, roof: 0xd9d3c6 });
      body.position.y += 0.25;
      group.add(body);
      group.add(mesh(new THREE.BoxGeometry(2.3, 0.14, 2.3), standard(0xf3efe6), { y: 0.25 + height + 0.07 }));
      const cap = block(1.4, 0.56, 1.4, { style: 'civic', wall, lit: recent, roof: 0xd9d3c6 });
      cap.position.y += 0.25 + height + 0.14;
      group.add(cap);
      scene.add(group);
      register(group, { kind: 'judgment', row, items: rowItems.get(row.key) ?? [] });
      const top = 0.7 + 0.25 + height + 0.7;
      markers.plaza.set(row.key, new THREE.Vector3(x, top, z));
      const waiting = waitingOf(row);
      if (waiting > 0) {
        const beam = mesh(new THREE.CylinderGeometry(0.22, 0.22, 16, 12), new THREE.MeshBasicMaterial({ color: 0xd92335, transparent: true, opacity: 0.55 }), { x, y: top + 8, z, shadow: false });
        scene.add(beam);
        beacons.push(beam);
      }
      if (row.counts.corrected_or_reverted > 0) {
        scene.add(mesh(new THREE.BoxGeometry(0.08, 1.4, 0.08), standard(0x1e2822), { x, y: top + 0.7, z }));
        scene.add(mesh(new THREE.BoxGeometry(0.9, 0.55, 0.06), standard(0xd92335, { emissive: new THREE.Color(0x5a0b13) }), { x: x + 0.48, y: top + 1.1, z }));
      }
      if (recent) {
        const ring = mesh(new THREE.RingGeometry(1.7, 1.95, 40), new THREE.MeshBasicMaterial({ color: 0xffc867, transparent: true, opacity: 0.6, side: THREE.DoubleSide }), { x, y: 0.74, z, shadow: false });
        ring.rotation.x = -Math.PI / 2;
        scene.add(ring);
        glows.push(ring);
      }
      const stateText = row.state === 'returned' && waiting === 0 ? '戻した・会話で先に進んだ' : STATE_LABELS[row.state] ?? row.state;
      addLabel(`${rowLabel(row)}・${stateText}`, new THREE.Vector3(x, top + 0.2, z), `is-judgment is-${row.state}${waiting > 0 ? ' is-waiting' : ''}`, { minZoom: 1.6, priority: waiting > 0 ? LABEL_PRIORITY.plaza : LABEL_PRIORITY.judgment, owner: group });
    });
  }

  // --- cities ----------------------------------------------------------------
  // The form says the business's kind; the height and the lit windows say its last 30 days.  Everything
  // else on a building (podium, cornice, roof plant, portico) is detail and means nothing on its own.
  function rooftopPlant(group, y, span, options) {
    const metal = standard(0xb7bcbc, { roughness: 0.6, metalness: 0.3, ...options });
    group.add(mesh(new THREE.BoxGeometry(span * 0.32, 0.32, span * 0.22), metal, { x: -span * 0.18, y: y + 0.16, z: span * 0.12 }));
    group.add(mesh(new THREE.BoxGeometry(span * 0.18, 0.24, span * 0.18), metal, { x: span * 0.22, y: y + 0.12, z: -span * 0.2 }));
    group.add(mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.5, 12), standard(0xd8d4ca, options), { x: span * 0.24, y: y + 0.25, z: span * 0.2 }));
  }

  function landmark(form, color, height, status, active = true) {
    const group = new THREE.Group();
    const phase = statusPhase(status);
    const concept = phase === 'concept';
    // Windows are lit only when something happened in the last 30 days.
    const lit = !concept && active;
    const tone = phase === 'maintenance' ? muted(color, 0.55) : new THREE.Color(color);
    const options = concept ? { transparent: true, opacity: 0.38 } : {};
    const stone = phase === 'maintenance' ? muted(0xe7e2d6, 0.3) : new THREE.Color(0xe7e2d6);
    const at = (object, y) => {
      object.position.y += y;
      group.add(object);
      return object;
    };
    if (form === 'tower') {
      // A glass tower on a stone podium, set back once, with a crown and a mast (total height × 1.45).
      const podium = Math.min(1.1, height * 0.2);
      at(block(3.8, podium, 3.8, { style: 'office', wall: stone, lit, roof: 0xcfcac0, ...options }), 0);
      at(block(3, height - podium, 3, { style: 'glass', wall: tone, lit, roof: 0xd5d8d6, roughness: 0.3, ...options }), podium);
      at(block(2.2, height * 0.45, 2.2, { style: 'glass', wall: tone, lit, roof: 0xd5d8d6, roughness: 0.3, ...options }), height);
      group.add(mesh(new THREE.BoxGeometry(2.45, 0.16, 2.45), standard(0xf1f1ee, options), { y: height * 1.45 + 0.08 }));
      group.add(mesh(new THREE.BoxGeometry(3.15, 0.12, 3.15), standard(0xf1f1ee, options), { y: height + 0.06 }));
      rooftopPlant(group, height + 0.12, 3, options);
      group.add(mesh(new THREE.CylinderGeometry(0.04, 0.07, 1.6, 6), standard(0x5a6460, { metalness: 0.5, roughness: 0.4 }), { y: height * 1.45 + 0.96 }));
      group.add(mesh(new THREE.SphereGeometry(0.09, 8, 6), standard(0xffffff, { emissive: new THREE.Color(0xffffff), emissiveIntensity: 0.4 }), { y: height * 1.45 + 1.8 }));
    } else if (form === 'hall') {
      // A brick hall with a pitched roof in the kind's colour and a columned entrance.
      const bodyHeight = height * 0.55;
      const wall = new THREE.Color(0xf0e6d6).lerp(tone, 0.28);
      at(block(4.4, bodyHeight, 3, { style: 'brick', wall, lit, roof: 0x9b8f80, ...options }), 0);
      group.add(mesh(new THREE.BoxGeometry(4.6, 0.14, 3.2), standard(0xf5f1e8, options), { y: bodyHeight + 0.07 }));
      const roof = mesh(gableRoof(3.2, 4.6, 1.45), standard(tone.clone().multiplyScalar(0.82), { roughness: 0.75, ...options }), { y: bodyHeight + 0.14 });
      roof.rotation.y = Math.PI / 2;
      group.add(roof);
      group.add(mesh(new THREE.BoxGeometry(0.42, 0.9, 0.42), standard(0x9c7a62, options), { x: 1.2, y: bodyHeight + 0.9, z: -0.6 }));
      // Portico on the side that faces the default camera.
      const columnHeight = Math.max(0.9, bodyHeight * 0.72);
      group.add(mesh(new THREE.BoxGeometry(3, 0.16, 1.1), standard(0xebe5d9, options), { y: 0.08, z: 2.05 }));
      for (let c = 0; c < 4; c += 1) group.add(mesh(new THREE.CylinderGeometry(0.11, 0.13, columnHeight, 10), standard(0xf7f4ee, options), { x: -1.2 + c * 0.8, y: 0.16 + columnHeight / 2, z: 2.25 }));
      const pediment = mesh(gableRoof(3.1, 1.1, 0.55), standard(0xf7f4ee, options), { y: 0.16 + columnHeight, z: 2.05 });
      group.add(pediment);
      group.add(mesh(new THREE.BoxGeometry(0.7, Math.min(1.1, columnHeight * 0.8), 0.06), standard(0x6e5442, options), { y: 0.16 + Math.min(1.1, columnHeight * 0.8) / 2, z: 1.52 }));
    } else if (form === 'dome') {
      // A research hall: a windowed drum under a faceted dome with a lantern, and a low wing.
      const drumHeight = height * 0.5;
      const drum = mesh(new THREE.CylinderGeometry(1.9, 2.05, drumHeight, 32, 1, true), facadeMaterial('research', tone, lit, 2 * Math.PI * 1.9, drumHeight, options), { y: drumHeight / 2 });
      group.add(drum);
      group.add(mesh(new THREE.TorusGeometry(2.0, 0.12, 6, 40).rotateX(Math.PI / 2), standard(0xf3f1ea, options), { y: drumHeight }));
      group.add(mesh(new THREE.SphereGeometry(1.95, 18, 9, 0, Math.PI * 2, 0, Math.PI / 2), standard(0xeef2f4, { roughness: 0.28, metalness: 0.25, flatShading: true, ...options }), { y: drumHeight }));
      group.add(mesh(new THREE.CylinderGeometry(0.32, 0.36, 0.5, 12), standard(0xf3f1ea, options), { y: drumHeight + 1.95 + 0.2 }));
      group.add(mesh(new THREE.ConeGeometry(0.42, 0.45, 12), standard(tone.clone().multiplyScalar(0.85), options), { y: drumHeight + 1.95 + 0.67 }));
      const wing = at(block(2.4, Math.max(0.9, drumHeight * 0.45), 1.5, { style: 'office', wall: stone, lit, roof: 0xcfcac0, ...options }), 0);
      wing.position.set(-1.9, wing.position.y, 1.2);
    } else {
      // An office: a main block and a lower wing, with a parapet and roof plant.
      const mainHeight = height * 0.75;
      const wall = new THREE.Color(0xeeeae2).lerp(tone, 0.35);
      at(block(3.6, mainHeight, 2.8, { style: 'office', wall, lit, roof: 0xc4c0b6, ...options }), 0);
      group.add(mesh(new THREE.BoxGeometry(3.72, 0.16, 2.92), standard(0xf3f1ec, options), { y: mainHeight + 0.08 }));
      rooftopPlant(group, mainHeight + 0.16, 2.8, options);
      const wing = at(block(1.9, Math.max(0.8, mainHeight * 0.5), 2.1, { style: 'office', wall: stone, lit, roof: 0xc4c0b6, ...options }), 0);
      wing.position.set(1.95, wing.position.y, 1.0);
    }
    if (concept) {
      // Scaffold outline: a business that is still a concept.
      const outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(3.2, height * 1.2, 3.2)), new THREE.LineBasicMaterial({ color: 0x46524a }));
      outline.position.y = height * 0.6;
      group.add(outline);
    }
    return group;
  }

  const HOUSE_WALLS = [0xf4efe4, 0xefe6d6, 0xf2ece6, 0xe9e4d6];
  function house(engagement, color) {
    const group = new THREE.Group();
    const status = engagement.status;
    const phase = statusPhase(status);
    if (phase === 'finished') {
      // A finished engagement becomes a small memorial park: a lawn edged by hedges, a stone, a bench.
      group.add(mesh(new THREE.BoxGeometry(1.9, 0.14, 1.9), standard(0xa6c796, { roughness: 1 }), { y: 0.07 }));
      const hedge = standard(0x6f9a68, { roughness: 1 });
      for (const [hx, hz, hw, hd] of [[0, -0.88, 1.9, 0.16], [-0.88, 0, 0.16, 1.9], [0.88, 0.35, 0.16, 1.2]]) group.add(mesh(new THREE.BoxGeometry(hw, 0.26, hd), hedge, { x: hx, y: 0.24, z: hz }));
      group.add(mesh(new THREE.BoxGeometry(0.5, 0.12, 0.5), standard(0xcfc8b8), { y: 0.2 }));
      group.add(mesh(new THREE.BoxGeometry(0.24, 0.85, 0.24), standard(0xdcd5c6), { y: 0.68 }));
      group.add(mesh(new THREE.ConeGeometry(0.18, 0.24, 4).rotateY(Math.PI / 4), standard(0xdcd5c6), { y: 1.22 }));
      group.add(mesh(new THREE.BoxGeometry(0.7, 0.08, 0.24), standard(0x9a7b5c), { x: 0.2, y: 0.32, z: 0.62 }));
      group.add(mesh(new THREE.IcosahedronGeometry(0.26, 0), standard(0x7fa877, { roughness: 1, flatShading: true }), { x: -0.5, y: 0.34, z: 0.45 }));
      group.userData.finished = true;
      return group;
    }
    // One house per engagement; the roof takes the kind's colour, lit windows mean the engagement is active.
    const h = 0.9 + hashUnit(engagement.id) * 1.1;
    const wall = phase === 'maintenance' ? muted(color, 0.6) : new THREE.Color(HOUSE_WALLS[Math.floor(hashUnit(`${engagement.id}w`) * HOUSE_WALLS.length)]);
    const turned = hashUnit(`${engagement.id}r`) > 0.5;
    group.add(block(1.6, h, 1.4, { style: 'house', wall, lit: phase === 'active', roof: 0xb9b2a5 }));
    const roofColor = phase === 'maintenance' ? muted(color, 0.6) : new THREE.Color(color).multiplyScalar(0.9);
    const roof = mesh(gableRoof(turned ? 1.4 : 1.6, turned ? 1.6 : 1.4, 0.8).scale(1.08, 1, 1.08), standard(roofColor, { roughness: 0.7 }), { y: h });
    roof.rotation.y = turned ? Math.PI / 2 : 0;
    group.add(roof);
    group.add(mesh(new THREE.BoxGeometry(0.22, 0.55, 0.22), standard(0x9c7a62), { x: 0.42, y: h + 0.45, z: -0.25 }));
    group.add(mesh(new THREE.BoxGeometry(0.34, 0.58, 0.05), standard(0x7a5a43), { y: 0.29, z: 0.72 }));
    group.add(mesh(new THREE.BoxGeometry(0.52, 0.05, 0.22), standard(0xe2ddd2), { y: 0.62, z: 0.8 }));
    return group;
  }

  function judgmentHall(judgments) {
    const group = new THREE.Group();
    const waiting = judgments.some((entry) => isWaiting(entry.item));
    const returned = judgments.some((entry) => entry.item?.section === 'needs_human');
    const blocked = judgments.some((entry) => entry.item?.section === 'blocked');
    const color = waiting || returned ? 0xd92335 : blocked ? 0xc99a3a : 0x087d62;
    const h = 1 + Math.log2(1 + judgments.length) * 0.9;
    group.add(mesh(new THREE.CylinderGeometry(1, 1.15, 0.3, 20), standard(0xe6ded0), { y: 0.15 }));
    group.add(mesh(new THREE.CylinderGeometry(0.75, 0.8, h, 16), standard(waiting || returned ? muted(color, 0.25) : new THREE.Color(0xf4f1ea)), { y: 0.3 + h / 2 }));
    group.add(mesh(new THREE.ConeGeometry(1.05, 0.9, 16), standard(color), { y: 0.3 + h + 0.45 }));
    group.userData.top = 0.3 + h + 0.9;
    group.userData.waiting = waiting;
    return group;
  }

  const markers = { cities: new Map(), plaza: new Map() };
  /** code → { city (layout), group, label } */
  const cityIndex = new Map();
  function buildCities({ cities, sectors, extent }, judgmentsByBusiness = new Map()) {
    fitExtent(extent);
    const landRadius = buildTerrain(extent);
    const roads = [];
    const keepOut = (point) => Math.hypot(point.x, point.z) < PLAZA_RADIUS + 5
      || cities.some((city) => Math.hypot(point.x - city.x, point.z - city.z) < city.size * 0.62 + 1.2);
    for (let i = 0; i < 12; i += 1) {
      const angle = (i / 12) * Math.PI * 2;
      road(new THREE.Vector3(Math.cos(angle) * (PLAZA_RADIUS + 4), 0, Math.sin(angle) * (PLAZA_RADIUS + 4)), new THREE.Vector3(Math.cos(angle + Math.PI / 6) * (PLAZA_RADIUS + 4), 0, Math.sin(angle + Math.PI / 6) * (PLAZA_RADIUS + 4)), 1.5);
    }
    for (const city of cities) {
      const { business, size, x, z, kind } = city;
      const entry = kindEntry(kind);
      const color = kindColor(kind);
      const start = new THREE.Vector3(x, 0, z).setLength(PLAZA_RADIUS + 4);
      road(start, new THREE.Vector3(x, 0, z));
      roads.push([start, new THREE.Vector3(x, 0, z)]);
      avenue(start, new THREE.Vector3(x, 0, z), keepOut);
      const group = new THREE.Group();
      group.position.set(x, 0, z);
      // A city block: a curb step, a paved block in a hint of the kind's colour, lamps on its corners.
      group.add(mesh(roundedPlate(size + 0.9, size + 0.9, 0.18, 2.0), standard(0xcfc9bb, { roughness: 1 })));
      const plateColor = new THREE.Color(0xf3f1ea).lerp(new THREE.Color(color), 0.08);
      group.add(mesh(roundedPlate(size, size, 0.45, 1.6), standard(plateColor, { roughness: 0.95 })));
      for (const [cx, cz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) streetLamp(x + cx * (size / 2 - 0.9), z + cz * (size / 2 - 0.9), 0.45);
      const measures = cityMeasures(business, { isFinished, judgments: judgmentsByBusiness.get(business.code) ?? [] });
      const towerHeight = measures.towerHeight;
      group.add(landmark(entry.form, color, towerHeight, business.status, measures.lit));
      scene.add(group);
      register(group, { kind: 'city', business });
      const top = entry.form === 'tower' ? towerHeight * 1.45 + 1.8 : towerHeight + 1;
      markers.cities.set(business.code, new THREE.Vector3(x, top, z));
      cityIndex.set(business.code, { city, group, label: null });
      const cityLabel = addLabel(statusPhase(business.status) === 'concept' ? `${business.name}（${statusText(business.status)}）` : business.name, new THREE.Vector3(x, top, z), 'is-city', { priority: LABEL_PRIORITY.city, owner: group });
      cityLabel.node.style.borderColor = `${entry.color}80`;
      // The name is a way in too (AC-20): pressing it enters the district, as pressing the city does.
      cityLabel.node.classList.add('is-enterable');
      cityLabel.node.title = `${business.name}の区画に入る`;
      cityLabel.node.addEventListener('click', () => {
        select(group);
        onPick(group.userData, new THREE.Box3().setFromObject(group).getCenter(new THREE.Vector3()));
      });
      cityIndex.get(business.code).label = cityLabel;
      cityLabel.business = business;
      const n = business.engagements.length;
      const step = 2.5;
      const { cols, cells } = districtLots(n, step);
      cells.sort((a, b) => Math.hypot(...a) - Math.hypot(...b));
      business.engagements.forEach((engagement, index) => {
        const [cx, cz] = cells[index % cells.length];
        const lot = house(engagement, color);
        const finished = lot.userData.finished === true;
        lot.position.set(x + cx * (size / (cols * step + 2)), 0.45, z + cz * (size / (cols * step + 2)));
        scene.add(lot);
        register(lot, { kind: 'engagement', engagement, business, finished });
        const label = addLabel(finished ? `${engagement.name}（${statusText(engagement.status)}）` : engagement.name, new THREE.Vector3(lot.position.x, 2.6, lot.position.z), `is-engagement${finished ? ' is-finished' : ''}`, { minZoom: 3.4, priority: LABEL_PRIORITY.engagement, owner: lot });
        label.business = business;
      });
      const judgments = judgmentsByBusiness.get(business.code) ?? [];
      if (judgments.length > 0) {
        const hall = judgmentHall(judgments);
        hall.position.set(x + size * 0.34, 0.45, z - size * 0.34);
        scene.add(hall);
        register(hall, { kind: 'cityJudgments', business, judgments });
        const top = 0.45 + hall.userData.top;
        if (hall.userData.waiting) {
          const beam = mesh(new THREE.CylinderGeometry(0.22, 0.22, 16, 12), new THREE.MeshBasicMaterial({ color: 0xd92335, transparent: true, opacity: 0.55 }), { x: hall.position.x, y: top + 8, z: hall.position.z, shadow: false });
          scene.add(beam);
          beacons.push(beam);
        }
        const hallLabel = addLabel(`判断 ${judgments.length}件`, new THREE.Vector3(hall.position.x, top + 0.2, hall.position.z), `is-hall${hall.userData.waiting ? ' is-waiting' : ''}`, { minZoom: 1.3, priority: LABEL_PRIORITY.judgment, owner: hall });
        hallLabel.business = business;
      }
      const treeCount = 2 + Math.floor(hashUnit(business.id) * 3);
      for (let t = 0; t < treeCount; t += 1) {
        const a = hashUnit(`${business.id}${t}`) * Math.PI * 2;
        tree(x + Math.cos(a) * size * 0.42, z + Math.sin(a) * size * 0.42, 0.8, 0.45);
      }
    }
    countryside(landRadius, cities, roads);
    plantTrees();
    placeLamps();
    for (const { kind, angle } of sectors) {
      addLabel(kindEntry(kind).label, new THREE.Vector3(Math.cos(angle) * 21, 0.2, Math.sin(angle) * 21), 'is-sector', { priority: LABEL_PRIORITY.sector });
    }
  }

  // --- selection & hover -------------------------------------------------
  const selectionRing = mesh(new THREE.RingGeometry(1, 1.035, 96), new THREE.MeshBasicMaterial({ color: 0x087d62, transparent: true, opacity: 0.9, side: THREE.DoubleSide }), { y: 0.08, shadow: false });
  selectionRing.rotation.x = -Math.PI / 2;
  selectionRing.visible = false;
  scene.add(selectionRing);
  let selected = null;
  let hovered = null;

  /** The name label of a city group, to say "enter" next to it while the pointer is on the city. */
  function labelOfCity(group) {
    if (group?.userData?.kind !== 'city') return null;
    return cityIndex.get(group.userData.business.code)?.label ?? null;
  }

  function setHighlight(group, on) {
    for (const entry of highlightable.get(group) ?? []) {
      if (on) {
        highlightedMaterials.add(entry.material);
        entry.material.emissive.set(0x3d8f74);
        entry.material.emissiveIntensity = 0.35;
      } else {
        highlightedMaterials.delete(entry.material);
        entry.material.emissive.copy(entry.base);
        entry.material.emissiveIntensity = litMaterials.has(entry.material) ? sky.glow : entry.intensity;
      }
    }
  }

  function select(group) {
    selected = group;
    if (!group) {
      selectionRing.visible = false;
      return;
    }
    const box3 = new THREE.Box3().setFromObject(group);
    const sizeVector = box3.getSize(new THREE.Vector3());
    const radius = Math.max(sizeVector.x, sizeVector.z) * 0.62 + 0.4;
    selectionRing.scale.set(radius, radius, 1);
    const ringY = group.userData.kind === 'judgment' ? 0.76 : group.userData.kind === 'site' ? 0.1 : 0.6;
    selectionRing.position.set((box3.min.x + box3.max.x) / 2, ringY, (box3.min.z + box3.max.z) / 2);
    selectionRing.visible = true;
  }

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  function pickAt(clientX, clientY) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    for (const hit of raycaster.intersectObjects(pickables, true)) {
      let object = hit.object;
      while (object && !pickables.includes(object)) object = object.parent;
      if (object) return object;
    }
    return null;
  }

  let downAt = null;
  let pendingHover = null;
  renderer.domElement.addEventListener('pointerdown', (event) => {
    downAt = { x: event.clientX, y: event.clientY };
  });
  renderer.domElement.addEventListener('pointermove', (event) => {
    pendingHover = { x: event.clientX, y: event.clientY };
  });
  renderer.domElement.addEventListener('pointerleave', () => {
    pendingHover = null;
    labelOfCity(hovered)?.node.classList.remove('is-hover');
    if (hovered) setHighlight(hovered, false);
    hovered = null;
  });
  renderer.domElement.addEventListener('pointerup', (event) => {
    if (!downAt || Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y) > 5) return;
    const group = pickAt(event.clientX, event.clientY);
    if (group) {
      select(group);
      const center = new THREE.Box3().setFromObject(group).getCenter(new THREE.Vector3());
      onPick(group.userData, center);
    } else {
      select(null);
      onClear();
    }
  });
  renderer.domElement.addEventListener('keydown', (event) => {
    // Escape goes one level up; the view decides what that level is.
    if (event.key === 'Escape' && !event.defaultPrevented) onEscape();
  });

  let flight = null;
  function flyTo(target, zoom) {
    const offset = camera.position.clone().sub(controls.target);
    const to = { target: new THREE.Vector3(target.x, 0, target.z), position: new THREE.Vector3(target.x, 0, target.z).add(offset), zoom };
    if (reducedMotion) {
      controls.target.copy(to.target);
      camera.position.copy(to.position);
      camera.zoom = zoom;
      camera.updateProjectionMatrix();
      return;
    }
    controls.enabled = false;
    flight = { from: { target: controls.target.clone(), position: camera.position.clone(), zoom: camera.zoom }, to, t: 0 };
  }

  function resetView() {
    flyTo(home.target, home.zoom);
  }

  // --- the work inside a city (sites, signs, roads between businesses) -------
  const signTextures = new Map();
  function signTexture(kind) {
    if (!signTextures.has(kind)) {
      signTextures.set(kind, canvasTexture(doc, 64, 64, (ctx, w, h) => {
        ctx.fillStyle = kind === 'unreadable' ? '#8a9096' : '#e3a21a';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 44px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(kind === 'unreadable' ? '…' : '?', w / 2, h / 2 + 2);
      }));
    }
    return signTextures.get(kind);
  }
  /** A small sign on a pole: amber '?' (something cannot be seen) or grey '…' (could not be read). */
  function sign(kind, height = 1.2, boardSize = 0.5) {
    const group = new THREE.Group();
    group.add(mesh(new THREE.CylinderGeometry(0.035, 0.045, height, 6), standard(0x4b524e), { y: height / 2 }));
    const face = new THREE.MeshBasicMaterial({ map: signTexture(kind) });
    const edge = standard(0xf3efe6);
    group.add(mesh(new THREE.BoxGeometry(boardSize, boardSize, 0.06), [edge, edge, edge, edge, face, face], { y: height + boardSize / 2 - 0.05 }));
    return group;
  }

  const citySigns = [];
  /** Signs over the cities from the work summary; a city without one has no gap, or its work is not connected. */
  function setWorkSigns(summaries) {
    for (const post of citySigns.splice(0)) scene.remove(post);
    for (const [code, entry] of cityIndex) {
      const summary = summaries?.[code];
      entry.label?.node.querySelector('.bb-world-badge')?.remove();
      if (entry.label) entry.label.size = null;
      const signal = workSign(summary);
      if (!signal) continue;
      const { text } = signal;
      const unreadable = signal.kind === 'unreadable';
      const { city } = entry;
      const post = sign(unreadable ? 'unreadable' : 'check', 2.2, 0.9);
      post.position.set(city.x - city.size / 2 + 0.6, 0.45, city.z + city.size / 2 - 0.6);
      scene.add(post);
      citySigns.push(post);
      if (entry.label) entry.label.node.append(el(doc, 'span', { className: `bb-world-badge ${unreadable ? 'is-unreadable' : 'is-check'}`, text }));
    }
  }

  const workLayer = { group: null, code: null, labels: [] };
  function clearWork() {
    if (workLayer.group) scene.remove(workLayer.group);
    for (const label of workLayer.labels) {
      label.node.remove();
      const index = labels.indexOf(label);
      if (index !== -1) labels.splice(index, 1);
    }
    workLayer.group = null;
    workLayer.code = null;
    workLayer.labels = [];
  }

  /** An arc between two cities: solid for a recorded relation, dashed for an inferred one. */
  function cityLink(from, to, link) {
    const a = new THREE.Vector3(from.x, 1.2, from.z);
    const b = new THREE.Vector3(to.x, 1.2, to.z);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    mid.y = 4 + a.distanceTo(b) * 0.12;
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
    const material = new THREE.MeshBasicMaterial({ color: link === 'recorded' ? 0x1261ad : 0x7a6a9e, transparent: true, opacity: 0.85, fog: false });
    const group = new THREE.Group();
    if (link === 'recorded') {
      group.add(mesh(new THREE.TubeGeometry(curve, 48, 0.12, 6), material, { shadow: false }));
    } else {
      const segments = 28;
      for (let i = 0; i < segments; i += 2) {
        const piece = new THREE.CatmullRomCurve3([curve.getPoint(i / segments), curve.getPoint((i + 0.5) / segments), curve.getPoint((i + 1) / segments)]);
        group.add(mesh(new THREE.TubeGeometry(piece, 4, 0.1, 6), material, { shadow: false }));
      }
    }
    return { group, mid: curve.getPoint(0.5) };
  }

  /** Draws the roads from one city to the businesses its work relates to (its work itself is inside its district). */
  function showWork(code, work) {
    clearWork();
    const entry = cityIndex.get(code);
    if (!entry || work?.status !== 'ok') return;
    const { city } = entry;
    const layer = new THREE.Group();
    // Roads to other businesses: recorded relations solid; decisions found only by their titles dashed.
    const links = new Map();
    for (const relation of work.relations) {
      if (!relation.business_code || relation.link === 'unreadable') continue;
      const key = `${relation.business_code}|${relation.link}`;
      links.set(key, [...(links.get(key) ?? []), relation.label]);
    }
    for (const policy of work.purpose.policies) {
      if (policy.link !== 'inferred' || !policy.scope_code || policy.scope_code === code || !cityIndex.has(policy.scope_code)) continue;
      const key = `${policy.scope_code}|inferred`;
      links.set(key, links.get(key) ?? []);
    }
    for (const [key, texts] of links) {
      const [otherCode, link] = key.split('|');
      const other = cityIndex.get(otherCode);
      if (!other) continue;
      const inferredDecisions = link === 'inferred' ? work.purpose.policies.filter((policy) => policy.link === 'inferred' && policy.scope_code === otherCode).length : 0;
      const words = [...texts, ...(inferredDecisions ? [`${other.city.business.name}の範囲の決定${inferredDecisions}件が題名で${city.business.name}を指す（推定）`] : [])];
      const { group, mid } = cityLink(other.city, city, link);
      layer.add(group);
      const label = addLabel(`${link === 'recorded' ? '━' : '┅'} ${words.join('・')}`, mid, `is-link is-${link}`, { minZoom: 0.8, priority: LABEL_PRIORITY.judgment });
      workLayer.labels.push(label);
    }
    scene.add(layer);
    workLayer.group = layer;
    workLayer.code = code;
  }

  /** Selects a city by its code, as a click would (without the host's callbacks). */
  function selectKey({ code }) {
    const group = cityIndex.get(code)?.group;
    if (!group) return null;
    select(group);
    return { data: group.userData, center: new THREE.Box3().setFromObject(group).getCenter(new THREE.Vector3()) };
  }

  // --- frame loop -----------------------------------------------------------
  const projected = new THREE.Vector3();
  let worldExtent = 60;
  let width = 0;
  let height = 0;
  function resize() {
    const rect = stage.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    width = rect.width;
    height = rect.height;
    renderer.setSize(width, height, false);
    const aspect = width / height;
    const span = Math.max((worldExtent * 0.9) / Math.min(aspect, 1.25), 24);
    Object.assign(camera, { left: -span * aspect, right: span * aspect, top: span, bottom: -span });
    camera.updateProjectionMatrix();
  }
  function fitExtent(extent) {
    worldExtent = extent;
    if (width > 0) resize();
  }
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  observer?.observe(stage);

  function placeLabels() {
    const placed = [];
    const selectedBusiness = selected?.userData?.business ?? null;
    const visibleLabels = [];
    for (const label of labels) {
      projected.copy(label.position).project(camera);
      const onScreen = projected.z < 1 && projected.x > -1.05 && projected.x < 1.05 && projected.y > -1.05 && projected.y < 1.05;
      const focused = selectedBusiness && label.business === selectedBusiness;
      const zoomOk = camera.zoom >= label.minZoom || (focused && label.priority === LABEL_PRIORITY.engagement && camera.zoom >= 1.8);
      if (!onScreen || !zoomOk || label.hiddenByFocus) {
        label.node.hidden = true;
        continue;
      }
      label.screen = { x: ((projected.x + 1) / 2) * width, y: ((1 - projected.y) / 2) * height };
      label.rank = label.owner === selected ? LABEL_PRIORITY.selected : focused && label.priority === LABEL_PRIORITY.city ? LABEL_PRIORITY.selected : label.priority;
      visibleLabels.push(label);
    }
    visibleLabels.sort((a, b) => a.rank - b.rank);
    for (const label of visibleLabels) {
      label.node.hidden = false;
      label.size ??= { w: label.node.offsetWidth, h: label.node.offsetHeight };
      const rect = { x: label.screen.x - label.size.w / 2, y: label.screen.y - label.size.h, w: label.size.w, h: label.size.h };
      const clash = placed.some((other) => rect.x < other.x + other.w + 2 && rect.x + rect.w + 2 > other.x && rect.y < other.y + other.h + 2 && rect.y + rect.h + 2 > other.y);
      if (clash && label.rank > LABEL_PRIORITY.selected) {
        label.node.hidden = true;
        continue;
      }
      placed.push(rect);
      label.node.style.transform = `translate(${Math.round(rect.x)}px, ${Math.round(rect.y)}px)`;
      label.node.classList.toggle('is-selected', label.rank === LABEL_PRIORITY.selected);
    }
  }

  /** A short burst of rising lights over what moved since the last visit. */
  function markChanges(changes) {
    const points = [
      ...(changes?.cities ?? []).map((code) => markers.cities.get(code)),
      ...(changes?.plaza ?? []).map((key) => markers.plaza.get(key)),
    ].filter(Boolean);
    for (const point of points) {
      for (let i = 0; i < 10; i += 1) {
        // Around the building and from its middle, so the labels above it never hide the sparks.
        const angle = (i / 10) * Math.PI * 2;
        const spark = mesh(new THREE.SphereGeometry(0.6, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffb21a, transparent: true, opacity: 0.95, fog: false }), { x: point.x + Math.cos(angle) * 2.6, y: point.y * 0.35, z: point.z + Math.sin(angle) * 2.6, shadow: false });
        spark.userData = { base: Math.max(1.2, point.y * 0.35), rise: Math.max(4, point.y * 0.8), delay: i * 220 };
        scene.add(spark);
        animated.sparkles.push(spark);
      }
      // A ring on the ground that pulses with the sparks.
      const ring = mesh(new THREE.RingGeometry(2.8, 3.5, 48), new THREE.MeshBasicMaterial({ color: 0xffb21a, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthTest: false, fog: false }), { x: point.x, y: 0.9, z: point.z, shadow: false });
      ring.rotation.x = -Math.PI / 2;
      ring.renderOrder = 2;
      ring.userData = { ring: true, base: 0.9, delay: 0 };
      scene.add(ring);
      animated.sparkles.push(ring);
    }
    animated.sparkleStart = null;
    return points.length;
  }

  let lastSkyMinute = -1;
  let running = true;
  let paused = false;
  function frame(time) {
    if (!running) return;
    requestAnimationFrame(frame);
    if (paused) return;
    if (!stage.isConnected || stage.offsetParent === null) return;
    if (width === 0) resize();
    if (flight) {
      flight.started ??= time;
      flight.t = Math.min((time - flight.started) / 850, 1);
      const e = 1 - (1 - flight.t) ** 3;
      controls.target.lerpVectors(flight.from.target, flight.to.target, e);
      camera.position.lerpVectors(flight.from.position, flight.to.position, e);
      camera.zoom = flight.from.zoom + (flight.to.zoom - flight.from.zoom) * e;
      camera.updateProjectionMatrix();
      camera.lookAt(controls.target);
      if (flight.t >= 1) {
        flight = null;
        controls.enabled = true;
      }
    }
    if (pendingHover) {
      const group = pickAt(pendingHover.x, pendingHover.y);
      pendingHover = null;
      if (group !== hovered) {
        if (hovered) setHighlight(hovered, false);
        labelOfCity(hovered)?.node.classList.remove('is-hover');
        hovered = group;
        if (hovered) setHighlight(hovered, true);
        labelOfCity(hovered)?.node.classList.add('is-hover');
        renderer.domElement.style.cursor = hovered ? 'pointer' : '';
      }
    }
    const minute = Math.floor(Date.now() / 60000);
    if (skyMode === 'auto' && minute !== lastSkyMinute) {
      if (lastSkyMinute !== -1 && skyAt(new Date().getHours(), 'auto').phase !== sky.phase) applySky();
      lastSkyMinute = minute;
    }
    if (animated.sparkles.length) {
      // Timed by the clock, not the frame timestamp, which can lag behind on a slow renderer.
      const clock = performance.now();
      animated.sparkleStart ??= clock;
      const elapsed = clock - animated.sparkleStart;
      for (const spark of animated.sparkles) {
        const t = Math.max(0, elapsed - spark.userData.delay) / 2600;
        const cycle = t % 1;
        if (spark.userData.ring) {
          spark.scale.setScalar(reducedMotion ? 1 : 1 + cycle * 0.6);
          spark.material.opacity = elapsed > 9000 ? Math.max(0, 0.8 - (elapsed - 9000) / 1500) : reducedMotion ? 0.8 : 0.8 * (1 - cycle);
          continue;
        }
        spark.position.y = spark.userData.base + (reducedMotion ? 0.6 : cycle * spark.userData.rise);
        spark.material.opacity = elapsed > 9000 ? Math.max(0, 1 - (elapsed - 9000) / 1500) : reducedMotion ? 0.9 : 0.95 * (1 - cycle);
      }
      if (elapsed > 10500) {
        for (const spark of animated.sparkles) scene.remove(spark);
        animated.sparkles = [];
      }
    }
    if (!reducedMotion) {
      if (animated.clouds.length) placeClouds(time);
      if (animated.foam) animated.foam.material.opacity = 0.3 + 0.24 * (1 + Math.sin(time / 1400)) / 2;
      for (const jet of animated.jets) jet.scale.y = 0.85 + 0.2 * Math.sin(time / 260);
      const wave = (1 + Math.sin(time / 380)) / 2;
      for (const beam of beacons) beam.material.opacity = 0.35 + 0.3 * wave;
      for (const ring of glows) {
        ring.material.opacity = 0.25 + 0.45 * (1 + Math.sin(time / 900)) / 2;
        ring.scale.setScalar(1 + 0.08 * Math.sin(time / 900));
      }
      if (selectionRing.visible) selectionRing.material.opacity = 0.6 + 0.35 * wave;
    }
    if (!flight) controls.update();
    renderer.render(scene, camera);
    placeLabels();
  }
  requestAnimationFrame(frame);

  return {
    buildPlaza,
    buildCities,
    markChanges,
    /** The sky: 'auto' follows the hour; 'day', 'dusk' or 'night' fix it.  Returns the phase shown. */
    setSky(mode) {
      skyMode = mode;
      applySky();
      return sky.phase;
    },
    flyTo,
    resetView,
    clearSelection() {
      select(null);
    },
    setWorkSigns,
    showWork,
    selectKey,
    /** While a district is open the world is not drawn (its canvas and labels are hidden). */
    setPaused(value) {
      paused = value;
      renderer.domElement.hidden = value;
      labelsLayer.hidden = value;
      if (!value) resize();
    },
    dispose() {
      running = false;
      observer?.disconnect();
      controls.dispose();
      renderer.dispose();
    },
  };
}

function renderFallbackList(doc, root, businesses, rows) {
  const list = el(doc, 'div', { className: 'bb-world-fallback' });
  list.append(el(doc, 'h2', { text: '事業' }));
  const ul = el(doc, 'ul');
  for (const business of businesses) {
    ul.append(el(doc, 'li', { text: `${business.name}（${kindEntry(business.kind).label}・案件${business.engagements.length}件）` }));
  }
  list.append(ul, el(doc, 'h2', { text: '判断の種類' }));
  const ol = el(doc, 'ul');
  for (const row of rows) ol.append(el(doc, 'li', { text: `${rowLabel(row)}：${STATE_LABELS[row.state] ?? row.state}` }));
  list.append(ol);
  root.append(list);
}

/** Why the host has no judgments to give, in the words the screen shows. */
const JUDGMENT_UNAVAILABLE_TEXT = Object.freeze({
  judgment_journal_not_connected: '判断の記録は各メンバーのMacにあり、組織版には送らないため未接続です',
});

/**
 * Where the selected city and work site are kept: the page address (`world_business`, `world_site`),
 * so leaving for another screen and coming back opens the same place.  A host may pass its own.
 */
function addressSelection() {
  return {
    read() {
      try {
        const params = new URLSearchParams(globalThis.location?.search ?? '');
        return { business: params.get('world_business'), site: params.get('world_site') };
      } catch {
        return { business: null, site: null };
      }
    },
    write({ business, site }) {
      try {
        const url = new URL(globalThis.location.href);
        if (business) url.searchParams.set('world_business', business);
        else url.searchParams.delete('world_business');
        if (site) url.searchParams.set('world_site', site);
        else url.searchParams.delete('world_site');
        globalThis.history?.replaceState(globalThis.history.state, '', `${url.pathname}${url.search}${url.hash}`);
      } catch {
        // Without an address the selection simply is not kept.
      }
    },
  };
}

/**
 * @param {object} options
 * @param {(project: { id: string, code?: string | null }) => string} [options.projectHref] Where a business or
 *   engagement opens in the host's プロジェクトと関係者.  The local web opens `#projects?project=<id>`; an
 *   organization web passes its own route.
 * @param {(site: { task_id: string }) => string | null} [options.taskHref] Where a work site's task opens in the
 *   host's task screen (to check or correct it).  Without one the rail says it cannot be corrected here.
 * @param {'standard' | 'canvas'} [options.presentation] Canvas owns its accessible overlays and ignores the host rail.
 * @param {{ read(): { business: string | null, site: string | null }, write(selection): void }} [options.selection]
 */
export function createWorldView({ root, rail, page, presentation = 'standard', document: explicitDocument, fetcher, projectHref = (project) => `#projects?project=${encodeURIComponent(project.id)}`, taskHref = null, selection = addressSelection() }) {
  const doc = explicitDocument ?? globalThis.document;
  const reducedMotion = Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const canvasMode = presentation === 'canvas';
  const wrap = el(doc, 'div', { className: `bb-world${canvasMode ? ' bb-world--canvas' : ''}` });
  let disposed = false;
  let canvasUI = null;
  const canvasNotes = new Map();
  const renderCanvasNotes = () => {
    if (!canvasUI || disposed) return;
    canvasUI.clearNotes();
    for (const note of canvasNotes.values()) canvasUI.addNote(note);
  };
  const setCanvasNote = (key, note) => {
    if (note) canvasNotes.set(key, note);
    else canvasNotes.delete(key);
    renderCanvasNotes();
  };
  function updateDistrictNotes(work) {
    for (const key of canvasNotes.keys()) if (key.startsWith('district:')) canvasNotes.delete(key);
    if (work) for (const [index, note] of workCanvasNotes(work).entries()) canvasNotes.set(`district:${index}`, note);
    renderCanvasNotes();
  }
  root.append(wrap);
  let scene = null;

  // The sky follows the hour by default; the viewer can fix it to see the lit windows at night.
  const SKY_MODES = [['auto', '空：時刻'], ['day', '空：昼'], ['dusk', '空：夕方'], ['night', '空：夜']];
  let skyIndex = 0;
  const skyButton = workspaceButton(doc, {
    text: SKY_MODES[0][1],
    onClick: () => {
      skyIndex = (skyIndex + 1) % SKY_MODES.length;
      skyButton.textContent = SKY_MODES[skyIndex][1];
      scene?.setSky(SKY_MODES[skyIndex][0]);
      district?.setSky(SKY_MODES[skyIndex][0]);
    },
  });
  const header = workspacePageHeader(doc, {
    crumbs: page?.crumbs ?? ['あなたのBrainbase', '世界'],
    title: '世界',
    lead: '事業を都市、案件を区画、判断の種類を広場の建物として描いています。都市を選ぶとその事業の区画に入り、仕事（タスク）が通りに面した現場として建ち、記録から把握できていないことが街の様子で見えます。見るための画面で、ここからは何も書き換えません。',
    source: page?.source ?? null,
    actions: [
      skyButton,
      // Back to the whole world, keeping the city in hand (its ring and its rail stay).
      workspaceButton(doc, { text: '全体に戻る', onClick: () => goToWorld() }),
    ],
  });
  const notices = el(doc, 'div', { className: 'bb-world-hud', attrs: { 'aria-live': 'polite' } });
  const legend = el(doc, 'div', { className: 'bb-world-legend', attrs: { 'aria-label': '凡例' } });
  for (const [state, label] of Object.entries(STATE_LABELS)) {
    const chip = el(doc, 'span', { className: `bb-world-chip is-${state}`, text: label });
    legend.append(chip);
  }
  legend.append(el(doc, 'span', { className: 'bb-world-chip is-flag', text: '赤い旗＝任せたのに訂正・取り消し' }));
  // Shown once a city's work is open.
  const workLegend = el(doc, 'div', { className: 'bb-world-legend is-work', attrs: { 'aria-label': '仕事の凡例' } });
  workLegend.hidden = true;
  for (const state of WORK_STATES.slice(0, 3)) workLegend.append(el(doc, 'span', { className: `bb-world-chip is-work-${state.key}`, text: `${state.label}（記録上）` }));
  workLegend.append(
    el(doc, 'span', { className: 'bb-world-chip is-sign', text: '？の札＝把握できていないことがある' }),
    el(doc, 'span', { className: 'bb-world-chip is-ring', text: '破線の輪＝本文に人物（担当欄は未接続）' }),
    el(doc, 'span', { className: 'bb-world-chip is-road', text: '実線＝記録された関係・破線＝推定' }),
  );
  const stage = el(doc, 'div', { className: 'bb-world-stage' });
  const labelsLayer = el(doc, 'div', { className: 'bb-world-labels' });
  stage.append(labelsLayer);
  if (canvasMode) {
    wrap.append(stage);
    canvasUI = createWorldCanvasUI({
      doc, stage, reducedMotion,
      onReset: () => { goToWorld(); clearAll(); },
      onCity: (code) => {
        if (!code) { goToWorld(); clearAll(); return; }
        const business = businessOf(code);
        if (business) openCity(business, scene?.selectKey({ code })?.center ?? null);
      },
      onSky: (mode) => {
        skyIndex = Math.max(0, SKY_MODES.findIndex(([key]) => key === mode));
        scene?.setSky(SKY_MODES[skyIndex][0]);
        district?.setSky(SKY_MODES[skyIndex][0]);
      },
      onDismissTask: () => dismissTask(),
    });
    const help = el(doc, 'div');
    help.append(el(doc, 'p', { text: 'ドラッグで移動、ホイールで寄る・離れる、右ドラッグで回転。都市を選ぶと区画に入ります。右端から詳細と絞り込みを開けます。Escで詳細を閉じ、その後は区画・全体の順に戻ります。ここから記録は書き換えません。' }));
    help.append(legend, workLegend);
    workLegend.hidden = false;
    const list = el(doc, 'ul');
    for (const [, text] of DISTRICT_LEGEND) list.append(el(doc, 'li', { text }));
    help.append(list);
    if (page?.source) help.append(el(doc, 'p', { text: page.source }));
    canvasUI.setHelp([help]);
  } else {
    stage.append(notices, legend, workLegend);
    wrap.append(header, stage);
  }

  const onRootEscape = (event) => {
    if (!canvasMode || event.key !== 'Escape' || event.defaultPrevented) return;
    event.preventDefault();
    event.stopPropagation();
    if (!canvasUI.dismissOverlay()) goUp();
  };
  wrap.addEventListener('keydown', onRootEscape, true);

  function showRail(nodes) {
    if (disposed) return;
    if (canvasUI) canvasUI.showRail(nodes);
    else rail?.replaceChildren(...nodes);
  }
  /**
   * With nothing chosen, the rail lists the ways in (AC-19): one button per business, the ones with the
   * most work to check first. The count orders the list; it is not a score.
   */
  let workSummaries = {};
  const showEmptyRail = () => {
    if (!knownBusinesses.length) {
      showRail([workspaceDetailEmpty(doc, { mark: '◇', title: '都市や建物を選ぶと、ここに出ます', text: 'ドラッグで移動、ホイールで寄る・離れる、右ドラッグで回転します。Escで全体に戻ります。' })]);
      return;
    }
    const noteOf = (business) => {
      const summary = workSummaries[business.code];
      if (!summary) return { text: workConnected === false ? '' : '仕事は区画で読みます', count: -1 };
      if (summary.state !== 'complete' && summary.state !== 'partial') return { text: '仕事を読めない（0件ではありません）', count: -1, muted: true };
      const needs = summary.needs_check?.length ?? 0;
      const parts = [needs ? `要確認 ${needs}` : Number.isInteger(summary.open) ? `未完了 ${summary.open}` : '未完了の件数は未確認'];
      if (summary.state === 'partial') parts.push('一部だけ読めた');
      return { text: parts.join('・'), count: needs };
    };
    const rows = knownBusinesses
      .map((business) => ({ business, note: noteOf(business) }))
      .sort((a, b) => b.note.count - a.note.count || a.business.name.localeCompare(b.business.name, 'ja'));
    const list = el(doc, 'ul', { className: 'bb-world-entrances' });
    for (const { business, note } of rows) {
      const item = el(doc, 'li', { className: 'bb-world-entrance' });
      const button = workspaceButton(doc, { text: `${business.name}の区画に入る ›`, onClick: () => enterFromRail(business) });
      item.append(button);
      if (note.text) item.append(el(doc, 'span', { className: `bb-world-entrance-note${note.count > 0 ? ' is-check' : ''}${note.muted ? ' is-muted' : ''}`, text: note.text }));
      list.append(item);
    }
    showRail([
      workspaceRailHead(doc, { kicker: '区画の入口', title: 'どの区画に入りますか', lead: '下のボタン、または地図の都市（建物や名前）を押すと、その事業の区画に入ります。Escで一つ上に戻ります。' }),
      workspaceRailBlock(doc, { title: '事業', content: list }),
    ]);
  };
  // The businesses are not known yet here (the list is drawn again once the world is built).
  showRail([workspaceDetailEmpty(doc, { mark: '◇', title: '都市や建物を選ぶと、ここに出ます', text: 'ドラッグで移動、ホイールで寄る・離れる、右ドラッグで回転します。Escで全体に戻ります。' })]);

  function enterFromRail(business) {
    const picked = scene?.selectKey({ code: business.code });
    openCity(business, picked?.center ?? null);
  }

  let proofs = new Map();
  let placement = { byBusiness: new Map(), unplaced: [] };
  /** Judgments the host kept back because they are not this organization's (organization mode only). */
  let withheld = 0;
  /** Whether the host gave judgments at all (an organization web does not: they stay on each Mac). */
  let judgmentsConnected = false;

  function judgmentText(item, fallback) {
    const textValue = item?.proof?.interruption?.question_display_text ?? item?.proof?.decision?.summary ?? fallback;
    const suffix = item?.conversation_moved_on_at ? '（会話で先に進んだ）' : item?.answer ? '（回答済み）' : isWaiting(item) ? '（あなたを待っています）' : '';
    return `${textValue}${suffix}`;
  }

  /** Descends to the same judgment in 今日 (the shell opens `#today?decision=`). */
  function decisionLink(decisionAttemptId) {
    const link = el(doc, 'a', { className: 'bb-world-rail-link', text: '「今日」でこの判断を開く', attrs: { href: `#today?decision=${encodeURIComponent(decisionAttemptId)}` } });
    return link;
  }

  /** Descends to the same project in プロジェクトと関係者 (the shell opens `#projects?project=`). */
  function projectLink(project, label) {
    return el(doc, 'a', { className: 'bb-world-rail-link', text: label, attrs: { href: projectHref(project) } });
  }

  /** 詳しく見る: the same project in プロジェクトと関係者. */
  function detailBlock(project, label) {
    const content = [projectLink(project, label)];
    return workspaceRailBlock(doc, { title: '詳しく見る', content });
  }

  function judgmentList(entries, describe) {
    const ul = el(doc, 'ul', { className: 'bb-world-rail-list' });
    const sorted = [...entries].sort((a, b) => String(b.item?.proof?.recorded_at ?? '').localeCompare(String(a.item?.proof?.recorded_at ?? '')));
    for (const entry of sorted.slice(0, 15)) {
      const li = el(doc, 'li');
      li.append(el(doc, 'span', { text: judgmentText(entry.item, entry.decision_attempt_id) }));
      li.append(el(doc, 'small', { className: 'bb-world-rail-note', text: describe(entry) }));
      li.append(decisionLink(entry.decision_attempt_id));
      ul.append(li);
    }
    return ul;
  }

  function cityJudgmentBlock(business) {
    const entries = placement.byBusiness.get(business.code) ?? [];
    if (entries.length === 0) {
      return workspaceRailBlock(doc, { title: 'この事業の判断', content: { text: 'この事業のリポジトリで作業した判断の記録はありません。' } });
    }
    return workspaceRailBlock(doc, {
      title: `この事業の判断（${entries.length}件）`,
      content: [
        judgmentList(entries, (entry) => `${SECTION_TEXT[entry.item?.section] ?? '状態不明'}・作業場所 ${entry.workspace}（${BASIS_TEXT[entry.basis]}）`),
        { text: '作業した場所で置いています。判断の対象とは違うことがあります。', className: 'bb-world-rail-caveat' },
      ],
    });
  }

  // --- which city and work site are open (story-world-work-sites-and-gaps-v1) ---
  let knownBusinesses = [];
  /** Whether the host has a task store: true, false (not connected), or null (not known yet / unreadable). */
  let workConnected = null;
  const workCache = new Map();
  const workRequests = new Map();
  const current = { code: null, siteId: null, level: 'world', focus: null, pendingSite: null, detachedSiteId: null };

  /** Inside a city the notices fold away (they would cover it); its rail carries the sources and times. */
  function setLevel(level) {
    current.level = level;
    notices.hidden = level !== 'world';
    if (canvasMode && level === 'world') updateDistrictNotes(null);
  }

  function setCurrent(code, siteId) {
    current.code = code;
    current.siteId = siteId;
    if (!siteId) current.detachedSiteId = null;
    canvasUI?.setCity(code);
    selection?.write?.({ business: code, site: siteId });
  }

  function businessOf(code) {
    return knownBusinesses.find((business) => business.code === code) ?? null;
  }

  /** The registration, engagements, link out and judgments of a city (as before the work layer). */
  function cityRegistrationBlocks(business) {
    const blocks = [];
    const measures = cityMeasures(business, { isFinished, judgments: placement.byBusiness.get(business.code) ?? [] });
    const kind = kindEntry(business.kind);
    const kindText = kind.definition ? `${kind.label}（${kind.definition}）` : kind.label;
    const judgmentText = judgmentsConnected ? `・判断${measures.judgments}件` : '（判断は未接続）';
    blocks.push(workspaceRailBlock(doc, { title: '登録', content: workspaceDefinition(doc, [
      ['分類', kindText],
      ['状態', statusText(business.status)],
      ['コード', business.code],
      ['進行中の案件（都市の広さ）', `${measures.open}件${measures.finished ? `（完了・終了${measures.finished}件は記念公園）` : ''}`],
      ['最近30日の動き（高さ・明かり）', `決定${measures.decisions}件${judgmentText}`],
    ]) }));
    const ul = el(doc, 'ul', { className: 'bb-world-rail-list' });
    for (const engagement of business.engagements) {
      const li = el(doc, 'li', { text: `${engagement.name}（${statusText(engagement.status)}）` });
      li.append(projectLink(engagement, '開く'));
      ul.append(li);
    }
    blocks.push(workspaceRailBlock(doc, { title: '案件（区画）', content: business.engagements.length ? ul : { text: '登録された案件はありません' } }));
    blocks.push(detailBlock(business, '「プロジェクトと関係者」でこの事業を開く'));
    blocks.push(cityJudgmentBlock(business));
    return blocks;
  }

  function workBlocksFor(business) {
    if (workConnected === false) {
      return [workspaceRailBlock(doc, { title: '仕事', content: { text: 'この画面はタスクの正本に接続していないため、都市の中の仕事は描いていません。仕事が0件という意味ではありません。' } })];
    }
    const work = workCache.get(business.code) ?? null;
    return workCityBlocks(doc, {
      business,
      work,
      onSelectGap: (kind) => showFocus(business, { kind }),
      onSelectStatus: (status) => showFocus(business, { status }),
      onReload: () => {
        workCache.delete(business.code);
        renderCityRail(business);
        void loadWork(business);
      },
    });
  }

  /** Brings a rail block the viewer just asked for into view (the rail may be scrolled down, or below the city). */
  function reveal(node) {
    try {
      node?.scrollIntoView?.({ block: 'start', behavior: reducedMotion ? 'auto' : 'smooth' });
    } catch {
      // Without scrolling the block is still in the rail.
    }
  }

  function renderCityRail(business, { revealFocus = false } = {}) {
    const blocks = [workspaceRailHead(doc, { kicker: `事業・${kindEntry(business.kind).label}`, title: business.name, lead: business.purpose ?? undefined })];
    let focusBlock = null;
    const work = workCache.get(business.code);
    if (current.focus && work?.status === 'ok') {
      const ids = new Set(current.focus.kind
        ? work.summary.gaps?.[current.focus.kind] ?? []
        : work.sites.filter((site) => site.work.open && site.work.status === current.focus.status).map((site) => site.task_id));
      const sites = work.sites.filter((site) => ids.has(site.task_id));
      const label = current.focus.kind
        ? sites[0]?.gaps.find((gap) => gap.kind === current.focus.kind)?.label ?? current.focus.kind
        : `記録上の状態「${WORK_STATES.find((state) => state.key === current.focus.status)?.label ?? current.focus.status}」`;
      blocks.push(focusBlock = workPickBlock(doc, {
        title: `${label} ${sites.length}件`,
        sites,
        note: '該当する仕事を街の中で濃く、ほかを薄く出しています。選ぶと、その仕事の根拠が開きます。',
        onSelectSite: (taskId) => openSiteById(business, taskId, { focus: true }),
      }));
      blocks.push(workspaceRailBlock(doc, { title: '', content: workspaceButton(doc, { text: 'すべての仕事を表示', onClick: () => showFocus(business, null) }) }));
    }
    const growth = growthFor(business.code);
    if (growth) blocks.push(workGrowthBlock(doc, growth));
    blocks.push(...workBlocksFor(business));
    if (canvasMode && work?.status === 'ok' && ['complete', 'partial'].includes(work.reads.tasks.state)) {
      // The canvas objects have an equivalent keyboard/touch entry for every
      // actual record, including completed/cancelled work outside open-work filters.
      const directory = el(doc, 'details', { className: 'bb-world-task-directory' });
      directory.append(el(doc, 'summary', { text: `仕事を選ぶ（${work.reads.tasks.state === 'partial' ? '読めた範囲 ' : ''}${work.sites.length}件）` }));
      directory.append(workPickBlock(doc, { title: '仕事の記録', sites: work.sites, onSelectSite: (taskId) => openSiteById(business, taskId, { focus: true }) }));
      blocks.push(directory);
    }
    blocks.push(...cityRegistrationBlocks(business));
    showRail(blocks);
    if (revealFocus) reveal(focusBlock ?? blocks[0]);
  }

  /** The open tasks a focus picks: a kind of gap, or a recorded state; null for all. */
  function focusIdsFor(work, focus) {
    if (!focus || work?.status !== 'ok') return null;
    return focus.kind
      ? work.summary.gaps?.[focus.kind] ?? []
      : work.sites.filter((site) => site.work.open && site.work.status === focus.status).map((site) => site.task_id);
  }

  function showFocus(business, focus) {
    current.focus = focus;
    district?.focus(focusIdsFor(workCache.get(business.code), focus));
    renderCityRail(business, { revealFocus: true });
  }

  // --- the district grows (AC-22〜24): what changed since this viewer was last inside -------------
  // The last state seen is a per-viewer convenience kept in this browser; nothing is lost if it forgets.
  const districtGrowth = new Map();
  const snapshotKey = (code) => `brainbase.world.district.${code}`;
  function readSnapshot(code) {
    try {
      return JSON.parse(globalThis.localStorage?.getItem(snapshotKey(code)) ?? 'null');
    } catch {
      return null;
    }
  }
  function writeSnapshot(code, snapshot) {
    try {
      globalThis.localStorage?.setItem(snapshotKey(code), JSON.stringify(snapshot));
    } catch {
      // Without storage the district shows no changes next time.
    }
  }
  const liveSites = (work) => (work?.status === 'ok' && work.reads.tasks.state === 'complete' ? work.sites : null);
  /** Compares against what this viewer last saw, then remembers what they see now. */
  function noteGrowth(code, work, previous) {
    const sites = liveSites(work);
    if (!sites) {
      districtGrowth.delete(code);
      return null;
    }
    const at = new Date().toISOString();
    const changes = districtChanges(previous, sites, at);
    const growth = { stage: districtStage(sites), changes, seen: districtSnapshot(sites, at) };
    districtGrowth.set(code, growth);
    writeSnapshot(code, growth.seen);
    return growth;
  }
  const growthFor = (code) => districtGrowth.get(code) ?? null;

  // AC-23: coming back from the task screen with the district open, read its work again and answer.
  async function recheckDistrict() {
    const code = current.level !== 'world' ? current.code : null;
    const business = code ? businessOf(code) : null;
    if (!business || (!canvasMode && !district?.isOpen())) return;
    const previous = growthFor(code)?.seen ?? readSnapshot(code);
    const request = Symbol(code);
    workRequests.set(code, request);
    const result = await readJson(fetcher, `/api/extensions/world/businesses/${encodeURIComponent(code)}/work`);
    if (disposed || workRequests.get(code) !== request) return;
    const work = result.ok ? result.data : { status: 'unavailable', reason: result.error };
    workCache.set(code, work);
    if (current.code !== code || current.level === 'world') return;
    updateDistrictNotes(work);
    scene?.showWork(code, work);
    if (districtCode === code && district?.isOpen()) {
      district.refresh(business, work, { neighbours: new Map(knownBusinesses.map((entry) => [entry.code, entry.name])) });
      const growth = noteGrowth(code, work, previous);
      district.celebrate(growth?.changes ?? null);
      district.focus(focusIdsFor(work, current.focus));
    }
    if (current.siteId) {
      const siteId = current.siteId;
      if (openSiteById(business, siteId, { select: false })) return;
      dismissTask();
      setCanvasNote('district:selection', { label: '選択中の仕事', tone: 'warning', summary: '選択中の仕事を現在の読込で確認できません', text: '選択中の仕事を現在の読み込み結果で確認できません。削除されたとは限りません。詳細から読み込み状態を確認してください。' });
    }
    renderCityRail(business);
  }

  const onVisible = () => {
    if (doc.visibilityState === 'visible') void recheckDistrict();
  };
  // Hosts may hand in a document without events (tests, server rendering); the recheck is then off.
  doc.addEventListener?.('visibilitychange', onVisible);

  // --- inside a district (AC-11): the world rests behind it while it is open ---------------------
  let district = null;
  let districtCode = null;
  function enterDistrict(business, work) {
    if (!scene || !work || work.status === 'not_connected') return false;
    district ??= createDistrictView({
      doc,
      stage,
      reducedMotion,
      onPick: (site) => {
        const owner = businessOf(current.code);
        if (owner) openSite(owner, site);
      },
      onClear: () => {
        const owner = businessOf(current.code);
        if (owner && current.level === 'site') openCity(owner, null);
      },
      onEscape: goUp,
      focusSelection: !canvasMode,
      showChrome: !canvasMode,
      onProjectSelection: (anchor) => {
        if (anchor.taskId === current.siteId && current.detachedSiteId !== current.siteId) canvasUI?.setTaskAnchor(anchor);
        else if (!anchor.visible && !current.siteId) canvasUI?.setTaskAnchor({ visible: false });
      },
    });
    district.setSky(SKY_MODES[skyIndex][0]);
    scene.setPaused(true);
    if (!canvasMode) { legend.hidden = true; workLegend.hidden = true; }
    if (districtCode !== business.code || !district.isOpen()) {
      district.show(business, work, { neighbours: new Map(knownBusinesses.map((entry) => [entry.code, entry.name])) });
      districtCode = business.code;
      const growth = growthFor(business.code) ?? noteGrowth(business.code, work, readSnapshot(business.code));
      district.celebrate(growth?.changes ?? null);
    }
    district.focus(focusIdsFor(work, current.focus));
    return true;
  }

  function leaveDistrict() {
    if (!district?.isOpen()) return;
    district.hide();
    districtCode = null;
    scene?.setPaused(false);
    if (!canvasMode) legend.hidden = false;
  }

  async function loadWork(business) {
    if (workConnected === false || workCache.has(business.code)) return workCache.get(business.code) ?? null;
    const request = Symbol(business.code);
    workRequests.set(business.code, request);
    const result = await readJson(fetcher, `/api/extensions/world/businesses/${encodeURIComponent(business.code)}/work`);
    if (disposed || workRequests.get(business.code) !== request) return null;
    const work = result.ok ? result.data : { status: 'unavailable', reason: result.error };
    if (work?.status === 'not_connected') workConnected = false;
    workCache.set(business.code, work);
    if (current.code !== business.code) return work;
    if (current.level !== 'world') updateDistrictNotes(work);
    scene?.showWork(business.code, work);
    if (current.level !== 'world') {
      if (districtCode === business.code && district?.isOpen()) {
        district.refresh(business, work, { neighbours: new Map(knownBusinesses.map((entry) => [entry.code, entry.name])) });
        district.focus(focusIdsFor(work, current.focus));
      } else enterDistrict(business, work);
    }
    if (current.pendingSite && current.level !== 'world') {
      const siteId = current.pendingSite;
      current.pendingSite = null;
      if (openSiteById(business, siteId)) return work;
      setCanvasNote('district:selection', { label: '選択中の仕事', tone: 'warning', summary: '保存された仕事を現在の読込で確認できません', text: '保存された仕事を現在の読み込みで確認できません。削除とは断定せず、区画の読み込み状態を確認してください。' });
    }
    if (current.level !== 'site') renderCityRail(business);
    return work;
  }

  /** Opens a city: its rail, and its district once its work is read (the district is where its work is). */
  function openCity(business, center, { zoom = 2.8 } = {}) {
    canvasUI?.closeTask();
    current.pendingSite = null;
    if (current.code !== business.code) {
      current.focus = null;
      leaveDistrict();
    }
    setCurrent(business.code, null);
    setLevel('city');
    const work = workCache.get(business.code);
    updateDistrictNotes(work ?? null);
    if (districtCode === business.code && district?.isOpen()) {
      if (!canvasMode) district.home();
      else district.clearSelection();
      district.focus(focusIdsFor(work, current.focus));
    } else {
      if (center) scene?.flyTo(new THREE.Vector3(center.x, 0, center.z), zoom);
      if (work) {
        scene?.showWork(business.code, work);
        enterDistrict(business, work);
      }
    }
    renderCityRail(business);
    if (!work) void loadWork(business);
  }

  function openSite(business, site, { select = true, focus = false } = {}) {
    setCurrent(business.code, site.task_id);
    setLevel('site');
    const drawable = Boolean(scene && districtCode === business.code && site.work.status !== 'cancelled');
    const detached = !drawable || focus || (!select && current.detachedSiteId === site.task_id);
    current.detachedSiteId = detached ? site.task_id : null;
    if (select && drawable) district?.select(site.task_id);
    const work = workCache.get(business.code);
    const back = workspaceButton(doc, { text: `← ${business.name}の区画に戻る`, onClick: () => goUp() });
    const head = workspaceRailHead(doc, { kicker: `${business.name} の仕事（タスク）`, title: site.title, sub: `記録上：${site.work.label}${site.gaps.length ? `・把握できていないこと${site.gaps.length}種` : ''}` });
    const nodes = [head, ...(canvasMode && detached ? [el(doc, 'p', { text: drawable ? '一覧から選んだ仕事の記録を、地図の位置とは独立して表示しています。' : 'この仕事は地図上に描いていません。記録の詳細を表示しています。' })] : []), ...workSiteBlocks(doc, { business, site, readAt: work?.reads?.tasks?.read_at ?? null, taskHref })];
    if (canvasUI) {
      renderCityRail(business);
      // WebGL fallback keeps the complete task inspectable in the same nonmodal surface.
      if (detached) {
        const rect = stage.getBoundingClientRect();
        canvasUI.setTaskAnchor({ x: rect.width / 2, y: rect.height / 2, visible: true, unanchored: true });
      }
      canvasUI.showTask(nodes, { focus });
    } else {
      showRail([head, workspaceRailBlock(doc, { title: '', content: back }), ...nodes.slice(1)]);
      reveal(head);
    }
  }

  function openSiteById(business, taskId, options) {
    const work = workCache.get(business.code);
    const site = work?.status === 'ok' ? work.sites.find((entry) => entry.task_id === taskId) : null;
    if (!site) return false;
    openSite(business, site, options);
    return true;
  }

  function dismissTask() {
    canvasUI?.closeTask();
    district?.clearSelection();
    if (current.level !== 'site') return;
    const business = businessOf(current.code);
    setCurrent(current.code, null);
    setLevel('city');
    if (business) renderCityRail(business);
  }

  /** The whole world again, with the open city kept in hand (ring and rail stay). */
  function goToWorld() {
    canvasUI?.closeTask();
    current.pendingSite = null;
    leaveDistrict();
    setLevel('world');
    if (current.code) {
      const business = businessOf(current.code);
      scene?.selectKey({ code: current.code });
      if (business) renderCityRail(business);
      setCurrent(current.code, null);
    } else {
      scene?.clearSelection();
      showEmptyRail();
    }
    scene?.resetView();
  }

  function clearAll() {
    scene?.clearSelection();
    canvasUI?.closeTask();
    current.pendingSite = null;
    setCurrent(null, null);
    setLevel('world');
    current.focus = null;
    showEmptyRail();
  }

  /** One level up: a work site → its district, a district → the whole world (city kept), the world → nothing selected. */
  function goUp() {
    const business = current.code ? businessOf(current.code) : null;
    if (business && current.level === 'site') {
      if (canvasMode) { dismissTask(); return; }
      district?.clearSelection();
      openCity(business, null);
      return;
    }
    if (business && current.level === 'city') {
      goToWorld();
      return;
    }
    scene?.clearSelection();
    clearAll();
    scene?.resetView();
  }

  function restoreSelection() {
    const saved = selection?.read?.() ?? {};
    const business = saved.business ? businessOf(saved.business) : null;
    if (!business) return;
    const picked = scene?.selectKey({ code: business.code });
    openCity(business, picked?.center ?? null);
    current.pendingSite = saved.site ?? null;
    if (current.pendingSite && openSiteById(business, current.pendingSite)) current.pendingSite = null;
  }

  async function loadWorkSummary(note) {
    const result = await readJson(fetcher, '/api/extensions/world/work-summary');
    if (disposed) return;
    if (!result.ok) {
      note('仕事', `仕事の要約を読めません（${result.error}）。都市を選ぶと、その事業の仕事を読みにいきます。0件ではありません。`, 'warning', '仕事の要約：読込失敗');
      return;
    }
    if (result.data?.status === 'not_connected') {
      workConnected = false;
      note('仕事', 'この画面はタスクの正本に接続していないため、都市の中の仕事は描いていません（0件ではありません）。', 'warning', '仕事：未接続（0件ではありません）');
      return;
    }
    if (result.data?.status !== 'ok') {
      note('仕事', `仕事の要約を読めません（${result.data?.reason ?? result.data?.status ?? '理由不明'}）。0件ではありません。`, 'warning', '仕事の要約：読めない');
      return;
    }
    workConnected = true;
    const summaries = { ...(result.data.businesses ?? {}) };
    // An omitted business is missing data, not an unremarkable city with zero work.
    for (const business of knownBusinesses) {
      if (!summaries[business.code]) summaries[business.code] = { state: 'unavailable', reason: 'summary_missing', open: null, needs_check: null };
    }
    workSummaries = summaries;
    if (current.level === 'world' && !current.code) showEmptyRail();
    scene?.setWorkSigns(summaries);
    const entries = Object.values(summaries);
    const readable = entries.filter((entry) => entry.state === 'complete' || entry.state === 'partial');
    const unreadable = entries.length - readable.length;
    const openKnown = readable.every((entry) => Number.isInteger(entry.open) && entry.open >= 0);
    const open = openKnown ? readable.reduce((sum, entry) => sum + entry.open, 0) : null;
    const needsKnown = readable.every((entry) => Array.isArray(entry.needs_check));
    const needs = readable.reduce((sum, entry) => sum + (entry.needs_check?.length ?? 0), 0);
    const cities = readable.filter((entry) => entry.needs_check?.length).length;
    const partial = readable.filter((entry) => entry.state === 'partial').length;
    // Which kinds of gap, across the businesses read: what is not visible, not how bad it is.
    const kinds = new Map();
    for (const entry of readable) for (const [kind, ids] of Object.entries(entry.gaps ?? {})) kinds.set(kind, (kinds.get(kind) ?? 0) + ids.length);
    const kindText = [...kinds].sort((a, b) => b[1] - a[1]).map(([kind, count]) => `${GAP_SHORT_TEXT[kind] ?? kind}${count}`).join('・');
    const parts = readable.length
      ? [needsKnown
        ? `未完了の仕事${open === null ? '（件数未確認）' : `${open}件`}のうち${needs}件（${cities}事業）に、記録から把握できていないことがあります（？の札${kindText ? `。内訳：${kindText}` : ''}）`
        : '仕事の要約に記録の要確認件数がなく、件数は未確認です']
      : [];
    if (unreadable) parts.push(`${readable.length ? '' : 'どの事業の仕事も読めませんでした。'}仕事を読めなかった事業${unreadable}件（灰色の札。0件ではありません）`);
    if (partial) parts.push(`一部だけ読めた事業${partial}件`);
    note('仕事', `${parts.join('。')}。「止まっている」という意味ではありません（${shortTimeText(result.data.as_of)}時点）。`);
    if (canvasMode) {
      if (!needsKnown) note('記録の確認件数', '仕事の要約に記録の要確認件数がありません。確認事項が0件とは判断していません。', 'warning', '記録の要確認件数：未確認');
      if (!openKnown) note('仕事の件数', '読めた仕事の要約に未完了件数の記録がありません。0件とは判断していません。', 'warning', '未完了の件数：未確認');
      if (unreadable) note('仕事の読込', `仕事を読めなかった事業${unreadable}件。0件ではありません。`, 'warning', `仕事が読めない事業 ${unreadable}件`);
      if (partial) note('仕事の範囲', `一部だけ読めた事業${partial}件。件数は読めた範囲です。`, 'warning', `仕事が一部だけ読めた事業 ${partial}件`);
      if (needs) note('仕事の記録', `読めた未完了の仕事${needs}件（${cities}事業）に、記録から把握できていないことがあります。仕事の失敗や停止を意味しません。`, 'attention', `記録の要確認 ${needs}件・${cities}事業`);
    }
  }

  function shortTimeText(value) {
    const at = Date.parse(value ?? '');
    if (!Number.isFinite(at)) return '時点不明';
    const date = new Date(at);
    const pad = (number) => String(number).padStart(2, '0');
    return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function onPick(data, position) {
    if (data.kind === 'site') {
      openSite(data.business, data.site);
      return;
    }
    if (data.kind === 'city') {
      openCity(data.business, position);
      return;
    }
    if (data.kind === 'engagement') {
      const business = data.business;
      setCurrent(business.code, null);
      setLevel('city');
      scene?.flyTo(new THREE.Vector3(position.x, 0, position.z), 3.6);
      if (!workCache.has(business.code)) void loadWork(business);
      showRail([
        workspaceRailHead(doc, { kicker: `${business.name} の案件`, title: data.engagement.name, lead: data.engagement.summary ?? undefined }),
        workspaceRailBlock(doc, { title: '登録', content: workspaceDefinition(doc, [['状態', statusText(data.engagement.status)], ['Graph ID', data.engagement.id]]) }),
        detailBlock(data.engagement, '「プロジェクトと関係者」でこの案件を開く'),
        workspaceRailBlock(doc, { title: '', content: workspaceButton(doc, { text: `${business.name}の区画に入る`, variant: 'primary', onClick: () => openCity(business, position) }) }),
        cityJudgmentBlock(business),
      ]);
      return;
    }
    if (data.kind === 'cityJudgments') {
      const business = data.business;
      setCurrent(business.code, null);
      scene?.flyTo(new THREE.Vector3(position.x, 0, position.z), 3.2);
      showRail([
        workspaceRailHead(doc, { kicker: `${business.name} の判断所`, title: `判断 ${data.judgments.length}件`, lead: business.purpose ?? undefined }),
        cityJudgmentBlock(business),
        workspaceRailBlock(doc, { title: '詳しく見る', content: workspaceButton(doc, { text: '「今日」で開く', variant: 'primary', onClick: () => { globalThis.location.hash = '#today'; } }) }),
      ]);
      return;
    }
    if (data.kind === 'judgment') {
      const { row, items } = data;
      setCurrent(null, null);
      scene?.flyTo(new THREE.Vector3(0, 0, 0), 2.2);
      const blocks = [workspaceRailHead(doc, {
        kicker: `判断の種類・${STATE_LABELS[row.state] ?? row.state}`,
        title: rowLabel(row),
        sub: `最新 ${row.latest_recorded_at?.slice(0, 16).replace('T', ' ') ?? '不明'}`,
      })];
      blocks.push(workspaceRailBlock(doc, {
        title: '件数',
        content: workspaceDefinition(doc, [
          ['聞かずに進めた', `${row.counts.continued}件`],
          ['あなたに戻した', `${row.counts.returned}件`],
          ['評価済み', `${row.counts.rated}件`],
          ['訂正・取り消し', `${row.counts.corrected_or_reverted}件`],
        ]),
      }));
      const ul = el(doc, 'ul', { className: 'bb-world-rail-list' });
      for (const ref of items.slice(0, 12)) {
        const li = el(doc, 'li', { text: judgmentText(proofs.get(ref.decision_attempt_id), ref.decision_attempt_id) });
        li.append(decisionLink(ref.decision_attempt_id));
        ul.append(li);
      }
      blocks.push(workspaceRailBlock(doc, { title: '判断（新しい順）', content: items.length ? ul : { text: '判断はありません' } }));
      blocks.push(workspaceRailBlock(doc, {
        title: '詳しく見る',
        content: workspaceButton(doc, { text: '「今日」で開く', variant: 'primary', onClick: () => { globalThis.location.hash = '#today'; } }),
      }));
      showRail(blocks);
      return;
    }
    if (data.kind === 'plaza') {
      setCurrent(null, null);
      scene?.flyTo(new THREE.Vector3(0, 0, 0), 2.2);
      const blocks = [workspaceRailHead(doc, {
        kicker: '広場',
        title: '判断の種類（全体）',
        lead: '建物1つが判断の種類1つで、全事業の判断をまとめています。高さは件数、色は任せ方の状態です。事業ごとの判断は、各都市の判断所にあります。',
      })];
      blocks.push(workspaceRailBlock(doc, {
        title: `どの事業にも置けない判断（${placement.unplaced.length}件）`,
        content: placement.unplaced.length
          ? judgmentList(placement.unplaced, (entry) => `${UNPLACED_REASON_TEXT[entry.reason] ?? entry.reason}${entry.workspace ? `（作業場所 ${entry.workspace}）` : ''}`)
          : { text: 'ありません' },
      }));
      if (withheld) {
        blocks.push(workspaceRailBlock(doc, {
          title: `この世界に出していない判断（${withheld}件）`,
          content: { text: 'この組織の事業で作業したと確かめられない判断です。ほかの会社の仕事が混ざるため、内容も作業場所も出しません。「今日」では見られます。' },
        }));
      }
      showRail(blocks);
    }
  }

  async function load() {
    const businessesResult = await readJson(fetcher, '/api/extensions/world/businesses');
    if (disposed) return;
    // A world drawn from an organization's Graph shows only that organization's judgments: the host keeps
    // the others (another company's work, or unknown) back and sends only how many it kept back.
    const organizationScoped = businessesResult.ok && businessesResult.data?.status === 'ok'
      && businessesResult.data.source?.authority === 'organization_graph';
    let homeResult;
    let placesResult;
    if (organizationScoped) {
      const scoped = await readJson(fetcher, '/api/extensions/world/organization-judgments');
      const available = scoped.ok && scoped.data?.status === 'available';
      withheld = available ? scoped.data.withheld : 0;
      homeResult = available ? { ok: true, data: scoped.data.home } : scoped.ok ? { ok: true, data: { status: 'unavailable', reason: scoped.data?.reason } } : scoped;
      placesResult = available ? { ok: true, data: { status: 'available', places: scoped.data.places } } : { ok: true, data: { status: 'unavailable', reason: scoped.data?.reason } };
    } else {
      [homeResult, placesResult] = await Promise.all([
        readJson(fetcher, '/api/value-proofs/home'),
        readJson(fetcher, '/api/extensions/world/judgment-places'),
      ]);
    }
    if (disposed) return;
    notices.replaceChildren();
    const note = (label, textValue, tone = 'info', summary = null) => {
      if (canvasUI) {
        setCanvasNote(`${label}:${summary ?? 'detail'}`, { label, text: textValue, tone, summary });
        return;
      }
      const line = el(doc, 'p', { className: `bb-world-hud-line is-${tone}`, attrs: tone === 'info' ? {} : { role: 'alert' } });
      line.append(el(doc, 'strong', { text: label }), el(doc, 'span', { text: textValue }));
      notices.append(line);
    };
    const businessPayload = businessesResult.ok ? businessesResult.data : null;
    const businesses = businessPayload?.status === 'ok' ? businessPayload.businesses : [];
    if (businessPayload?.status === 'ok' && businessPayload.vocabulary) worldVocabulary = businessPayload.vocabulary;
    if (!businessesResult.ok || businessPayload?.status !== 'ok') {
      const reason = businessesResult.ok ? `${BUSINESS_STATE_TEXT[businessPayload?.status] ?? '状態不明'}（${businessPayload?.reason ?? '理由不明'}）` : `取得に失敗しました（${businessesResult.error}）`;
      note('事業', `${reason}。事業は0件ではありません。`, 'warning', '事業：読めない（0件ではありません）');
    } else {
      const extra = [];
      if (businessPayload.unplaced.length) extra.push(`親の事業がGraphに無い案件${businessPayload.unplaced.length}件は描いていません`);
      if (businessPayload.excluded.inactive) extra.push(`終了・統合済み${businessPayload.excluded.inactive}件は除外`);
      const sourceText = businessPayload.source.authority === 'organization_graph' ? `組織のGraph（${businessPayload.source.server}）` : 'このMacのGraph';
      const unclassified = businesses.filter((business) => !business.kind).length;
      if (unclassified) extra.push(`分類の無い事業${unclassified}件は「分類なし」として描いています`);
      if (businessPayload.vocabulary?.terms === 'unavailable') {
        extra.push('組織の用語を読めないため、分類の名前は語彙ファイルか値のままです');
        if (canvasMode) note('用語', '組織の用語を読めないため、分類の名前は語彙ファイルか値のままです。', 'warning', '組織の用語：読めない');
      }
      if (canvasMode && businessPayload.unplaced.length) note('案件', '親の事業がGraphに無い案件は描いていません。', 'warning', `親の事業が見つからない案件 ${businessPayload.unplaced.length}件`);
      note('事業', `${sourceText}の事業${businesses.length}件・案件${businesses.reduce((sum, business) => sum + business.engagements.length, 0)}件。${extra.join('。')}${extra.length ? '。' : ''}`);
    }
    const home = homeResult.ok ? homeResult.data : null;
    const readable = home?.status === 'available' && Array.isArray(home.delegation_map?.rows);
    const rows = readable ? home.delegation_map.rows : [];
    if (!homeResult.ok || !readable) {
      const reason = homeResult.ok ? home?.reason ?? home?.status ?? '状態不明' : homeResult.error;
      if (JUDGMENT_UNAVAILABLE_TEXT[reason]) note('判断', `${JUDGMENT_UNAVAILABLE_TEXT[reason]}。事業だけを描いています。`, 'warning', '判断の記録：未接続');
      else note('判断', `判断の記録を読めません（${reason}）。0件ではありません。`, 'warning', '判断の記録：読めない');
    } else {
      proofs = proofIndex(home);
      judgmentsConnected = true;
      const waiting = [...proofs.values()].filter(isWaiting).length;
      const places = placesResult.ok && placesResult.data?.status === 'available' ? placesResult.data.places : null;
      if (places) {
        // Only judgments the home lists are placed, so the world and 今日 count the same judgments.
        const known = places.filter((place) => proofs.has(place.decision_attempt_id)).map((place) => ({ ...place, item: proofs.get(place.decision_attempt_id) }));
        placement = groupJudgmentPlaces(known, businesses);
        const placed = known.length - placement.unplaced.length;
        const kept = withheld ? `この組織の事業で作業したと確かめられない判断${withheld}件は、この世界には出していません（「今日」で見られます）。` : '';
        note('判断', `${home.delegation_map.judged}件のうち${placed}件を作業した事業の判断所に、${placement.unplaced.length}件は事業が分からないため広場に。${kept}今あなたを待っている判断${waiting}件${waiting ? '（光の柱）' : ''}。`, waiting ? 'attention' : 'info', waiting ? `あなたを待っている判断 ${waiting}件` : null);
      } else {
        note('判断', `${home.delegation_map.judged}件。作業した場所を読めないため、事業には置かず広場の種類別だけで描いています（${placesResult.ok ? placesResult.data?.reason ?? '理由不明' : placesResult.error}）。今あなたを待っている判断${waiting}件。`, 'warning', '判断の作業場所：読めない');
      }
    }
    const rowItems = new Map(rows.map((row) => [row.key, Array.isArray(row.items) ? row.items : []]));

    knownBusinesses = businesses;
    canvasUI?.setCities(businesses, current.code);
    if (!webglAvailable(doc)) {
      note('表示', 'この環境では3Dを表示できないため、一覧で出しています。', 'warning', '3D表示を利用できません・一覧表示');
      if (canvasMode) {
        renderFallbackList(doc, stage, businesses, rows);
        showEmptyRail();
        restoreSelection();
        void loadWorkSummary(note);
      } else {
        stage.hidden = true;
        renderFallbackList(doc, wrap, businesses, rows);
      }
      return;
    }
    scene = createScene({ doc, stage, labelsLayer, reducedMotion, onPick, onClear: clearAll, onEscape: goUp });
    scene.setSky(SKY_MODES[skyIndex][0]);
    scene.buildPlaza(rows, rowItems, (row) => (rowItems.get(row.key) ?? []).filter((ref) => isWaiting(proofs.get(ref.decision_attempt_id))).length, Date.now());
    scene.buildCities(layoutWorld(businesses), placement.byBusiness);
    showChangesSinceLastVisit(note, businesses, rows);
    knownBusinesses = businesses;
    if (!current.code) showEmptyRail();
    restoreSelection();
    void loadWorkSummary(note);
  }

  /**
   * What moved since this viewer last opened the world (a per-viewer convenience kept in this browser;
   * nothing is lost if the browser forgets it).
   */
  function showChangesSinceLastVisit(note, businesses, rows) {
    const key = 'brainbase.world.lastVisit';
    let lastVisit = null;
    try {
      lastVisit = globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      lastVisit = null;
    }
    const changes = changesSince(lastVisit, businesses, placement.byBusiness, rows);
    try {
      globalThis.localStorage?.setItem(key, new Date().toISOString());
    } catch {
      // Without storage the world simply shows no marks next time.
    }
    if (!changes) {
      note('前回から', '初めての表示です。次に開いたときから、前回から動きがあった所に光の印を出します。');
      return;
    }
    const names = new Map(businesses.map((business) => [business.code, business.name]));
    const cityNames = changes.cities.map((code) => names.get(code) ?? code);
    const last = new Date(changes.since);
    const pad = (value) => String(value).padStart(2, '0');
    const when = `${pad(last.getMonth() + 1)}/${pad(last.getDate())} ${pad(last.getHours())}:${pad(last.getMinutes())}`;
    if (cityNames.length === 0 && changes.plaza.length === 0) {
      note('前回から', `前回（${when}）から、新しい決定や判断はありません。`);
      return;
    }
    const parts = [
      cityNames.length ? `都市：${cityNames.join('・')}` : null,
      changes.plaza.length ? `広場の判断の種類${changes.plaza.length}つ` : null,
    ].filter(Boolean);
    note('前回から', `前回（${when}）から動きがあった所に光の印を出しています。${parts.join('、')}。`, 'attention');
    scene?.markChanges(changes);
  }

  void load();
  return {
    dispose() {
      disposed = true;
      doc.removeEventListener?.('visibilitychange', onVisible);
      wrap.removeEventListener?.('keydown', onRootEscape, true);
      canvasUI?.dispose();
      district?.dispose();
      scene?.dispose();
    },
  };
}

export const screen = Object.freeze({
  id: 'world',
  label: '世界',
  usesGraph: false,
  rail: true,
  source: '手元のGraph・判断journal（読み取りのみ）',
  mount(container, context) {
    const root = context.document.createElement('div');
    root.className = 'bb-shell-page';
    container.append(root);
    return createWorldView({ root, rail: context.rail, page: context.page, document: context.document, fetcher: context.fetcher });
  },
});
