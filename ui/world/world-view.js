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

function createScene({ doc, stage, labelsLayer, reducedMotion, onPick }) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio ?? 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.className = 'bb-world-canvas';
  stage.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xeef3ef);
  scene.fog = new THREE.Fog(0xeef3ef, 160, 320);

  const camera = new THREE.OrthographicCamera(-50, 50, 50, -50, 0.1, 1000);
  const home = { position: new THREE.Vector3(90, 95, 90), target: new THREE.Vector3(0, 0, 0), zoom: 1 };
  camera.position.copy(home.position);
  camera.lookAt(home.target);

  const controls = new MapControls(camera, renderer.domElement);
  controls.enableDamping = !reducedMotion;
  controls.dampingFactor = 0.08;
  controls.screenSpacePanning = false;
  controls.minZoom = 0.5;
  controls.maxZoom = 6;
  controls.maxPolarAngle = Math.PI / 2.6;
  controls.minPolarAngle = Math.PI / 6;
  controls.target.copy(home.target);

  scene.add(new THREE.HemisphereLight(0xffffff, 0xc8d4cb, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(60, 120, 30);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -140, right: 140, top: 140, bottom: -140, near: 1, far: 400 });
  scene.add(sun);

  const ground = new THREE.Mesh(new THREE.CircleGeometry(200, 64), new THREE.MeshStandardMaterial({ color: 0xe3eae4, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const pickables = [];
  const labels = [];
  const beacons = [];
  const roads = new THREE.Group();
  scene.add(roads);

  function addLabel(text, position, className, minZoom = 0) {
    const node = makeLabel(doc, text, className);
    labelsLayer.append(node);
    labels.push({ node, position: position.clone(), minZoom });
  }

  function box(w, h, d, color, { x = 0, y = 0, z = 0, emissive = 0x000000, opacity = 1 } = {}) {
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.02, emissive, transparent: opacity < 1, opacity });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y + h / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  function road(from, to) {
    const length = from.distanceTo(to);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.6, length), new THREE.MeshStandardMaterial({ color: 0xd2dbd4, roughness: 1 }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = -Math.atan2(to.z - from.z, to.x - from.x) + Math.PI / 2;
    mesh.position.set((from.x + to.x) / 2, 0.02, (from.z + to.z) / 2);
    mesh.receiveShadow = true;
    roads.add(mesh);
  }

  function buildPlaza(rows, rowItems, waitingOf) {
    const plaza = new THREE.Mesh(new THREE.CylinderGeometry(PLAZA_RADIUS, PLAZA_RADIUS + 0.6, 0.6, 48), new THREE.MeshStandardMaterial({ color: 0xf7faf8, roughness: 0.9 }));
    plaza.position.y = 0.3;
    plaza.receiveShadow = true;
    plaza.userData = { kind: 'plaza' };
    scene.add(plaza);
    pickables.push(plaza);
    addLabel('広場（判断）', new THREE.Vector3(0, 0.8, PLAZA_RADIUS + 1.6), 'is-plaza');
    rows.forEach((row, index) => {
      const angle = (index / Math.max(rows.length, 1)) * Math.PI * 2 - Math.PI / 2;
      const r = rows.length === 1 ? 0 : PLAZA_RADIUS * 0.55;
      const total = row.counts.continued + row.counts.returned;
      const height = 1.4 + Math.log2(1 + total) * 1.6;
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;
      const building = box(2.2, height, 2.2, STATE_COLORS[row.state] ?? 0x929b95, { x, y: 0.6, z });
      building.userData = { kind: 'judgment', row, items: rowItems.get(row.key) ?? [] };
      scene.add(building);
      pickables.push(building);
      const waiting = waitingOf(row);
      if (waiting > 0) {
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 14, 12), new THREE.MeshBasicMaterial({ color: 0xd92335, transparent: true, opacity: 0.55 }));
        beam.position.set(x, 0.6 + height + 7, z);
        scene.add(beam);
        beacons.push(beam);
      }
      if (row.counts.corrected_or_reverted > 0) {
        const flag = box(0.9, 0.6, 0.12, 0xd92335, { x: x + 0.6, y: 0.6 + height + 0.9, z });
        const pole = box(0.08, 1.4, 0.08, 0x1e2822, { x, y: 0.6 + height, z });
        scene.add(flag, pole);
      }
      const stateText = row.state === 'returned' && waiting === 0 ? '戻した・会話で先に進んだ' : STATE_LABELS[row.state] ?? row.state;
      addLabel(`${rowLabel(row)}・${stateText}`, new THREE.Vector3(x, 0.6 + height + 0.6, z), `is-judgment is-${row.state}${waiting > 0 ? ' is-waiting' : ''}`, 1.6);
    });
  }

  function buildCities({ cities, sectors, extent }) {
    fitExtent(extent);
    for (const city of cities) {
      const { business, size, x, z, kind } = city;
      const color = KIND_COLORS[kind] ?? 0x69746d;
      road(new THREE.Vector3(0, 0, 0), new THREE.Vector3(x, 0, z));
      const plate = box(size, 0.5, size, 0xffffff, { x, z });
      plate.material.color.lerp(new THREE.Color(color), 0.12);
      plate.userData = { kind: 'city', business };
      scene.add(plate);
      pickables.push(plate);
      const towerHeight = 3 + Math.min(business.engagements.length, 8) * 0.6;
      const tower = box(2.4, towerHeight, 2.4, color, { x, y: 0.5, z });
      tower.userData = { kind: 'city', business };
      scene.add(tower);
      pickables.push(tower);
      addLabel(business.name, new THREE.Vector3(x, 0.5 + towerHeight + 0.8, z), `is-city is-${kind}`);
      const n = business.engagements.length;
      const cols = Math.ceil(Math.sqrt(Math.max(n, 1)));
      business.engagements.forEach((engagement, index) => {
        const row = Math.floor(index / cols);
        const col = index % cols;
        const step = 2.6;
        const offset = ((cols - 1) * step) / 2;
        let ex = x - offset + col * step;
        let ez = z - offset + row * step;
        // Keep the landmark tower clear.
        if (Math.abs(ex - x) < 1.8 && Math.abs(ez - z) < 1.8) ex += step * 0.9;
        const h = 0.8 + hashUnit(engagement.id) * 1.6;
        const block = box(1.8, h, 1.8, 0xdfe6e0, { x: ex, y: 0.5, z: ez });
        block.material.color.lerp(new THREE.Color(color), 0.28);
        block.userData = { kind: 'engagement', engagement, business };
        scene.add(block);
        pickables.push(block);
        addLabel(engagement.name, new THREE.Vector3(ex, 0.5 + h + 0.4, ez), 'is-engagement', 2.4);
      });
    }
    for (const { kind, angle } of sectors) {
      addLabel(KIND_LABELS[kind] ?? kind, new THREE.Vector3(Math.cos(angle) * 19, 0.2, Math.sin(angle) * 19), `is-sector is-${kind}`);
    }
  }

  // --- interaction ---------------------------------------------------------
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let downAt = null;
  renderer.domElement.addEventListener('pointerdown', (event) => {
    downAt = { x: event.clientX, y: event.clientY };
  });
  renderer.domElement.addEventListener('pointerup', (event) => {
    if (!downAt || Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y) > 5) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(pickables, false)[0];
    if (hit) onPick(hit.object.userData, hit.object.position);
  });

  let flight = null;
  function flyTo(target, zoom) {
    const offset = camera.position.clone().sub(controls.target);
    const to = { target: target.clone(), position: target.clone().add(offset), zoom };
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
  function fitExtent(extent) {
    worldExtent = extent;
    if (width > 0) resize();
  }
  let width = 0;
  let height = 0;
  function resize() {
    const rect = stage.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    width = rect.width;
    height = rect.height;
    renderer.setSize(width, height, false);
    const aspect = width / height;
    const span = Math.max(worldExtent * 0.9 / Math.min(aspect, 1.25), 24);
    Object.assign(camera, { left: -span * aspect, right: span * aspect, top: span, bottom: -span });
    camera.updateProjectionMatrix();
  }
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  observer?.observe(stage);

  let running = true;
  function frame(time) {
    if (!running) return;
    requestAnimationFrame(frame);
    if (!stage.isConnected || stage.offsetParent === null) return;
    if (width === 0) resize();
    if (flight) {
      flight.started ??= time;
      flight.t = Math.min((time - flight.started) / 800, 1);
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
    if (!reducedMotion) {
      const pulse = 0.35 + 0.3 * (1 + Math.sin(time / 380)) / 2;
      for (const beam of beacons) beam.material.opacity = pulse;
    }
    if (!flight) controls.update();
    renderer.render(scene, camera);
    for (const label of labels) {
      projected.copy(label.position).project(camera);
      const visible = camera.zoom >= label.minZoom && projected.z < 1
        && projected.x > -1.1 && projected.x < 1.1 && projected.y > -1.1 && projected.y < 1.1;
      label.node.hidden = !visible;
      if (visible) {
        label.node.style.transform = `translate(-50%, -100%) translate(${((projected.x + 1) / 2) * width}px, ${((1 - projected.y) / 2) * height}px)`;
      }
    }
  }
  requestAnimationFrame(frame);
  // Experiment-only inspection handle (read in the browser console while tuning).
  globalThis.__bbWorldDebug = { camera, controls, get flight() { return flight; } };

  return {
    buildPlaza,
    buildCities,
    flyTo,
    resetView,
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
    actions: [workspaceButton(doc, { text: '全体に戻る', onClick: () => scene?.resetView() })],
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
  showRail([workspaceDetailEmpty(doc, { mark: '◇', title: '都市や建物を選ぶと、ここに出ます', text: 'ドラッグで移動、ホイールで寄る・離れる、右ドラッグで回転します。' })]);

  let proofs = new Map();

  function onPick(data, position) {
    if (data.kind === 'city' || data.kind === 'engagement') {
      const business = data.business;
      scene?.flyTo(new THREE.Vector3(position.x, 0, position.z), 2.6);
      const blocks = [workspaceRailHead(doc, {
        kicker: data.kind === 'engagement' ? `${business.name} の案件` : `事業・${KIND_LABELS[business.kind] ?? business.kind}`,
        title: data.kind === 'engagement' ? data.engagement.name : business.name,
        lead: data.kind === 'engagement' ? data.engagement.summary ?? undefined : business.purpose ?? undefined,
      })];
      if (data.kind === 'engagement') {
        blocks.push(workspaceRailBlock(doc, { title: '登録', content: workspaceDefinition(doc, [['状態', data.engagement.status], ['Graph ID', data.engagement.id]]) }));
      } else {
        blocks.push(workspaceRailBlock(doc, { title: '登録', content: workspaceDefinition(doc, [['状態', business.status], ['コード', business.code], ['案件', `${business.engagements.length}件`]]) }));
        const ul = el(doc, 'ul', { className: 'bb-world-rail-list' });
        for (const engagement of business.engagements) ul.append(el(doc, 'li', { text: engagement.name }));
        blocks.push(workspaceRailBlock(doc, { title: '案件（区画）', content: business.engagements.length ? ul : { text: '登録された案件はありません' } }));
      }
      blocks.push(workspaceRailBlock(doc, { title: 'この事業の判断', content: { text: '判断の記録にはまだ事業の欄がありません（W4で追加予定）。判断は広場に置いています。' } }));
      showRail(blocks);
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
        const found = proofs.get(ref.decision_attempt_id);
        const textValue = found?.proof?.interruption?.question_display_text ?? found?.proof?.decision?.summary ?? ref.decision_attempt_id;
        const suffix = found?.conversation_moved_on_at ? '（会話で先に進んだ）' : found?.answer ? '（回答済み）' : isWaiting(found) ? '（あなたを待っています）' : '';
        ul.append(el(doc, 'li', { text: `${textValue}${suffix}` }));
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
      showRail([workspaceRailHead(doc, {
        kicker: '広場',
        title: '判断の種類',
        lead: '建物1つが判断の種類1つです。高さは判断の件数、色は任せ方の状態です。どの事業の判断かは、まだ記録されていません。',
      })]);
    }
  }

  async function load() {
    const [businessesResult, homeResult] = await Promise.all([
      readJson(fetcher, '/api/extensions/world/businesses'),
      readJson(fetcher, '/api/value-proofs/home'),
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
      note('判断', `${home.delegation_map.judged}件を種類ごとに${rows.length}棟。今あなたを待っている判断${waiting}件${waiting ? '（光の柱）' : ''}。事業の欄が無いため広場に置いています（W4）。`, waiting ? 'attention' : 'info');
    }
    const rowItems = new Map(rows.map((row) => [row.key, Array.isArray(row.items) ? row.items : []]));

    if (!webglAvailable(doc)) {
      note('表示', 'この環境では3Dを表示できないため、一覧で出しています。', 'warning');
      stage.hidden = true;
      renderFallbackList(doc, wrap, businesses, rows);
      return;
    }
    scene = createScene({ doc, stage, labelsLayer, reducedMotion, onPick });
    scene.buildPlaza(rows, rowItems, (row) => (rowItems.get(row.key) ?? []).filter((ref) => isWaiting(proofs.get(ref.decision_attempt_id))).length);
    scene.buildCities(layoutWorld(businesses));
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
