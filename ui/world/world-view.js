/*
 * Experimental world view (W1–W4, provisional adoption 2026-10-04).
 *
 * A read-only 3D projection of two existing sources:
 *   - businesses and their engagements from the owner's organization Graph
 *     (GET /api/extensions/world/businesses), drawn as cities and districts;
 *   - the delegation map of the value-proof home (GET /api/value-proofs/home),
 *     drawn as buildings in the plaza, one per judgment kind.
 * Judgments do not record a project yet (W4), so every judgment building stands
 * in the plaza; nothing is assigned to a city by guesswork (P9).  The world
 * never writes. Selecting something opens its facts in the rail and hands off
 * to the existing screens.
 */

import { THREE, MapControls } from './world-vendor.js';
import { groupJudgmentPlaces, UNPLACED_REASON_TEXT } from './world-placement.js';
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

const KIND_LABELS = Object.freeze({ product: 'プロダクト', client: '顧客案件', internal: '社内', research: '研究' });
const KIND_COLORS = Object.freeze({ product: 0x1261ad, client: 0xb07a1f, internal: 0x35684c, research: 0x6b4fa0 });
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
  not_connected: '組織のGraphに接続していません',
  auth_failed: '組織のGraphの認証が切れています',
  unavailable: '組織のGraphを読めません',
});

const STATUS_TEXT = Object.freeze({ active: '進行中', maintenance: '保守', completed: '完了', closed: '終了', not_converted: '案件化せず', concept: '構想' });
const FINISHED_STATUSES = new Set(['completed', 'closed', 'not_converted']);
const SECTION_TEXT = Object.freeze({ needs_human: 'あなたに戻した', blocked: '止まった', continued: '聞かずに進めた', other: 'その他' });
const BASIS_TEXT = Object.freeze({ repository: '作業したリポジトリがこの事業に登録されている', code: '作業したリポジトリ名がこの事業のコードと同じ' });
const statusText = (status) => (status ? STATUS_TEXT[status] ?? status : '未記録');

const PLAZA_RADIUS = 7;
const CITY_RING = 30;

function hashUnit(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

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
  const kinds = Object.keys(KIND_LABELS);
  const ordered = [...businesses].sort((a, b) => kinds.indexOf(a.kind) - kinds.indexOf(b.kind));
  const kindCount = new Set(ordered.map((business) => business.kind)).size;
  const gap = 0.35;
  const slot = (Math.PI * 2 - gap * kindCount) / Math.max(ordered.length, 1);
  const cities = [];
  const kindAngles = {};
  let angle = -Math.PI / 2 - slot / 2;
  let previousKind = null;
  let extent = PLAZA_RADIUS;
  ordered.forEach((business, index) => {
    if (business.kind !== previousKind) {
      angle += gap;
      previousKind = business.kind;
    }
    angle += slot;
    const n = business.engagements.length;
    const size = 7 + 2.6 * Math.ceil(Math.sqrt(Math.max(n, 1)));
    const ring = CITY_RING + (index % 2) * 16 + size * 0.35;
    const city = { business, kind: business.kind, size, angle, x: Math.cos(angle) * ring, z: Math.sin(angle) * ring };
    cities.push(city);
    (kindAngles[business.kind] ??= []).push(angle);
    extent = Math.max(extent, ring + size * 0.75);
  });
  const sectors = Object.entries(kindAngles).map(([kind, angles]) => ({ kind, angle: angles.reduce((sum, value) => sum + value, 0) / angles.length }));
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
const LABEL_PRIORITY = Object.freeze({ selected: 0, plaza: 1, city: 2, sector: 3, judgment: 4, engagement: 5 });

function canvasTexture(doc, width, height, draw) {
  const canvas = doc.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d'), width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function windowTexture(doc, lit, glowOnly = false) {
  const texture = canvasTexture(doc, 64, 64, (ctx, w, h) => {
    ctx.fillStyle = glowOnly ? '#000000' : '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = glowOnly ? '#ffffff' : lit ? '#ffe2a0' : '#c6d3de';
    for (let y = 8; y < h; y += 16) {
      for (let x = 6; x < w; x += 14) ctx.fillRect(x, y, 8, 8);
    }
  });
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

function roundedPlate(width, depth, height, radius) {
  const shape = new THREE.Shape();
  const w = width / 2;
  const d = depth / 2;
  shape.moveTo(-w + radius, -d);
  shape.lineTo(w - radius, -d);
  shape.quadraticCurveTo(w, -d, w, -d + radius);
  shape.lineTo(w, d - radius);
  shape.quadraticCurveTo(w, d, w - radius, d);
  shape.lineTo(-w + radius, d);
  shape.quadraticCurveTo(-w, d, -w, d - radius);
  shape.lineTo(-w, -d + radius);
  shape.quadraticCurveTo(-w, -d, -w + radius, -d);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.12, bevelSegments: 2 });
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

function gableRoof(width, depth, rise) {
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2 - 0.1, 0);
  shape.lineTo(width / 2 + 0.1, 0);
  shape.lineTo(0, rise);
  shape.lineTo(-width / 2 - 0.1, 0);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: depth + 0.2, bevelEnabled: false });
  geometry.translate(0, 0, -(depth + 0.2) / 2);
  return geometry;
}

function muted(color, amount) {
  return new THREE.Color(color).lerp(new THREE.Color(0xb9c2bb), amount);
}

function createScene({ doc, stage, labelsLayer, reducedMotion, onPick, onClear }) {
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
  scene.background = canvasTexture(doc, 4, 256, (ctx, w, h) => {
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, '#dfeee6');
    gradient.addColorStop(0.55, '#eef4ef');
    gradient.addColorStop(1, '#f6f1e6');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
  });
  scene.fog = new THREE.Fog(0xeef3ec, 170, 340);

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

  scene.add(new THREE.HemisphereLight(0xf4f8ff, 0xd8ccb2, 1.25));
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.7);
  sun.position.set(70, 110, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.radius = 4;
  sun.shadow.bias = -0.0004;
  Object.assign(sun.shadow.camera, { left: -150, right: 150, top: 150, bottom: -150, near: 1, far: 420 });
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xdfe9ff, 0.6);
  fill.position.set(-80, 60, -60);
  scene.add(fill);

  const ground = new THREE.Mesh(new THREE.CircleGeometry(230, 72), new THREE.MeshStandardMaterial({ color: 0xe4ebe1, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.userData = { kind: 'ground' };
  scene.add(ground);

  const textures = { lit: windowTexture(doc, true), unlit: windowTexture(doc, false), glow: windowTexture(doc, true, true) };
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

  function texturedBlock(w, h, d, color, lit, options = {}) {
    const map = (lit ? textures.lit : textures.unlit).clone();
    map.needsUpdate = true;
    map.repeat.set(Math.max(1, Math.round(w / 1.4)), Math.max(1, Math.round(h / 1.2)));
    const material = standard(color, { map, ...options });
    if (lit) {
      const glow = textures.glow.clone();
      glow.needsUpdate = true;
      glow.repeat.copy(map.repeat);
      material.emissive = new THREE.Color(0xffc867);
      material.emissiveMap = glow;
      material.emissiveIntensity = 0.6;
    }
    return mesh(new THREE.BoxGeometry(w, h, d), material, { y: h / 2 });
  }

  function register(group, data) {
    group.userData = data;
    pickables.push(group);
    const materials = [];
    group.traverse((child) => {
      if (child.isMesh && child.material?.emissive) materials.push(child.material);
    });
    highlightable.set(group, materials.map((material) => ({ material, base: material.emissive.clone(), intensity: material.emissiveIntensity })));
  }

  function road(from, to, width = 1.9) {
    const length = from.distanceTo(to);
    const angle = -Math.atan2(to.z - from.z, to.x - from.x) + Math.PI / 2;
    const surface = mesh(new THREE.PlaneGeometry(width, length), standard(0xd3d9d1, { roughness: 1 }), { x: (from.x + to.x) / 2, y: 0.03, z: (from.z + to.z) / 2, shadow: false });
    surface.rotation.set(-Math.PI / 2, 0, angle);
    scene.add(surface);
    const line = mesh(new THREE.PlaneGeometry(0.12, length), new THREE.MeshBasicMaterial({ color: 0xf8faf7 }), { x: (from.x + to.x) / 2, y: 0.05, z: (from.z + to.z) / 2, shadow: false });
    line.rotation.set(-Math.PI / 2, 0, angle);
    scene.add(line);
  }

  function tree(x, z, scale = 1) {
    const group = new THREE.Group();
    group.add(mesh(new THREE.CylinderGeometry(0.12 * scale, 0.16 * scale, 0.7 * scale, 6), standard(0x8a6d4e), { y: 0.35 * scale }));
    group.add(mesh(new THREE.ConeGeometry(0.7 * scale, 1.6 * scale, 7), standard(0x6f9a72, { roughness: 0.95 }), { y: 1.4 * scale }));
    group.position.set(x, 0, z);
    scene.add(group);
  }

  // --- plaza ---------------------------------------------------------------
  function buildPlaza(rows, rowItems, waitingOf, now) {
    const plaza = new THREE.Group();
    plaza.add(mesh(new THREE.CylinderGeometry(PLAZA_RADIUS + 2.2, PLAZA_RADIUS + 2.6, 0.3, 64), standard(0x9fbf9d, { roughness: 1 }), { y: 0.15 }));
    plaza.add(mesh(new THREE.CylinderGeometry(PLAZA_RADIUS, PLAZA_RADIUS + 0.4, 0.7, 64), standard(0xf3efe6, { roughness: 0.9 }), { y: 0.35 }));
    plaza.add(mesh(new THREE.TorusGeometry(PLAZA_RADIUS - 0.3, 0.08, 6, 64), standard(0xd8cfbd), { y: 0.72 }));
    plaza.children[2].rotation.x = Math.PI / 2;
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
      group.add(mesh(new THREE.BoxGeometry(2.6, 0.25, 2.6), standard(0xe6ded0), { y: 0.12 }));
      const body = texturedBlock(2.1, height, 2.1, color, recent);
      body.position.y += 0.25;
      group.add(body);
      const cap = texturedBlock(1.4, 0.7, 1.4, color, recent);
      cap.position.y += 0.25 + height;
      group.add(cap);
      scene.add(group);
      register(group, { kind: 'judgment', row, items: rowItems.get(row.key) ?? [] });
      const top = 0.7 + 0.25 + height + 0.7;
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
  function landmark(kind, color, height, status) {
    const group = new THREE.Group();
    const concept = status === 'concept';
    const tone = status === 'maintenance' ? muted(color, 0.55) : new THREE.Color(color);
    const options = concept ? { transparent: true, opacity: 0.38 } : {};
    if (kind === 'product') {
      const base = texturedBlock(3, height, 3, tone, !concept, { roughness: 0.4, ...options });
      const mid = texturedBlock(2.2, height * 0.45, 2.2, tone, !concept, { roughness: 0.4, ...options });
      mid.position.y += height;
      group.add(base, mid, mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.6, 6), standard(0x46524a), { y: height * 1.45 + 0.8 }));
    } else if (kind === 'client') {
      const hall = texturedBlock(4.4, height * 0.55, 3, tone, !concept, options);
      const roof = mesh(gableRoof(4.4, 3, 1.4), standard(muted(color, 0.15).multiplyScalar(0.85), options), { y: height * 0.55 });
      roof.rotation.y = Math.PI / 2;
      group.add(hall, roof);
    } else if (kind === 'research') {
      group.add(mesh(new THREE.CylinderGeometry(1.9, 2.1, height * 0.5, 24), standard(tone, options), { y: height * 0.25 }));
      group.add(mesh(new THREE.SphereGeometry(1.9, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), standard(0xf3f6f8, { roughness: 0.3, ...options }), { y: height * 0.5 }));
    } else {
      group.add(texturedBlock(3.6, height * 0.75, 2.8, tone, !concept, options));
      group.add(mesh(new THREE.BoxGeometry(1.2, 0.6, 1), standard(0xb8c2bb), { y: height * 0.75 + 0.3 }));
    }
    if (concept) {
      // Scaffold outline: a business that is still a concept.
      const outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(3.2, height * 1.2, 3.2)), new THREE.LineBasicMaterial({ color: 0x46524a }));
      outline.position.y = height * 0.6;
      group.add(outline);
    }
    return group;
  }

  function house(engagement, color) {
    const group = new THREE.Group();
    const status = engagement.status;
    if (FINISHED_STATUSES.has(status)) {
      // A finished engagement leaves its lot: a low slab, no roof.
      group.add(mesh(new THREE.BoxGeometry(1.8, 0.18, 1.8), standard(0xc9cfc8), { y: 0.09 }));
      group.userData.finished = true;
      return group;
    }
    const h = 0.9 + hashUnit(engagement.id) * 1.1;
    const tone = status === 'maintenance' ? muted(color, 0.6) : new THREE.Color(0xf2efe8);
    group.add(texturedBlock(1.6, h, 1.4, tone, status === 'active'));
    const roof = mesh(gableRoof(1.6, 1.4, 0.8), standard(status === 'maintenance' ? muted(color, 0.6) : color), { y: h });
    roof.rotation.y = hashUnit(`${engagement.id}r`) > 0.5 ? Math.PI / 2 : 0;
    group.add(roof);
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

  function buildCities({ cities, sectors, extent }, judgmentsByBusiness = new Map()) {
    fitExtent(extent);
    for (let i = 0; i < 12; i += 1) {
      const angle = (i / 12) * Math.PI * 2;
      road(new THREE.Vector3(Math.cos(angle) * (PLAZA_RADIUS + 4), 0, Math.sin(angle) * (PLAZA_RADIUS + 4)), new THREE.Vector3(Math.cos(angle + Math.PI / 6) * (PLAZA_RADIUS + 4), 0, Math.sin(angle + Math.PI / 6) * (PLAZA_RADIUS + 4)), 1.5);
    }
    for (const city of cities) {
      const { business, size, x, z, kind } = city;
      const color = KIND_COLORS[kind] ?? 0x69746d;
      const start = new THREE.Vector3(x, 0, z).setLength(PLAZA_RADIUS + 4);
      road(start, new THREE.Vector3(x, 0, z));
      const group = new THREE.Group();
      group.position.set(x, 0, z);
      const plateColor = new THREE.Color(0xf7f8f4).lerp(new THREE.Color(color), 0.1);
      group.add(mesh(roundedPlate(size, size, 0.45, 1.6), standard(plateColor, { roughness: 0.95 })));
      const towerHeight = 3.2 + Math.min(business.engagements.length, 8) * 0.55;
      group.add(landmark(kind, color, towerHeight, business.status));
      scene.add(group);
      register(group, { kind: 'city', business });
      const top = kind === 'product' ? towerHeight * 1.45 + 1.8 : towerHeight + 1;
      const cityLabel = addLabel(business.status === 'concept' ? `${business.name}（構想）` : business.name, new THREE.Vector3(x, top, z), `is-city is-${kind}`, { priority: LABEL_PRIORITY.city, owner: group });
      cityLabel.business = business;
      const n = business.engagements.length;
      const cols = Math.max(2, Math.ceil(Math.sqrt(n + 1)));
      const step = 2.5;
      const cells = [];
      for (let row = 0; row < cols; row += 1) {
        for (let col = 0; col < cols; col += 1) {
          const cx = -((cols - 1) * step) / 2 + col * step;
          const cz = -((cols - 1) * step) / 2 + row * step;
          if (Math.abs(cx) < 2.2 && Math.abs(cz) < 2.2) continue; // the landmark's lot
          cells.push([cx, cz]);
        }
      }
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
        tree(x + Math.cos(a) * size * 0.42, z + Math.sin(a) * size * 0.42, 0.8);
      }
    }
    for (const { kind, angle } of sectors) {
      addLabel(KIND_LABELS[kind] ?? kind, new THREE.Vector3(Math.cos(angle) * 21, 0.2, Math.sin(angle) * 21), `is-sector is-${kind}`, { priority: LABEL_PRIORITY.sector });
    }
  }

  // --- selection & hover -------------------------------------------------
  const selectionRing = mesh(new THREE.RingGeometry(1, 1.035, 96), new THREE.MeshBasicMaterial({ color: 0x087d62, transparent: true, opacity: 0.9, side: THREE.DoubleSide }), { y: 0.08, shadow: false });
  selectionRing.rotation.x = -Math.PI / 2;
  selectionRing.visible = false;
  scene.add(selectionRing);
  let selected = null;
  let hovered = null;

  function setHighlight(group, on) {
    for (const entry of highlightable.get(group) ?? []) {
      if (on) {
        entry.material.emissive.set(0x3d8f74);
        entry.material.emissiveIntensity = 0.35;
      } else {
        entry.material.emissive.copy(entry.base);
        entry.material.emissiveIntensity = entry.intensity;
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
    selectionRing.position.set((box3.min.x + box3.max.x) / 2, group.userData.kind === 'judgment' ? 0.76 : 0.6, (box3.min.z + box3.max.z) / 2);
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
    if (event.key === 'Escape') {
      select(null);
      onClear();
      resetView();
    }
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
      if (!onScreen || !zoomOk) {
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

  let running = true;
  function frame(time) {
    if (!running) return;
    requestAnimationFrame(frame);
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
        hovered = group;
        if (hovered) setHighlight(hovered, true);
        renderer.domElement.style.cursor = hovered ? 'pointer' : '';
      }
    }
    if (!reducedMotion) {
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
  // Experiment-only inspection handle (read in the browser console while tuning).
  globalThis.__bbWorldDebug = { camera, controls, get flight() { return flight; }, get selected() { return selected; } };

  return {
    buildPlaza,
    buildCities,
    flyTo,
    resetView,
    clearSelection() {
      select(null);
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
    ul.append(el(doc, 'li', { text: `${business.name}（${KIND_LABELS[business.kind] ?? business.kind}・案件${business.engagements.length}件）` }));
  }
  list.append(ul, el(doc, 'h2', { text: '判断の種類' }));
  const ol = el(doc, 'ul');
  for (const row of rows) ol.append(el(doc, 'li', { text: `${rowLabel(row)}：${STATE_LABELS[row.state] ?? row.state}` }));
  list.append(ol);
  root.append(list);
}

export function createWorldView({ root, rail, page, document: explicitDocument, fetcher }) {
  const doc = explicitDocument ?? globalThis.document;
  const reducedMotion = Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const wrap = el(doc, 'div', { className: 'bb-world' });
  root.append(wrap);
  let scene = null;

  const header = workspacePageHeader(doc, {
    crumbs: page?.crumbs ?? ['あなたのBrainbase', '世界（実験）'],
    title: '世界',
    lead: '事業を都市、案件を区画、判断の種類を広場の建物として描いています。見るための画面で、ここからは何も書き換えません。',
    source: page?.source ?? null,
    actions: [workspaceButton(doc, { text: '全体に戻る', onClick: () => { scene?.clearSelection(); showEmptyRail(); scene?.resetView(); } })],
  });
  const notices = el(doc, 'div', { className: 'bb-world-hud', attrs: { 'aria-live': 'polite' } });
  const legend = el(doc, 'div', { className: 'bb-world-legend', attrs: { 'aria-label': '凡例' } });
  for (const [state, label] of Object.entries(STATE_LABELS)) {
    const chip = el(doc, 'span', { className: `bb-world-chip is-${state}`, text: label });
    legend.append(chip);
  }
  legend.append(el(doc, 'span', { className: 'bb-world-chip is-flag', text: '赤い旗＝任せたのに訂正・取り消し' }));
  const stage = el(doc, 'div', { className: 'bb-world-stage' });
  const labelsLayer = el(doc, 'div', { className: 'bb-world-labels' });
  stage.append(labelsLayer, notices, legend);
  wrap.append(header, stage);

  function showRail(nodes) {
    if (!rail) return;
    rail.replaceChildren(...nodes);
  }
  const showEmptyRail = () => showRail([workspaceDetailEmpty(doc, { mark: '◇', title: '都市や建物を選ぶと、ここに出ます', text: 'ドラッグで移動、ホイールで寄る・離れる、右ドラッグで回転します。Escで全体に戻ります。' })]);
  showEmptyRail();

  let proofs = new Map();
  let placement = { byBusiness: new Map(), unplaced: [] };

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

  function onPick(data, position) {
    if (data.kind === 'city' || data.kind === 'engagement') {
      const business = data.business;
      scene?.flyTo(new THREE.Vector3(position.x, 0, position.z), data.kind === "engagement" ? 3.6 : 2.8);
      const blocks = [workspaceRailHead(doc, {
        kicker: data.kind === 'engagement' ? `${business.name} の案件` : `事業・${KIND_LABELS[business.kind] ?? business.kind}`,
        title: data.kind === 'engagement' ? data.engagement.name : business.name,
        lead: data.kind === 'engagement' ? data.engagement.summary ?? undefined : business.purpose ?? undefined,
      })];
      if (data.kind === 'engagement') {
        blocks.push(workspaceRailBlock(doc, { title: '登録', content: workspaceDefinition(doc, [['状態', statusText(data.engagement.status)], ['Graph ID', data.engagement.id]]) }));
      } else {
        const open = business.engagements.filter((engagement) => !FINISHED_STATUSES.has(engagement.status)).length;
        blocks.push(workspaceRailBlock(doc, { title: '登録', content: workspaceDefinition(doc, [['状態', statusText(business.status)], ['コード', business.code], ['案件', `${business.engagements.length}件（動いている${open}件）`]]) }));
        const ul = el(doc, 'ul', { className: 'bb-world-rail-list' });
        for (const engagement of business.engagements) ul.append(el(doc, 'li', { text: `${engagement.name}（${statusText(engagement.status)}）` }));
        blocks.push(workspaceRailBlock(doc, { title: '案件（区画）', content: business.engagements.length ? ul : { text: '登録された案件はありません' } }));
      }
      blocks.push(cityJudgmentBlock(business));
      showRail(blocks);
      return;
    }
    if (data.kind === 'cityJudgments') {
      const business = data.business;
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
      showRail(blocks);
    }
  }

  async function load() {
    const [businessesResult, homeResult, placesResult] = await Promise.all([
      readJson(fetcher, '/api/extensions/world/businesses'),
      readJson(fetcher, '/api/value-proofs/home'),
      readJson(fetcher, '/api/extensions/world/judgment-places'),
    ]);
    notices.replaceChildren();
    const note = (label, textValue, tone = 'info') => {
      const line = el(doc, 'p', { className: `bb-world-hud-line is-${tone}`, attrs: tone === 'info' ? {} : { role: 'alert' } });
      line.append(el(doc, 'strong', { text: label }), el(doc, 'span', { text: textValue }));
      notices.append(line);
    };
    const businessPayload = businessesResult.ok ? businessesResult.data : null;
    const businesses = businessPayload?.status === 'ok' ? businessPayload.businesses : [];
    if (!businessesResult.ok || businessPayload?.status !== 'ok') {
      const reason = businessesResult.ok ? `${BUSINESS_STATE_TEXT[businessPayload?.status] ?? '状態不明'}（${businessPayload?.reason ?? '理由不明'}）` : `取得に失敗しました（${businessesResult.error}）`;
      note('事業', `${reason}。事業は0件ではありません。`, 'warning');
    } else {
      const extra = [];
      if (businessPayload.unplaced.length) extra.push(`どの事業にも属さない案件${businessPayload.unplaced.length}件は描いていません`);
      if (businessPayload.excluded.inactive) extra.push(`終了・統合済み${businessPayload.excluded.inactive}件は除外`);
      note('事業', `組織のGraph（${businessPayload.source.server}）の事業${businesses.length}件・案件${businesses.reduce((sum, business) => sum + business.engagements.length, 0)}件。${extra.join('。')}${extra.length ? '。' : ''}`);
    }
    const home = homeResult.ok ? homeResult.data : null;
    const readable = home?.status === 'available' && Array.isArray(home.delegation_map?.rows);
    const rows = readable ? home.delegation_map.rows : [];
    if (!homeResult.ok || !readable) {
      note('判断', `判断の記録を読めません（${homeResult.ok ? home?.reason ?? home?.status ?? '状態不明' : homeResult.error}）。0件ではありません。`, 'warning');
    } else {
      proofs = proofIndex(home);
      const waiting = [...proofs.values()].filter(isWaiting).length;
      const places = placesResult.ok && placesResult.data?.status === 'available' ? placesResult.data.places : null;
      if (places) {
        // Only judgments the home lists are placed, so the world and 今日 count the same judgments.
        const known = places.filter((place) => proofs.has(place.decision_attempt_id)).map((place) => ({ ...place, item: proofs.get(place.decision_attempt_id) }));
        placement = groupJudgmentPlaces(known, businesses);
        const placed = known.length - placement.unplaced.length;
        note('判断', `${home.delegation_map.judged}件のうち${placed}件を作業した事業の判断所に、${placement.unplaced.length}件は事業が分からないため広場に。今あなたを待っている判断${waiting}件${waiting ? '（光の柱）' : ''}。`, waiting ? 'attention' : 'info');
      } else {
        note('判断', `${home.delegation_map.judged}件。作業した場所を読めないため、事業には置かず広場の種類別だけで描いています（${placesResult.ok ? placesResult.data?.reason ?? '理由不明' : placesResult.error}）。今あなたを待っている判断${waiting}件。`, 'warning');
      }
    }
    const rowItems = new Map(rows.map((row) => [row.key, Array.isArray(row.items) ? row.items : []]));

    if (!webglAvailable(doc)) {
      note('表示', 'この環境では3Dを表示できないため、一覧で出しています。', 'warning');
      stage.hidden = true;
      renderFallbackList(doc, wrap, businesses, rows);
      return;
    }
    scene = createScene({ doc, stage, labelsLayer, reducedMotion, onPick, onClear: showEmptyRail });
    scene.buildPlaza(rows, rowItems, (row) => (rowItems.get(row.key) ?? []).filter((ref) => isWaiting(proofs.get(ref.decision_attempt_id))).length, Date.now());
    scene.buildCities(layoutWorld(businesses), placement.byBusiness);
  }

  void load();
  return {
    dispose() {
      scene?.dispose();
    },
  };
}

export const screen = Object.freeze({
  id: 'world',
  label: '世界（実験）',
  usesGraph: false,
  rail: true,
  source: '組織のGraph・判断journal（読み取りのみ）',
  mount(container, context) {
    const root = context.document.createElement('div');
    root.className = 'bb-shell-page';
    container.append(root);
    return createWorldView({ root, rail: context.rail, page: context.page, document: context.document, fetcher: context.fetcher });
  },
});
