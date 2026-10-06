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
import { DISTRICT_STREETS, districtStage, districtStreetLots, skyAt } from './world-placement.js';
import { canvasTexture, drawFacade, FACADE_SIZES, FACADE_UNITS, gableRoof, hashUnit, paintVertices, roundedPlate, valueNoise } from './world-scenery.js';
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
  ['is-house', '明かりのついた家＝完了して、出典・成果の記録がある（本設の建物）'],
  ['is-prefab', 'プレハブ＝完了したが、出典・成果の記録が無い'],
  ['is-worker', 'ヘルメットの人＝担当欄の担当'],
  ['is-empty', '誰もいない現場＝担当の記録なし'],
  ['is-outside', '柵の外の人（破線の輪）＝本文にだけ名前がある'],
  ['is-nopath', '通りへの道が無い＝出典リンクなし'],
  ['is-blueprint', '図面の看板だけ＝成果物の記録が未接続'],
  ['is-weeds', '雑草と色あせ＝見直し予定を過ぎた'],
  ['is-stone', '庁舎前の石碑＝方針の決定（枠だけ＝題名からの推定）'],
  ['is-street', '通りの看板＝何のための仕事か（タスクの記録の言葉。言葉が無い仕事は門の近くの空き地）'],
  ['is-stage', '区画の段階（更地・村・町・街・都市）＝本設の建物の数。石畳・街灯・噴水・時計塔が増える'],
  ['is-ambience', '通りを歩く人と煙＝街の雰囲気（記録とは関係しません）'],
]);

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

  // The same sky, light and exposure as the world (scenery: it carries no data), following the hour or
  // the sky the viewer fixed in the world.
  const scene = new THREE.Scene();
  let skyMode = 'auto';
  let sky = skyAt(new Date().getHours(), skyMode);
  const skyTexture = (current) => canvasTexture(doc, 256, 256, (ctx, w, h) => {
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, current.top);
    gradient.addColorStop(0.55, current.middle);
    gradient.addColorStop(1, current.bottom);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
    if (current.stars) {
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      for (let i = 0; i < 90; i += 1) ctx.fillRect(hashUnit(`star${i}x`) * w, hashUnit(`star${i}y`) * h * 0.55, 1.2, 1.2);
    }
  });
  scene.fog = new THREE.Fog(sky.fog, 70, 170);
  const hemisphere = new THREE.HemisphereLight(0xf4f8ff, 0xd8ccb2, sky.hemi);
  scene.add(hemisphere);
  const sun = new THREE.DirectionalLight(sky.sun, sky.sunIntensity);
  sun.position.set(34, 58, 24);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.radius = 4;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  Object.assign(sun.shadow.camera, { left: -48, right: 48, top: 48, bottom: -48, near: 1, far: 170 });
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xdfe9ff, 0.6);
  fill.position.set(-40, 30, -30);
  scene.add(fill);
  // Lit windows and street lamps follow the sky (brightest at night); their meaning does not change.
  const litMaterials = new Set();
  const lampMaterials = new Set();
  function applySky() {
    sky = skyAt(new Date().getHours(), skyMode);
    scene.background = skyTexture(sky);
    scene.fog.color.set(sky.fog);
    hemisphere.intensity = sky.hemi;
    sun.color.set(sky.sun);
    sun.intensity = sky.sunIntensity;
    renderer.toneMappingExposure = sky.exposure;
    for (const mat of litMaterials) mat.emissiveIntensity = sky.glow;
    for (const mat of lampMaterials) mat.emissiveIntensity = sky.lamps ? 1.8 : 0;
  }
  applySky();
  const maxAnisotropy = renderer.capabilities.getMaxAnisotropy?.() ?? 1;

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

  // Facades as in the world: windows drawn on the walls, glowing at dusk and night when the building is lit.
  // Textures are shared; materials are made per lot, so fading one lot never fades another.
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
  function facadeMaterial(style, wall, lit, span, h) {
    const tiles = facadeTiles(style, wall, lit);
    const [unitW, unitH] = FACADE_UNITS[style] ?? [1, 1];
    const repeat = unitW === 0 ? [1, Math.max(1, Math.round(h / 1.1))] : [Math.max(1, Math.round(span / unitW)), Math.max(1, Math.round(h / unitH))];
    const map = tiles.map.clone();
    map.needsUpdate = true;
    map.repeat.set(...repeat);
    const mat = material(0xffffff, { map, roughness: 0.85 });
    if (tiles.glow) {
      const glow = tiles.glow.clone();
      glow.needsUpdate = true;
      glow.repeat.copy(map.repeat);
      mat.emissive = new THREE.Color(0xffc867);
      mat.emissiveMap = glow;
      mat.emissiveIntensity = sky.glow;
      litMaterials.add(mat);
    }
    return mat;
  }
  /** A block with facades on its four walls and a plain roof, standing on y = 0. */
  function block(w, h, d, { style = 'office', wall = 0xe9e4da, lit = false, roof = 0xc9c5bb } = {}) {
    const alongX = facadeMaterial(style, wall, lit, d, h);
    const alongZ = facadeMaterial(style, wall, lit, w, h);
    const top = material(roof, { roughness: 0.95 });
    return mesh(new THREE.BoxGeometry(w, h, d), [alongX, alongX, top, top, alongZ, alongZ], { y: h / 2 });
  }

  // Trees and street lamps are many; like the world, they are instanced (scenery, no data).
  function plantTrees(parent, placements) {
    if (!placements.length) return;
    const conifers = [];
    const broadleaves = [];
    for (const placement of placements) (hashUnit(`${placement[0]},${placement[1]}k`) < 0.42 ? conifers : broadleaves).push(placement);
    const foliage = () => material(0xffffff, { roughness: 0.9, flatShading: true });
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.1, 0.15, 0.8, 6), material(0x7d6249, { roughness: 1 }), placements.length);
    const lower = new THREE.InstancedMesh(new THREE.ConeGeometry(0.78, 1.3, 7), foliage(), Math.max(conifers.length, 1));
    const upper = new THREE.InstancedMesh(new THREE.ConeGeometry(0.55, 1.05, 7), foliage(), Math.max(conifers.length, 1));
    const crowns = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.72, 0), foliage(), Math.max(broadleaves.length, 1));
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    const tint = new THREE.Color();
    const up = new THREE.Vector3(0, 1, 0);
    const place = (instanced, index, x, y, z, sx, sy, sz, spin) => {
      rotation.setFromAxisAngle(up, spin);
      matrix.compose(new THREE.Vector3(x, y, z), rotation, new THREE.Vector3(sx, sy, sz));
      instanced.setMatrixAt(index, matrix);
    };
    placements.forEach(([x, z, scale], index) => place(trunks, index, x, 0.4 * scale, z, scale, scale, scale, 0));
    conifers.forEach(([x, z, scale], index) => {
      const spin = hashUnit(`${x}${z}s`) * Math.PI;
      const tall = 0.9 + hashUnit(`${z}${x}t`) * 0.35;
      place(lower, index, x, 1.15 * scale * tall, z, scale, scale * tall, scale, spin);
      place(upper, index, x, 1.85 * scale * tall, z, scale, scale * tall, scale, spin);
      const shade = tint.setHSL(0.37 + (hashUnit(`${x},${z}`) - 0.5) * 0.04, 0.34, 0.3 + hashUnit(`${z},${x}`) * 0.08);
      lower.setColorAt(index, shade);
      upper.setColorAt(index, shade.offsetHSL(0, 0, 0.04));
    });
    broadleaves.forEach(([x, z, scale], index) => {
      const squash = 0.85 + hashUnit(`${x}${z}q`) * 0.25;
      place(crowns, index, x, 1.25 * scale, z, scale * squash, scale, scale * (1.9 - squash), hashUnit(`${x}${z}s`) * Math.PI);
      crowns.setColorAt(index, tint.setHSL(0.24 + hashUnit(`${x},${z}h`) * 0.08, 0.38, 0.4 + hashUnit(`${z},${x}l`) * 0.12));
    });
    lower.count = conifers.length;
    upper.count = conifers.length;
    crowns.count = broadleaves.length;
    for (const instanced of [trunks, lower, upper, crowns]) {
      instanced.castShadow = true;
      instanced.receiveShadow = true;
      parent.add(instanced);
    }
  }
  function placeLamps(parent, placements) {
    if (!placements.length) return;
    const metal = material(0x3f4844, { roughness: 0.6, metalness: 0.4 });
    const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.05, 0.07, 1.9, 6), metal, placements.length);
    const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.26, 0.08, 0.26), metal, placements.length);
    const bulbMaterial = material(0xfff3d6, { emissive: new THREE.Color(0xffd27a), emissiveIntensity: sky.lamps ? 1.8 : 0 });
    lampMaterials.add(bulbMaterial);
    const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.11, 10, 8), bulbMaterial, placements.length);
    const matrix = new THREE.Matrix4();
    placements.forEach(([x, z], index) => {
      poles.setMatrixAt(index, matrix.makeTranslation(x, 0.95, z));
      heads.setMatrixAt(index, matrix.makeTranslation(x, 1.92, z));
      bulbs.setMatrixAt(index, matrix.makeTranslation(x, 1.82, z));
    });
    for (const instanced of [poles, heads, bulbs]) {
      instanced.castShadow = instanced !== bulbs;
      parent.add(instanced);
    }
  }
  const dashTexture = canvasTexture(doc, 8, 64, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(1, 0, w - 2, h * 0.55);
  });
  dashTexture.wrapT = THREE.RepeatWrapping;
  /** A street along z (or along x when `across`): sidewalks, asphalt, and a dashed centre line if wide. */
  function streetStrip(parent, { x = 0, z = 0, width, length, across = false, centreLine = false, dirt = false }) {
    const strip = (stripWidth, mat, y) => {
      const surface = mesh(new THREE.PlaneGeometry(stripWidth, length), mat, { x, y, z, shadow: false });
      surface.rotation.set(-Math.PI / 2, 0, across ? Math.PI / 2 : 0);
      parent.add(surface);
    };
    // A dirt track on vacant land; sidewalks and asphalt once the district has grown.
    if (dirt) {
      strip(width, material(0xb59d7a, { roughness: 1 }), 0.03);
      return;
    }
    strip(width + 0.7, material(0xe4dfd2, { roughness: 1 }), 0.025);
    strip(width, material(0x8e938f, { roughness: 0.95 }), 0.04);
    if (centreLine) {
      const dashes = dashTexture.clone();
      dashes.needsUpdate = true;
      dashes.repeat.set(1, Math.max(1, Math.round(length / 1.6)));
      strip(0.1, new THREE.MeshBasicMaterial({ map: dashes, transparent: true, opacity: 0.85, color: 0xf6f3e6 }), 0.055);
    }
  }
  // A tarp, folded: vertical bands of light and shade on the blue sheet (the colour is the meaning).
  const tarpTexture = canvasTexture(doc, 64, 64, (ctx, w, h) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 8; i += 1) {
      ctx.fillStyle = i % 2 ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.0)';
      ctx.fillRect((i * w) / 8, 0, w / 8, h);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(0, h * 0.48, w, 2);
  });
  tarpTexture.wrapS = THREE.RepeatWrapping;
  tarpTexture.wrapT = THREE.RepeatWrapping;

  let root = null;
  let fountainJet = null;
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
  // What changed since the viewer was last here (AC-22, AC-23): a gold ring, a rising building, words.
  let celebrations = [];
  const RISING = new Set(['new', 'built', 'evidenced', 'started']);
  // Changes that set the district back are marked too, in grey, without the gold or the plus.
  const SETBACK = new Set(['worker_out', 'weeds_grew', 'held']);
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
    // The lot: a rounded plate, gravel on a site and lawn round a finished house (faded when overdue).
    const groundColor = site.work.status === 'completed' ? 0xb7cf9f : 0xd9d2bf;
    group.add(mesh(roundedPlate(DISTRICT_STREETS.lot, DISTRICT_STREETS.lot, 0.08, 0.32), material(fade(groundColor), { roughness: 1 })));
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
      // The building rising: walls with their windows (unlit, no one has moved in), concrete on top.
      const core = block(1.7, height, 1.5, { style: hash(`${site.task_id}s`) < 0.5 ? 'office' : 'brick', wall: fade(STATE_WALL[status]).getHex(), roof: 0xa9a59b });
      core.position.z = -0.25;
      group.add(core);
      // Scaffolding: poles at the corners and along the faces, a plank at each floor.
      const steel = material(0x9a9c97, { roughness: 0.5, metalness: 0.5 });
      const plank = material(0xb88f5a, { roughness: 0.9 });
      const scaffoldH = height + 0.55;
      for (const x of [-1.0, -0.33, 0.33, 1.0]) {
        for (const z of [-1.15, 0.65]) group.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, scaffoldH, 5), steel, { x, y: scaffoldH / 2, z }));
      }
      // Planks only where work goes on; a held site is wrapped in its tarp.
      for (let f = 1; status === 'in_progress' && f <= floors; f += 1) {
        for (const z of [-1.15, 0.65]) group.add(mesh(new THREE.BoxGeometry(2.05, 0.04, 0.24), plank, { y: f * 0.75, z }));
        for (const x of [-1.0, 1.0]) group.add(mesh(new THREE.BoxGeometry(0.24, 0.04, 1.8), plank, { x, y: f * 0.75, z: -0.25 }));
      }
      if (status === 'in_progress') {
        const net = mesh(new THREE.PlaneGeometry(2.0, scaffoldH - 0.05), material(0x4f9a5c, { transparent: true, opacity: 0.55, side: THREE.DoubleSide }), { y: scaffoldH / 2, z: 0.7, shadow: false });
        group.add(net);
        // A tower crane over a site being worked: a mast, a jib and its counterweight.
        const yellow = material(0xe0a526, { roughness: 0.6 });
        group.add(mesh(new THREE.BoxGeometry(0.14, 3.8, 0.14), yellow, { x: 0.95, y: 1.9, z: -1.05 }));
        group.add(mesh(new THREE.BoxGeometry(2.6, 0.1, 0.12), yellow, { x: 0.35, y: 3.7, z: -1.05 }));
        group.add(mesh(new THREE.BoxGeometry(0.34, 0.3, 0.3), material(0x6b6b66), { x: 1.55, y: 3.55, z: -1.05 }));
        group.add(mesh(new THREE.CylinderGeometry(0.008, 0.008, 1.4, 4), material(0x333333), { x: -0.7, y: 3.0, z: -1.05, shadow: false }));
      } else {
        // Waiting: a blue tarp over the building and its scaffold, tied down, as on a site where work is held.
        const tarp = tarpTexture.clone();
        tarp.needsUpdate = true;
        tarp.repeat.set(2, 1);
        group.add(box(2.15, scaffoldH, 1.95, fade(0x4f93db), { z: -0.25 }, { map: tarp, transparent: true, opacity: 0.95, roughness: 0.5, emissive: fade(0x1d4f8a), emissiveIntensity: 0.35 }));
        const rope = material(0xf2efe6);
        for (const x of [-1.08, 1.08]) group.add(mesh(new THREE.BoxGeometry(0.02, 0.02, 2.0), rope, { x, y: scaffoldH * 0.55, z: -0.25, shadow: false }));
      }
    }
    if (status === 'completed' && !(site.source_refs?.length > 0)) {
      // A prefab: completed, with no record of its source or outcome yet (AC-24).
      const shell = box(1.7, 0.75, 1.3, 0xd7d9d6, { z: -0.3 }, { roughness: 0.6, metalness: 0.15 });
      group.add(shell);
      group.add(mesh(new THREE.BoxGeometry(1.8, 0.06, 1.4), material(0x9fa3a0, { roughness: 0.5, metalness: 0.3 }), { y: 0.78, z: -0.3 }));
      group.add(mesh(new THREE.BoxGeometry(0.5, 0.28, 0.03), material(0x8fb3c8, { roughness: 0.2 }), { x: -0.35, y: 0.45, z: 0.36, shadow: false }));
      group.add(mesh(new THREE.BoxGeometry(0.3, 0.55, 0.03), material(0x7d8a8f), { x: 0.45, y: 0.28, z: 0.36, shadow: false }));
    }
    if (status === 'completed' && site.source_refs?.length > 0) {
      // A finished house: plastered walls with lit windows, a gable roof, a door to the street.
      const house = block(1.7, 1.05, 1.4, { style: 'house', wall: 0xf2ebdd, lit: true, roof: 0xd8d0c2 });
      house.position.z = -0.3;
      group.add(house);
      const roof = mesh(gableRoof(1.7, 1.4, 0.7), material(0xb5654a, { roughness: 0.75 }), { y: 1.05, z: -0.3 });
      roof.rotation.y = Math.PI / 2;
      group.add(roof);
      group.add(mesh(new THREE.BoxGeometry(0.34, 0.6, 0.04), material(0x8a5a3c), { y: 0.3, z: 0.41 }));
      group.add(mesh(new THREE.BoxGeometry(0.2, 0.5, 0.2), material(0x9c7a62), { x: 0.45, y: 1.6, z: -0.6 }));
      group.userData.chimney = new THREE.Vector3(0.45, 1.9, -0.6);
    }
    // A path to the street only when the record links its source.
    if (!GAP(site, 'source_unlinked') && !GAP(site, 'outcome_unlinked')) {
      const stones = material(0xcfc8b8, { roughness: 1 });
      for (let i = 0; i < 3; i += 1) group.add(mesh(roundedPlate(0.6, 0.26, 0.03, 0.08), stones, { x: (i % 2 ? 0.06 : -0.06), y: 0.04, z: half + 0.18 + i * 0.32, shadow: false }));
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
    fountainJet = null;
    litMaterials.clear();
    lampMaterials.clear();
    for (const label of labels) label.node.remove();
    labels = [];
    lots = new Map();
    walkers = [];
    puffs = [];
    selected = null;
    hovered = null;
    focusIds = null;
    celebrations = [];
    selectionRing.visible = false;
  }

  /** Marks what changed: each changed lot glows; built ones rise from the ground (not with reduced motion). */
  function celebrate(changes) {
    for (const item of celebrations) {
      root?.remove(item.ring);
      root?.remove(item.beam);
      item.label.node.remove();
      labels = labels.filter((label) => label !== item.label);
    }
    celebrations = [];
    if (!changes || changes.first || !root) return;
    const byTask = new Map();
    for (const item of changes.items) {
      if (item.kind === 'left' || !lots.has(item.task_id)) continue;
      if (!byTask.has(item.task_id)) byTask.set(item.task_id, []);
      byTask.get(item.task_id).push(item);
    }
    let shownWords = 0;
    for (const [taskId, items] of byTask) {
      const group = lots.get(taskId);
      const setback = items.every((item) => SETBACK.has(item.kind));
      const color = setback ? 0x8a8f94 : 0xe0a526;
      const ring = mesh(new THREE.RingGeometry(1.95, 2.35, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide }), { x: group.position.x, y: 0.1, z: group.position.z, shadow: false });
      ring.rotation.x = -Math.PI / 2;
      root.add(ring);
      // A column of light, so the change can be found from the gate.
      const beam = mesh(new THREE.CylinderGeometry(0.5, 1.6, 9, 24, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }), { x: group.position.x, y: 4.6, z: group.position.z, shadow: false });
      root.add(beam);
      const words = items.map((item) => `${SETBACK.has(item.kind) ? '！' : '＋'}${item.text.split('（')[0]}`).join('・');
      const label = addLabel(words, new THREE.Vector3(group.position.x, 3.3, group.position.z), `is-change${setback ? ' is-setback' : ''}`, { priority: shownWords++ < 6 ? 0 : 3 });
      const rises = !reducedMotion && items.some((item) => RISING.has(item.kind));
      if (rises) group.scale.set(1, 0.02, 1);
      celebrations.push({ ring, beam, label, group, rises, started: null });
    }
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
    // The stage of the district (AC-24): counted from permanent buildings, it sets how built-up it looks.
    const stage = districtStage(shown);
    const grown = stage.level;
    const gateZ = L / 2 + 4;
    const hallZ = -L / 2 - 7;
    // Land as in the world: gentle, non-repeating shades of grass (scenery).
    const grass = { low: new THREE.Color(0x9fbf8c), high: new THREE.Color(0xd3e4bd), warm: new THREE.Color(0xd9d6a6) };
    const land = mesh(paintVertices(new THREE.CircleGeometry(150, 96, 0, Math.PI * 2), (color, x, y) => {
      color.copy(grass.low).lerp(grass.high, valueNoise(x / 16, y / 16, 'dland') * 0.7 + valueNoise(x / 4.5, y / 4.5, 'dtuft') * 0.3);
      if (valueNoise(x / 22, y / 22, 'ddry') > 0.68) color.lerp(grass.warm, 0.35);
    }), material(0xffffff, { vertexColors: true, roughness: 1 }), { shadow: false });
    land.rotation.x = -Math.PI / 2;
    land.receiveShadow = true;
    root.add(land);
    // The district's paving: a raised plate with a kerb, from the gate to the hall.
    const pavingDepth = gateZ - hallZ + 14;
    root.add(mesh(roundedPlate(28, pavingDepth, 0.04, 2.2), material(0xd4cec0, { roughness: 1 }), { z: (gateZ + hallZ) / 2, shadow: false }));
    const pavingColor = [0xd8cdb2, 0xe2dac6, 0xebe6d8, 0xefeadc, 0xf2eee2][grown];
    root.add(mesh(roundedPlate(27, pavingDepth - 1, 0.06, 1.8), material(pavingColor, { roughness: 1 }), { z: (gateZ + hallZ) / 2, shadow: false }));
    const lift = new THREE.Group();
    lift.position.y = 0.17;
    root.add(lift);
    streetStrip(lift, { x: 0, z: (gateZ + 8 + hallZ + 3) / 2, width: DISTRICT_STREETS.main * 2, length: gateZ + 8 - (hallZ + 3), centreLine: grown >= 2, dirt: grown === 0 });
    streetStrip(lift, { x: -DISTRICT_STREETS.backStreet, z: 0, width: 1.6, length: L + 2, dirt: grown < 2 });
    streetStrip(lift, { x: DISTRICT_STREETS.backStreet, z: 0, width: 1.6, length: L + 2, dirt: grown < 2 });
    // A cross street between the blocks, and at the hall end of each block a sign saying what its work is for.
    const crossWidth = DISTRICT_STREETS.backLot * 2 + 4;
    layout.streets.forEach((block, index) => {
      if (index < layout.streets.length - 1) {
        streetStrip(lift, { x: 0, z: block.z_to + DISTRICT_STREETS.cross / 2, width: DISTRICT_STREETS.cross * 0.62, length: crossWidth, across: true, dirt: grown < 2 });
      }
      const signZ = block.z_from - (index === 0 ? 0.9 : DISTRICT_STREETS.cross / 2);
      root.add(mesh(new THREE.CylinderGeometry(0.06, 0.08, 2.5, 8), material(0x3f4844, { roughness: 0.6, metalness: 0.4 }), { x: -DISTRICT_STREETS.main - 0.5, y: 1.25, z: signZ }));
      root.add(mesh(new THREE.BoxGeometry(1.1, 0.34, 0.05), material(block.label ? 0x2f6e4f : 0xbfb8a8, { roughness: 0.6 }), { x: -DISTRICT_STREETS.main - 0.5, y: 2.2, z: signZ }));
      const text = block.label ? `${block.label}（${block.count}件）` : `未分類の空き地：何のための仕事か未記録（${block.count}件）`;
      addLabel(text, new THREE.Vector3(-DISTRICT_STREETS.main - 0.5, 2.9, signZ), `is-street${block.label ? '' : ' is-unlabelled'}`, { priority: 2 });
    });
    // Trees along the main street and lamps between them; a belt of trees round the district (scenery).
    const trees = [];
    const lamps = [];
    for (let z = -L / 2; z <= L / 2; z += DISTRICT_STREETS.row) {
      const at = z + DISTRICT_STREETS.row / 2;
      if (at > L / 2) continue;
      for (const x of [-2.45, 2.45]) trees.push([x, at, 0.62]);
      for (const x of [-2.45, 2.45]) lamps.push([x, at + DISTRICT_STREETS.row / 2]);
    }
    for (let i = 0; i < 90; i += 1) {
      const angle = (i / 90) * Math.PI * 2 + hashUnit(`belt${i}a`) * 0.05;
      const rx = 17 + hashUnit(`belt${i}r`) * 9;
      const rz = pavingDepth / 2 + 3 + hashUnit(`belt${i}z`) * 8;
      trees.push([Math.cos(angle) * rx, (gateZ + hallZ) / 2 + Math.sin(angle) * rz, 0.8 + hashUnit(`belt${i}s`) * 0.6]);
    }
    plantTrees(root, trees.filter(([x, z]) => !(Math.abs(x) < 4.2 && z > gateZ - 1)));
    // Lamps come with the district's growth: none on vacant land, every other one in a village.
    placeLamps(lift, grown === 0 ? [] : grown === 1 ? lamps.filter((_, i) => i % 4 === 0) : lamps);
    // The gate: stone pillars on plinths, a lintel with a cornice, lamps on its pillars.
    const stone = material(0xe2dccf, { roughness: 0.9 });
    for (const x of [-3.3, 3.3]) {
      root.add(mesh(roundedPlate(1.2, 1.2, 0.3, 0.12), stone, { x, z: gateZ }));
      root.add(mesh(new THREE.BoxGeometry(0.72, 4.0, 0.72), stone, { x, y: 2.3, z: gateZ }));
      root.add(mesh(new THREE.BoxGeometry(0.9, 0.18, 0.9), stone, { x, y: 4.35, z: gateZ }));
    }
    root.add(mesh(new THREE.BoxGeometry(7.8, 0.55, 0.95), stone, { y: 4.65, z: gateZ }));
    root.add(mesh(new THREE.BoxGeometry(8.2, 0.16, 1.1), material(0xcfc8ba, { roughness: 0.9 }), { y: 5.0, z: gateZ }));
    placeLamps(root, [[-3.3, gateZ + 0.6], [3.3, gateZ + 0.6]]);
    addLabel(`${business.name}の区画（入口）・${stage.label}`, new THREE.Vector3(0, 5.2, gateZ), 'is-city', { priority: 1 });
    // The hall: what this business is for, and the stones of its policies in front of it.
    // A civic building as in the world: steps, a colonnade, tall lit windows, a pediment.
    for (let step = 0; step < 3; step += 1) root.add(mesh(roundedPlate(9.6 - step * 0.5, 6.2 - step * 0.4, 0.1, 0.25), stone, { y: step * 0.18, z: hallZ + 0.2 }));
    const hall = block(8, 3.4, 4.2, { style: 'civic', wall: 0xeee8dc, lit: true, roof: 0xd9d2c4 });
    hall.position.set(0, 0.54, hallZ);
    root.add(hall);
    root.add(mesh(new THREE.BoxGeometry(8.6, 0.3, 4.9), stone, { y: 4.08, z: hallZ }));
    for (let i = 0; i < 6; i += 1) {
      const x = -3.1 + i * 1.24;
      root.add(mesh(new THREE.CylinderGeometry(0.16, 0.19, 3.0, 14), material(0xf7f4ee, { roughness: 0.7 }), { x, y: 2.04, z: hallZ + 2.45 }));
      root.add(mesh(new THREE.BoxGeometry(0.46, 0.12, 0.46), stone, { x, y: 3.6, z: hallZ + 2.45 }));
    }
    const pediment = mesh(gableRoof(8.6, 4.9, 1.15), material(0xf7f4ee, { roughness: 0.8 }), { y: 4.23, z: hallZ });
    root.add(pediment);
    root.add(box(0.4, 0.9, 0.4, 0x9c7a62, { x: 2.8, y: 4.3, z: hallZ - 1.2 }));
    const hallChimney = new THREE.Vector3(2.8, 5.2, hallZ - 1.2);
    const purposeText = work?.status === 'ok' ? (work.purpose.text ?? '目的は未登録') : '目的を読めません';
    addLabel(`庁舎：${business.name}（${purposeText}）`, new THREE.Vector3(0, 5.6, hallZ), 'is-plaza', { priority: 1 });
    const plaza = mesh(new THREE.CircleGeometry(3.6, 48), material(0xf1ece1, { roughness: 1 }), { y: 0.2, z: hallZ + 5.4, shadow: false });
    plaza.rotation.x = -Math.PI / 2;
    root.add(plaza);
    const ring = mesh(new THREE.RingGeometry(3.6, 3.85, 48), material(0xcfc8b8, { roughness: 1 }), { y: 0.21, z: hallZ + 5.4, shadow: false });
    ring.rotation.x = -Math.PI / 2;
    root.add(ring);
    if (grown >= 3) {
      // A fountain in the plaza once the district is a 街.
      const basin = material(0xd9d3c6, { roughness: 0.8 });
      root.add(mesh(new THREE.CylinderGeometry(1.0, 1.1, 0.35, 32), basin, { y: 0.37, z: hallZ + 5.4 }));
      const water = mesh(new THREE.CylinderGeometry(0.88, 0.88, 0.04, 32), material(0x7fc4d6, { roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.85 }), { y: 0.52, z: hallZ + 5.4, shadow: false });
      root.add(water);
      root.add(mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.7, 12), basin, { y: 0.7, z: hallZ + 5.4 }));
      const jet = mesh(new THREE.ConeGeometry(0.22, 0.6, 12, 1, true), material(0xcfeef5, { transparent: true, opacity: 0.6, emissive: new THREE.Color(0x6fb6c9), emissiveIntensity: 0.2 }), { y: 1.25, z: hallZ + 5.4, shadow: false });
      jet.rotation.x = Math.PI;
      root.add(jet);
      fountainJet = jet;
    }
    if (grown >= 4) {
      // A clock tower beside the hall once the district is a 都市.
      const tower = block(1.4, 6.0, 1.4, { style: 'civic', wall: 0xe8e0cf, lit: true, roof: 0xb5654a });
      tower.position.set(5.6, 0.2, hallZ - 0.4);
      root.add(tower);
      const cap = mesh(new THREE.ConeGeometry(1.1, 1.4, 4), material(0xb5654a, { roughness: 0.7 }), { x: 5.6, y: 6.9, z: hallZ - 0.4 });
      cap.rotation.y = Math.PI / 4;
      root.add(cap);
      root.add(mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.06, 24), material(0xfaf6ea, { emissive: new THREE.Color(0xffe2a0), emissiveIntensity: 0.3 }), { x: 5.6, y: 5.6, z: hallZ + 0.33, shadow: false }).rotateX(Math.PI / 2));
    }
    const policies = work?.status === 'ok' ? work.purpose.policies.slice(0, 8) : [];
    policies.forEach((policy, index) => {
      const angle = Math.PI * (0.15 + (0.7 * index) / Math.max(policies.length - 1, 1));
      const x = Math.cos(angle) * 2.8;
      const z = hallZ + 5.4 + Math.sin(angle) * 1.6;
      if (policy.link === 'recorded') {
        root.add(box(0.5, 1.2, 0.22, 0xa8a49a, { x, y: 0.8, z }, { roughness: 0.9 }));
      } else {
        const outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(0.5, 1.2, 0.22)), new THREE.LineDashedMaterial({ color: 0x5b4a8a, dashSize: 0.12, gapSize: 0.08 }));
        outline.computeLineDistances();
        outline.position.set(x, 0.8, z);
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
      group.position.set(lot.x, 0.17, lot.z);
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
    scene.fog.color.set(sky.fog);
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
    selectionRing.position.set(group.position.x, 0.3, group.position.z);
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
        walker.position.y = 0.2 + Math.abs(Math.sin(seconds * 8 * speed)) * 0.04;
      }
      for (const puff of puffs) {
        const cycle = (seconds * 0.25 + puff.userData.phase) % 1;
        puff.position.set(puff.userData.base.x + cycle * 0.5, puff.userData.base.y + cycle * 2.2, puff.userData.base.z);
        puff.scale.setScalar(0.6 + cycle * 1.4);
        puff.material.opacity = 0.5 * (1 - cycle);
      }
    }
    for (const item of celebrations) {
      item.started ??= time;
      const elapsed = (time - item.started) / 1000;
      if (item.rises) {
        const t = Math.min(elapsed / 1.4, 1);
        item.group.scale.y = 0.02 + 0.98 * (1 - (1 - t) ** 3);
        if (t >= 1) item.rises = false;
      }
      // Pulses for a while, then stays as a faint ring so the change can still be found.
      item.ring.material.opacity = reducedMotion ? 0.8 : elapsed < 8 ? 0.55 + 0.4 * Math.sin(elapsed * 5) : 0.45;
      item.beam.material.opacity = reducedMotion ? 0.2 : elapsed < 8 ? 0.16 + 0.12 * Math.sin(elapsed * 5) : 0.12;
    }
    if (fountainJet && !reducedMotion) fountainJet.scale.y = 1 + 0.12 * Math.sin(time / 260);
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
    /** The sky: the same modes as the world ('auto' follows the hour). */
    setSky(mode) {
      skyMode = mode;
      applySky();
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
    /** Shows what changed since the viewer's last visit (from `districtChanges`). */
    celebrate,
    /** Rebuilds the open district from fresh records, keeping the camera where it is. */
    refresh(business, work, { neighbours = new Map() } = {}) {
      const keep = { target: controls.target.clone(), position: camera.position.clone() };
      build(business, work, neighbours);
      controls.target.copy(keep.target);
      camera.position.copy(keep.position);
      camera.lookAt(keep.target);
    },
    dispose() {
      running = false;
      observer?.disconnect();
      controls.dispose();
      renderer.dispose();
    },
  };
}
