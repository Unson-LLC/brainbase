/*
 * Inside a district (story-world-work-sites-and-gaps-v1, AC-11〜15).
 *
 * Opening a city leaves the world and enters its district: a gate, a main street and two back streets,
 * the business's hall with the stones of its policies, and its work on lots facing the streets.  What a
 * lot looks like is read only from the work's records:
 *   - its recorded state is its form (stakes, scaffolding with a net, a grey cover, a lit house);
 *   - what cannot be seen of it is a phenomenon of the street, never a label: nobody on site (no
 *     assignee), a person outside the fence (named only in the text), no path to the street (no source
 *     link), a blueprint without a building (a completion condition without its record), weeds and faded
 *     colours (a review date passed), fog (the work could not be read).
 * People walking the streets and chimney smoke are the town's atmosphere: they come from no record,
 * never enter a lot, and the legend says so.  Nothing here writes.
 */

import { THREE, MapControls } from './world-vendor.js';
import { DISTRICT_STREETS, districtStreetLots } from './world-placement.js';
import { makeWorkspaceElement as el } from '../../workspace-kit.js';

export const WORLD_DISTRICT_CONTRACT_VERSION = 'brainbase.world-district.v0';

function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

const STATE_WALL = Object.freeze({ in_progress: 0xd8d2c4, waiting: 0xcfcac0, pending: 0xd8d2c4, completed: 0xf2ebdd });
const GAP = (site, kind) => site.gaps.some((gap) => gap.kind === kind);

/** The legend of the district: what each phenomenon means, and what means nothing. */
export const DISTRICT_LEGEND = Object.freeze([
  ['is-scaffold', '足場と緑のネット＝進行中（記録上）'],
  ['is-cover', 'ブルーシートの覆い＝待ち（記録上）'],
  ['is-stakes', '杭と縄の空き地＝未着手（記録上）'],
  ['is-house', '明かりのついた家＝完了（記録上）'],
  ['is-worker', 'ヘルメットの人＝担当欄の担当'],
  ['is-empty', '誰もいない現場＝担当の記録なし'],
  ['is-outside', '柵の外の人（破線の輪）＝本文にだけ名前がある'],
  ['is-nopath', '通りへの道が無い＝出典リンクなし'],
  ['is-blueprint', '図面の看板だけ＝成果物の記録が未接続'],
  ['is-weeds', '雑草と色あせ＝見直し予定を過ぎた'],
  ['is-stone', '庁舎前の石碑＝方針の決定（枠だけ＝題名からの推定）'],
  ['is-street', '通りの看板＝何のための仕事か（タスクの記録の言葉。言葉が無い仕事は門の近くの空き地）'],
  ['is-ambience', '通りを歩く人と煙＝街の雰囲気（記録とは関係しません）'],
]);

function canvasTexture(doc, width, height, draw) {
  const canvas = doc.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d'), width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createDistrictView({ doc, stage, reducedMotion = false, onPick, onClear, onEscape }) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio ?? 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.domElement.className = 'bb-world-canvas bb-world-district-canvas';
  renderer.domElement.tabIndex = 0;
  renderer.domElement.hidden = true;
  stage.prepend(renderer.domElement);
  const labelsLayer = el(doc, 'div', { className: 'bb-world-labels is-district' });
  labelsLayer.hidden = true;
  stage.append(labelsLayer);
  const legend = el(doc, 'details', { className: 'bb-world-district-legend', attrs: { open: true } });
  legend.append(el(doc, 'summary', { text: '区画の見方' }));
  const legendList = el(doc, 'ul');
  for (const [className, text] of DISTRICT_LEGEND) legendList.append(el(doc, 'li', { className, text }));
  legend.append(legendList);
  legend.hidden = true;
  stage.append(legend);
  const notice = el(doc, 'p', { className: 'bb-world-district-notice', attrs: { role: 'status' } });
  notice.hidden = true;
  stage.append(notice);

  const scene = new THREE.Scene();
  scene.background = canvasTexture(doc, 16, 256, (ctx, w, h) => {
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, '#a9cdea');
    gradient.addColorStop(0.6, '#e2eef0');
    gradient.addColorStop(1, '#f3efe3');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
  });
  scene.fog = new THREE.Fog(0xe7efee, 70, 170);
  scene.add(new THREE.HemisphereLight(0xf6f9ff, 0xd8ccb2, 1.25));
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.4);
  sun.position.set(30, 55, 22);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 160 });
  sun.shadow.bias = -0.0005;
  scene.add(sun);

  const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 600);
  const controls = new MapControls(camera, renderer.domElement);
  controls.enableDamping = !reducedMotion;
  controls.dampingFactor = 0.08;
  controls.screenSpacePanning = false;
  controls.minDistance = 8;
  controls.maxDistance = 95;
  controls.maxPolarAngle = 1.22;
  controls.minPolarAngle = 0.35;

  const material = (color, options = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.02, ...options });
  const mesh = (geometry, mat, { x = 0, y = 0, z = 0, shadow = true } = {}) => {
    const object = new THREE.Mesh(geometry, mat);
    object.position.set(x, y, z);
    object.castShadow = shadow;
    object.receiveShadow = true;
    return object;
  };
  const box = (w, h, d, color, at = {}, options = {}) => mesh(new THREE.BoxGeometry(w, h, d), material(color, options), { y: h / 2, ...at });

  let root = null;
  let lots = new Map();
  let labels = [];
  let walkers = [];
  let puffs = [];
  let open = false;
  let selected = null;
  let hovered = null;
  let flight = null;
  let home = null;
  let focusIds = null;
  const selectionRing = mesh(new THREE.RingGeometry(1.75, 1.95, 48), new THREE.MeshBasicMaterial({ color: 0x087d62, transparent: true, opacity: 0.9, side: THREE.DoubleSide }), { y: 0.09, shadow: false });
  selectionRing.rotation.x = -Math.PI / 2;
  selectionRing.visible = false;

  function addLabel(text, position, className, { owner = null, near = Infinity, priority = 5 } = {}) {
    const node = el(doc, 'div', { className: `bb-world-label ${className}`, text });
    node.setAttribute('aria-hidden', 'true');
    labelsLayer.append(node);
    const label = { node, position, owner, near, priority, size: null };
    labels.push(label);
    return label;
  }

  // --- people (records: worker, person named in the text; atmosphere: walkers) ---------------------
  function person(clothes, { helmet = false } = {}) {
    const group = new THREE.Group();
    group.add(mesh(new THREE.CapsuleGeometry(0.2, 0.46, 4, 10), material(clothes), { y: 0.5 }));
    group.add(mesh(new THREE.SphereGeometry(0.17, 12, 10), material(0xf0cfae), { y: 1.0 }));
    if (helmet) group.add(mesh(new THREE.SphereGeometry(0.19, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), material(0xf2c230, { roughness: 0.5 }), { y: 1.05 }));
    return group;
  }

  // --- a lot, in local space: its front (the street) toward +z -------------------------------------
  function lotGroup(site) {
    const group = new THREE.Group();
    const overdue = GAP(site, 'review_overdue');
    const fade = (color) => (overdue ? new THREE.Color(color).lerp(new THREE.Color(0xb9b29a), 0.45) : new THREE.Color(color));
    const half = DISTRICT_STREETS.lot / 2;
    group.add(box(DISTRICT_STREETS.lot, 0.06, DISTRICT_STREETS.lot, overdue ? 0xc9c0a2 : 0xd9d4c4));
    const status = site.work.status;
    const building = status === 'in_progress' || status === 'waiting';
    if (status !== 'completed') {
      // A low site fence, open toward the street.
      const fenceMat = material(0xe9e4d6);
      for (const [x, z, w, d] of [[0, -half + 0.05, DISTRICT_STREETS.lot, 0.06], [-half + 0.05, 0, 0.06, DISTRICT_STREETS.lot], [half - 0.05, 0, 0.06, DISTRICT_STREETS.lot], [-half * 0.65, half - 0.05, half * 0.7, 0.06], [half * 0.65, half - 0.05, half * 0.7, 0.06]]) {
        group.add(mesh(new THREE.BoxGeometry(w, 0.35, d), fenceMat, { x, y: 0.2, z }));
      }
    }
    if (status === 'pending' || status === null) {
      // Stakes and string: the lot is marked, nothing is built.
      const stake = material(0x9b7b55);
      for (const [x, z] of [[-0.8, -0.8], [0.8, -0.8], [0.8, 0.6], [-0.8, 0.6]]) group.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.6, 6), stake, { x, y: 0.3, z }));
      const string = material(0xf4f1e8);
      for (const [x, z, w, d] of [[0, -0.8, 1.6, 0.02], [0, 0.6, 1.6, 0.02], [-0.8, -0.1, 0.02, 1.4], [0.8, -0.1, 0.02, 1.4]]) group.add(mesh(new THREE.BoxGeometry(w, 0.02, d), string, { x, y: 0.5, z, shadow: false }));
    }
    if (building) {
      const floors = 1 + Math.floor(hash(`${site.task_id}f`) * 2);
      const height = 0.75 * floors;
      group.add(box(1.7, height, 1.5, fade(STATE_WALL[status]), { z: -0.25 }));
      // Scaffolding: a frame of edges around the building.
      const frame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(2.0, height + 0.6, 1.8)), new THREE.LineBasicMaterial({ color: 0x8c8f8a }));
      frame.position.set(0, (height + 0.6) / 2, -0.25);
      group.add(frame);
      if (status === 'in_progress') {
        const net = mesh(new THREE.PlaneGeometry(2.0, height + 0.5), material(0x4f9a5c, { transparent: true, opacity: 0.55, side: THREE.DoubleSide }), { y: (height + 0.5) / 2, z: 0.66, shadow: false });
        group.add(net);
        // A crane over a site being worked.
        group.add(mesh(new THREE.BoxGeometry(0.12, 3.6, 0.12), material(0xe0a526), { x: 0.9, y: 1.8, z: -0.9 }));
        group.add(mesh(new THREE.BoxGeometry(2.2, 0.1, 0.1), material(0xe0a526), { x: 0.2, y: 3.5, z: -0.9 }));
      } else {
        // Waiting: a blue tarp over the building, as on a site where work is held.
        group.add(box(1.9, height + 0.4, 1.7, fade(0x3f78b5), { z: -0.25 }, { transparent: true, opacity: 0.9, roughness: 0.6 }));
      }
    }
    if (status === 'completed') {
      group.add(box(1.6, 1.0, 1.4, 0xf2ebdd, { z: -0.3 }));
      const roof = mesh(new THREE.ConeGeometry(1.25, 0.7, 4), material(0xb5654a), { y: 1.35, z: -0.3 });
      roof.rotation.y = Math.PI / 4;
      group.add(roof);
      group.add(mesh(new THREE.BoxGeometry(0.5, 0.36, 0.04), material(0xffd98c, { emissive: new THREE.Color(0xffc867), emissiveIntensity: 0.9 }), { y: 0.55, z: 0.41, shadow: false }));
      group.add(mesh(new THREE.BoxGeometry(0.2, 0.5, 0.2), material(0x9c7a62), { x: 0.4, y: 1.5, z: -0.6 }));
      group.userData.chimney = new THREE.Vector3(0.4, 1.8, -0.6);
    }
    // A path to the street only when the record links its source.
    if (!GAP(site, 'source_unlinked') && !GAP(site, 'outcome_unlinked')) {
      group.add(mesh(new THREE.BoxGeometry(0.7, 0.04, 1.0), material(0xbdb7aa), { y: 0.05, z: half + 0.45, shadow: false }));
    }
    // A blueprint stands where the completion condition is, with no record of what was made.
    if (GAP(site, 'outcome_unlinked')) {
      const board = canvasTexture(doc, 64, 48, (ctx, w, h) => {
        ctx.fillStyle = '#2f5d9c';
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(6, 6, w - 12, h - 12);
        ctx.strokeRect(14, 14, 18, 12);
        ctx.beginPath();
        ctx.moveTo(36, 14);
        ctx.lineTo(56, 30);
        ctx.stroke();
      });
      group.add(mesh(new THREE.BoxGeometry(0.05, 0.9, 0.05), material(0x6b5b4a), { x: 0.6, y: 0.45, z: 0.9 }));
      group.add(mesh(new THREE.BoxGeometry(0.9, 0.62, 0.04), [material(0xf3efe6), material(0xf3efe6), material(0xf3efe6), material(0xf3efe6), new THREE.MeshBasicMaterial({ map: board }), material(0xf3efe6)], { x: 0.6, y: 1.05, z: 0.92 }));
    }
    // Weeds where the record was not looked at again by its review date.
    if (overdue) {
      const weed = material(0x7f8f4a, { flatShading: true });
      for (let i = 0; i < 7; i += 1) {
        const x = (hash(`${site.task_id}w${i}x`) - 0.5) * 2.4;
        const z = (hash(`${site.task_id}w${i}z`) - 0.5) * 2.4;
        group.add(mesh(new THREE.ConeGeometry(0.09, 0.32 + hash(`${site.task_id}w${i}h`) * 0.25, 5), weed, { x, y: 0.2, z, shadow: false }));
      }
    }
    // People from the records: the assignee on site; a person named only in the text, outside the fence.
    const recorded = site.people.filter((entry) => entry.link === 'recorded');
    const named = site.people.filter((entry) => entry.link === 'inferred').length + (site.ambiguous_mentions?.length ?? 0);
    if (recorded.length && status !== 'completed') {
      const worker = person(0x3d6f9e, { helmet: true });
      worker.position.set(0.55, 0.06, 0.55);
      group.add(worker);
    }
    if (named && status !== 'completed') {
      const outside = person(0x6b5b95);
      outside.position.set(-0.95, 0, half + 0.65);
      outside.rotation.y = Math.PI;
      group.add(outside);
      const ringMat = new THREE.MeshBasicMaterial({ color: 0x5b4a8a, side: THREE.DoubleSide });
      for (let i = 0; i < 8; i += 1) {
        const arc = mesh(new THREE.RingGeometry(0.34, 0.42, 6, 1, (i / 8) * Math.PI * 2, Math.PI / 8), ringMat, { x: -0.95, y: 0.03, z: half + 0.65, shadow: false });
        arc.rotation.x = -Math.PI / 2;
        group.add(arc);
      }
    }
    return group;
  }

  // --- the district -------------------------------------------------------------------------------
  function clear() {
    if (root) scene.remove(root);
    for (const label of labels) label.node.remove();
    labels = [];
    lots = new Map();
    walkers = [];
    puffs = [];
    selected = null;
    hovered = null;
    focusIds = null;
    selectionRing.visible = false;
  }

  function build(business, work, neighbours) {
    clear();
    root = new THREE.Group();
    scene.add(root);
    root.add(selectionRing);
    const readable = work?.status === 'ok' && (work.reads.tasks.state === 'complete' || work.reads.tasks.state === 'partial');
    const shown = readable ? work.sites.filter((site) => site.work.status !== 'cancelled') : [];
    const layout = districtStreetLots(shown.map((site) => ({ task_id: site.task_id, created_at: site.work.created_at, purpose_label: site.purpose_label })));
    const L = layout.length;
    const gateZ = L / 2 + 4;
    const hallZ = -L / 2 - 7;
    // Land, the district's paving, the main street and the back streets.
    const land = mesh(new THREE.PlaneGeometry(260, 260), material(0xa9c595, { roughness: 1 }), { shadow: false });
    land.rotation.x = -Math.PI / 2;
    root.add(land);
    const paving = mesh(new THREE.PlaneGeometry(26, L + 22), material(0xe9e4d6, { roughness: 1 }), { y: 0.01, z: (gateZ + hallZ) / 2, shadow: false });
    paving.rotation.x = -Math.PI / 2;
    root.add(paving);
    const asphalt = material(0x8e938f, { roughness: 0.95 });
    const street = (x, width, from, to) => {
      const strip = mesh(new THREE.PlaneGeometry(width, Math.abs(to - from)), asphalt, { x, y: 0.02, z: (from + to) / 2, shadow: false });
      strip.rotation.x = -Math.PI / 2;
      root.add(strip);
    };
    street(0, DISTRICT_STREETS.main * 2, gateZ + 8, hallZ + 3);
    street(-DISTRICT_STREETS.backStreet, 2, L / 2 + 1, -L / 2 - 1);
    street(DISTRICT_STREETS.backStreet, 2, L / 2 + 1, -L / 2 - 1);
    // A cross street between the blocks, and at the hall end of each block a sign saying what its work is for.
    const crossWidth = DISTRICT_STREETS.backLot * 2 + 4;
    layout.streets.forEach((block, index) => {
      if (index < layout.streets.length - 1) {
        const strip = mesh(new THREE.PlaneGeometry(crossWidth, DISTRICT_STREETS.cross * 0.7), asphalt, { y: 0.02, z: block.z_to + DISTRICT_STREETS.cross / 2, shadow: false });
        strip.rotation.x = -Math.PI / 2;
        root.add(strip);
      }
      const signZ = block.z_from - (index === 0 ? 0.9 : DISTRICT_STREETS.cross / 2);
      root.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.4, 6), material(0x4a4a4a), { x: -DISTRICT_STREETS.main - 0.5, y: 1.2, z: signZ }));
      root.add(mesh(new THREE.BoxGeometry(1.9, 0.5, 0.08), material(block.label ? 0x2f6e4f : 0xbfb8a8), { x: -DISTRICT_STREETS.main - 0.5, y: 2.3, z: signZ }));
      const text = block.label ? `${block.label}（${block.count}件）` : `未分類の空き地：何のための仕事か未記録（${block.count}件）`;
      addLabel(text, new THREE.Vector3(-DISTRICT_STREETS.main - 0.5, 2.9, signZ), `is-street${block.label ? '' : ' is-unlabelled'}`, { priority: 2 });
    });
    // Trees and lamps along the main street, between the lots (scenery).
    const trunk = material(0x7d6249);
    const crown = material(0x6f9a5c, { flatShading: true });
    for (let z = -L / 2; z <= L / 2; z += DISTRICT_STREETS.row) {
      for (const x of [-2.4, 2.4]) {
        const at = z + DISTRICT_STREETS.row / 2;
        if (at > L / 2) continue;
        root.add(mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.8, 6), trunk, { x, y: 0.4, z: at }));
        root.add(mesh(new THREE.IcosahedronGeometry(0.55, 0), crown, { x, y: 1.15, z: at }));
      }
    }
    // The gate.
    const stone = material(0xe2dccf);
    root.add(box(0.7, 4.2, 0.7, 0xe2dccf, { x: -3.2, z: gateZ }));
    root.add(box(0.7, 4.2, 0.7, 0xe2dccf, { x: 3.2, z: gateZ }));
    root.add(mesh(new THREE.BoxGeometry(7.6, 0.6, 0.9), stone, { y: 4.4, z: gateZ }));
    addLabel(`${business.name}の区画（入口）`, new THREE.Vector3(0, 5.2, gateZ), 'is-city', { priority: 1 });
    // The hall: what this business is for, and the stones of its policies in front of it.
    root.add(box(8, 3.6, 4.4, 0xeee8dc, { z: hallZ }));
    root.add(mesh(new THREE.BoxGeometry(8.6, 0.3, 5.0), stone, { y: 3.75, z: hallZ }));
    for (let i = 0; i < 6; i += 1) root.add(mesh(new THREE.CylinderGeometry(0.16, 0.18, 3.0, 10), material(0xf7f4ee), { x: -3.1 + i * 1.24, y: 1.5, z: hallZ + 2.5 }));
    const pediment = mesh(new THREE.ConeGeometry(4.9, 1.2, 4), material(0xf7f4ee), { y: 4.5, z: hallZ });
    pediment.rotation.y = Math.PI / 4;
    pediment.scale.z = 0.6;
    root.add(pediment);
    root.add(box(0.4, 0.9, 0.4, 0x9c7a62, { x: 2.8, y: 3.9, z: hallZ - 1.2 }));
    const hallChimney = new THREE.Vector3(2.8, 4.8, hallZ - 1.2);
    const purposeText = work?.status === 'ok' ? (work.purpose.text ?? '目的は未登録') : '目的を読めません';
    addLabel(`庁舎：${business.name}（${purposeText}）`, new THREE.Vector3(0, 5.6, hallZ), 'is-plaza', { priority: 1 });
    const plaza = mesh(new THREE.CircleGeometry(3.6, 40), material(0xf1ece1), { y: 0.03, z: hallZ + 5.4, shadow: false });
    plaza.rotation.x = -Math.PI / 2;
    root.add(plaza);
    const policies = work?.status === 'ok' ? work.purpose.policies.slice(0, 8) : [];
    policies.forEach((policy, index) => {
      const angle = Math.PI * (0.15 + (0.7 * index) / Math.max(policies.length - 1, 1));
      const x = Math.cos(angle) * 2.8;
      const z = hallZ + 5.4 + Math.sin(angle) * 1.6;
      if (policy.link === 'recorded') {
        root.add(box(0.5, 1.2, 0.22, 0xa8a49a, { x, z }));
      } else {
        const outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(0.5, 1.2, 0.22)), new THREE.LineDashedMaterial({ color: 0x5b4a8a, dashSize: 0.12, gapSize: 0.08 }));
        outline.computeLineDistances();
        outline.position.set(x, 0.6, z);
        root.add(outline);
      }
      const title = policy.title.length > 18 ? `${policy.title.slice(0, 17)}…` : policy.title;
      addLabel(`${policy.link === 'recorded' ? '━' : '┅'} ${title}`, new THREE.Vector3(x, 1.5, z), `is-link is-${policy.link === 'recorded' ? 'recorded' : 'inferred'}`, { near: 30, priority: 4 });
    });
    // Signposts outside the gate: the roads to other businesses.
    const roads = new Map();
    for (const relation of work?.status === 'ok' ? work.relations : []) {
      if (!relation.business_code || relation.link === 'unreadable') continue;
      const key = `${relation.business_code}|${relation.link}`;
      if (!roads.has(key)) roads.set(key, { link: relation.link, name: neighbours.get(relation.business_code) ?? relation.business_code, texts: [] });
      roads.get(key).texts.push(relation.label);
    }
    [...roads.values()].forEach((road, index) => {
      const x = index % 2 === 0 ? -5.4 : 5.4;
      const z = gateZ + 2.2 + Math.floor(index / 2) * 1.6;
      root.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.0, 6), material(0x6b5b4a), { x, y: 1.0, z }));
      root.add(mesh(new THREE.BoxGeometry(1.6, 0.36, 0.06), material(road.link === 'recorded' ? 0x1261ad : 0xd9d2e6), { x, y: 1.8, z }));
      addLabel(`${road.link === 'recorded' ? '━' : '┅'} ${road.name}へ：${road.texts[0]}`, new THREE.Vector3(x, 2.3, z), `is-link is-${road.link}`, { priority: 3 });
    });
    // The lots.
    for (const site of shown) {
      const lot = layout.lots[site.task_id];
      const group = lotGroup(site);
      group.position.set(lot.x, 0, lot.z);
      group.rotation.y = lot.facing > 0 ? Math.PI / 2 : -Math.PI / 2;
      group.userData = { kind: 'site', site, chimney: group.userData.chimney ?? null };
      root.add(group);
      lots.set(site.task_id, group);
      const title = site.title.length > 15 ? `${site.title.slice(0, 14)}…` : site.title;
      addLabel(title, new THREE.Vector3(lot.x, 2.6, lot.z), `is-site${site.gaps.length ? ' is-check' : ''}`, { owner: group, near: 15, priority: 6 });
    }
    // Atmosphere: walkers on the sidewalks and back streets, smoke from chimneys (no record behind them).
    const routes = [-1.55, 1.55, -DISTRICT_STREETS.backStreet + 0.6, DISTRICT_STREETS.backStreet - 0.6];
    const palette = [0xc0504d, 0x4f81bd, 0x9bbb59, 0x8064a2, 0xf79646, 0x4bacc6, 0x7f7f7f, 0xd99694];
    for (let i = 0; i < 10; i += 1) {
      const walker = person(palette[i % palette.length]);
      const x = routes[i % routes.length];
      walker.userData = { x, from: -L / 2 - 1, to: L / 2 + (x === routes[0] || x === routes[1] ? 6 : 1), speed: 0.6 + hash(`walk${i}s`) * 0.6, phase: hash(`walk${i}p`) };
      root.add(walker);
      walkers.push(walker);
    }
    root.updateMatrixWorld(true);
    const chimneys = [hallChimney];
    for (const group of lots.values()) {
      if (!group.userData.chimney) continue;
      chimneys.push(group.localToWorld(group.userData.chimney.clone()));
    }
    const smoke = new THREE.MeshLambertMaterial({ color: 0xf3f3f3, transparent: true, opacity: 0.5, depthWrite: false });
    for (const at of chimneys) {
      for (let i = 0; i < 4; i += 1) {
        const puff = mesh(new THREE.SphereGeometry(0.22, 8, 6), smoke.clone(), { x: at.x, y: at.y, z: at.z, shadow: false });
        puff.userData = { base: at.clone(), phase: i / 4 };
        root.add(puff);
        puffs.push(puff);
      }
    }
    // Fog when the work could not be read: the district cannot be seen, which is not empty.
    scene.fog.near = readable ? 70 : 6;
    scene.fog.far = readable ? 170 : 34;
    notice.hidden = readable;
    if (!readable) {
      const reason = work?.status === 'ok' ? work.reads.tasks.reason ?? work.reads.tasks.state : work?.reason ?? work?.status ?? '理由不明';
      notice.textContent = `仕事の記録を読めないため、区画の中は霧で見えません（${reason}）。仕事が0件という意味ではありません。`;
    }
    home = { target: new THREE.Vector3(0, 0, -1.5), position: new THREE.Vector3(14, 30, gateZ + 24) };
  }

  // --- camera, picking, frame loop ------------------------------------------------------------------
  function fly(target, position, duration = 900) {
    if (reducedMotion) {
      controls.target.copy(target);
      camera.position.copy(position);
      return;
    }
    controls.enabled = false;
    flight = { from: { target: controls.target.clone(), position: camera.position.clone() }, to: { target, position }, started: null, duration };
  }

  function resize() {
    const rect = stage.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    renderer.setSize(rect.width, rect.height, false);
    camera.aspect = rect.width / rect.height;
    camera.updateProjectionMatrix();
  }
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  observer?.observe(stage);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  function pickAt(clientX, clientY) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const targets = [...lots.values()];
    for (const hit of raycaster.intersectObjects(targets, true)) {
      let object = hit.object;
      while (object && !targets.includes(object)) object = object.parent;
      if (object) return object;
    }
    return null;
  }
  let downAt = null;
  renderer.domElement.addEventListener('pointerdown', (event) => { downAt = { x: event.clientX, y: event.clientY }; });
  renderer.domElement.addEventListener('pointermove', (event) => {
    const group = pickAt(event.clientX, event.clientY);
    hovered = group;
    renderer.domElement.style.cursor = group ? 'pointer' : '';
  });
  renderer.domElement.addEventListener('pointerup', (event) => {
    if (!downAt || Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y) > 5) return;
    const group = pickAt(event.clientX, event.clientY);
    if (group) {
      select(group);
      onPick?.(group.userData.site);
    } else {
      select(null);
      onClear?.();
    }
  });
  renderer.domElement.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') onEscape?.();
  });

  function select(group) {
    selected = group;
    if (!group) {
      selectionRing.visible = false;
      return;
    }
    selectionRing.position.set(group.position.x, 0.09, group.position.z);
    selectionRing.visible = true;
    const at = group.position.clone();
    fly(new THREE.Vector3(at.x, 0, at.z), new THREE.Vector3(at.x + (at.x > 0 ? 9 : -9), 11, at.z + 12));
  }

  function applyFocus() {
    for (const [taskId, group] of lots) {
      const on = !focusIds || focusIds.has(taskId);
      group.traverse((child) => {
        if (!child.isMesh && !child.isLineSegments) return;
        for (const mat of Array.isArray(child.material) ? child.material : [child.material]) {
          mat.userData.focusBase ??= { transparent: mat.transparent, opacity: mat.opacity };
          mat.transparent = on ? mat.userData.focusBase.transparent : true;
          mat.opacity = on ? mat.userData.focusBase.opacity : 0.15;
          mat.needsUpdate = true;
        }
      });
    }
  }

  const projected = new THREE.Vector3();
  function placeLabels() {
    const rect = stage.getBoundingClientRect();
    const placed = [];
    const visible = [];
    for (const label of labels) {
      const owner = label.owner;
      const taskId = owner?.userData?.site?.task_id;
      const emphasised = owner && (owner === selected || owner === hovered || (focusIds && focusIds.has(taskId)));
      const hiddenByFocus = owner && focusIds && !focusIds.has(taskId);
      const distance = camera.position.distanceTo(label.position);
      projected.copy(label.position).project(camera);
      const onScreen = projected.z < 1 && Math.abs(projected.x) < 1.05 && Math.abs(projected.y) < 1.05;
      if (!onScreen || hiddenByFocus || (!emphasised && distance > label.near)) {
        label.node.hidden = true;
        continue;
      }
      label.screen = { x: ((projected.x + 1) / 2) * rect.width, y: ((1 - projected.y) / 2) * rect.height };
      label.rank = emphasised ? 0 : label.priority;
      visible.push(label);
    }
    visible.sort((a, b) => a.rank - b.rank);
    for (const label of visible) {
      label.node.hidden = false;
      label.size ??= { w: label.node.offsetWidth, h: label.node.offsetHeight };
      const box2 = { x: label.screen.x - label.size.w / 2, y: label.screen.y - label.size.h, w: label.size.w, h: label.size.h };
      if (label.rank > 0 && placed.some((other) => box2.x < other.x + other.w + 2 && box2.x + box2.w + 2 > other.x && box2.y < other.y + other.h + 2 && box2.y + box2.h + 2 > other.y)) {
        label.node.hidden = true;
        continue;
      }
      placed.push(box2);
      label.node.style.transform = `translate(${Math.round(box2.x)}px, ${Math.round(box2.y)}px)`;
      label.node.classList.toggle('is-selected', label.rank === 0);
    }
  }

  let running = true;
  function frame(time) {
    if (!running) return;
    requestAnimationFrame(frame);
    if (!open) return;
    if (flight) {
      flight.started ??= time;
      const t = Math.min((time - flight.started) / flight.duration, 1);
      const e = 1 - (1 - t) ** 3;
      controls.target.lerpVectors(flight.from.target, flight.to.target, e);
      camera.position.lerpVectors(flight.from.position, flight.to.position, e);
      camera.lookAt(controls.target);
      if (t >= 1) {
        flight = null;
        controls.enabled = true;
      }
    } else {
      controls.update();
    }
    if (!reducedMotion) {
      const seconds = time / 1000;
      for (const walker of walkers) {
        const { x, from, to, speed, phase } = walker.userData;
        const span = to - from;
        const travel = ((seconds * speed) / span + phase) % 2;
        const forward = travel < 1;
        walker.position.set(x, 0, forward ? from + travel * span : to - (travel - 1) * span);
        walker.rotation.y = forward ? 0 : Math.PI;
        walker.position.y = Math.abs(Math.sin(seconds * 8 * speed)) * 0.04;
      }
      for (const puff of puffs) {
        const cycle = (seconds * 0.25 + puff.userData.phase) % 1;
        puff.position.set(puff.userData.base.x + cycle * 0.5, puff.userData.base.y + cycle * 2.2, puff.userData.base.z);
        puff.scale.setScalar(0.6 + cycle * 1.4);
        puff.material.opacity = 0.5 * (1 - cycle);
      }
    }
    if (selectionRing.visible) selectionRing.material.opacity = 0.6 + 0.3 * Math.sin(time / 300);
    renderer.render(scene, camera);
    placeLabels();
  }
  requestAnimationFrame(frame);

  function setVisible(visible) {
    open = visible;
    renderer.domElement.hidden = !visible;
    labelsLayer.hidden = !visible;
    legend.hidden = !visible;
    if (!visible) notice.hidden = true;
  }

  return {
    /** Enters the district of a business; `neighbours` maps other business codes to their names. */
    show(business, work, { neighbours = new Map() } = {}) {
      build(business, work, neighbours);
      setVisible(true);
      resize();
      // Entering: from high over the gate down to the street.
      camera.position.set(home.position.x * 2.2, home.position.y * 2.4, home.position.z + 40);
      controls.target.copy(home.target);
      camera.lookAt(home.target);
      fly(home.target.clone(), home.position.clone(), 1300);
      renderer.domElement.focus({ preventScroll: true });
    },
    hide() {
      setVisible(false);
    },
    isOpen: () => open,
    /** Back to the view from the gate, keeping the district. */
    home() {
      select(null);
      if (home) fly(home.target.clone(), home.position.clone());
    },
    select(taskId) {
      const group = lots.get(taskId);
      if (!group) return false;
      select(group);
      return true;
    },
    clearSelection() {
      select(null);
    },
    focus(taskIds) {
      focusIds = taskIds ? new Set(taskIds) : null;
      applyFocus();
    },
    dispose() {
      running = false;
      observer?.disconnect();
      controls.dispose();
      renderer.dispose();
    },
  };
}
