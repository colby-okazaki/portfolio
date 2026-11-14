// The 3D board world behind the page. A path of coloured spaces winds across a game board, and a
// voxel car drives along it as you scroll. Everything is positioned from the car's place on the
// path, so the scene is the same whichever way you scroll and wherever the page loads.
// The models come from models/world.glb, which blender/build_models.py generates.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const canvas = document.getElementById('world');
const hudSpace = document.getElementById('hud-space');
const hudCoins = document.getElementById('hud-coins');
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

const clamp01 = v => Math.min(Math.max(v, 0), 1);
const easeOutBack = t => 1 + 2.7 * Math.pow(t - 1, 3) + 1.7 * Math.pow(t - 1, 2);
function rng(seed) {                       // small seeded generator, so the world is the same every visit
  return () => {
    seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const SKY = 0xcfeeff;
const TILE_COLORS = [0xffd23f, 0xff9f1c, 0x3fbf6a, 0xffd23f, 0x2f6fe0, 0xff9f1c, 0xff6fa5, 0x3fbf6a];
const CONFETTI = [0xffd23f, 0xff9f1c, 0x3fbf6a, 0x2f6fe0, 0xff6fa5, 0xe5484d, 0xffffff];
const HOUSES = ['house_a', 'manor', 'log_cabin', 'house_b', 'barn', 'beach_house'];
const SMOKE = { house_a: [0.5, 2.3, -0.25], log_cabin: [1.125, 2.05, 0] };   // chimney tops
const LANDMARKS = ['college', 'bank', 'chapel', 'windmill', 'hospital', 'office_tower'];
const STOPS = [
  { id: 'start', label: 'START', color: '#2fa85a' },
  { id: 'projects', label: 'PROJECTS', color: '#e5484d' },
  { id: 'skills', label: 'SKILLS', color: '#2f6fe0' },
  { id: 'contact', label: 'CONTACT', color: '#7b4fd6' },
];

function main(gltf) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(SKY, 40, 90);
  const camera = new THREE.PerspectiveCamera(30, 1, 1, 400);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x8fcf7a, 1.7));
  const sun = new THREE.DirectionalLight(0xfff1d0, 2.4);
  const SUN_DIR = new THREE.Vector3(-0.45, 1, 0.35).normalize();
  const SHADOW_HALF = 34, SHADOW_MAP = 2048;
  sun.castShadow = true;
  sun.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
  Object.assign(sun.shadow.camera, { left: -SHADOW_HALF, right: SHADOW_HALF, top: SHADOW_HALF, bottom: -SHADOW_HALF, near: 1, far: 160 });
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  // ------------------------------------------------------------ the path
  // A closed, wobbly ring: one full scroll of the page is one lap, ending back where it began
  const ctrl = [];
  for (let i = 0; i < 72; i++) {
    const a = i / 72 * Math.PI * 2, r = 36 * (1 + 0.2 * Math.sin(3 * a) + 0.08 * Math.sin(5 * a + 1));
    ctrl.push(new THREE.Vector3(r * Math.cos(a), 0, -r * Math.sin(a)));
  }
  const curve = new THREE.CatmullRomCurve3(ctrl, true);
  curve.arcLengthDivisions = 2000;
  const L = curve.getLength();
  const SAMPLES = Math.ceil(L * 4);
  const sp = curve.getSpacedPoints(SAMPLES);
  const wrap = s => ((s % L) + L) % L;
  const ahead = (s, from) => wrap(s - from + L / 2) - L / 2;   // how far s is in front of `from`, the short way round
  function posAt(s, out) {
    const f = wrap(s) / L * SAMPLES, i = Math.min(Math.floor(f), SAMPLES - 1);
    return out.lerpVectors(sp[i], sp[i + 1], f - i);
  }
  function headingAt(s) {                   // rotation.y that points a model's +X along the path
    const i = Math.round(wrap(s) / L * SAMPLES) % SAMPLES;
    const a = sp[(i + SAMPLES - 2) % SAMPLES], b = sp[(i + 2) % SAMPLES];
    return Math.atan2(-(b.z - a.z), b.x - a.x);
  }
  const around = p => Math.atan2(-p.z, p.x);   // angle round the ring; the camera circles with it
  const CAR_START = 12;

  // ------------------------------------------------------------ the board
  const tex = document.createElement('canvas');
  tex.width = tex.height = 2;
  const tg = tex.getContext('2d');
  tg.fillStyle = '#7fd16b'; tg.fillRect(0, 0, 2, 2);
  tg.fillStyle = '#74c760'; tg.fillRect(0, 0, 1, 1); tg.fillRect(1, 1, 1, 1);
  const grass = new THREE.CanvasTexture(tex);
  grass.magFilter = THREE.NearestFilter;
  grass.wrapS = grass.wrapT = THREE.RepeatWrapping;
  grass.repeat.set(160, 160);
  grass.colorSpace = THREE.SRGBColorSpace;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(640, 640), new THREE.MeshLambertMaterial({ map: grass }));
  ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
  scene.add(ground);

  // Spaces: a white rim with a coloured top, one instanced mesh each
  const tileCount = Math.round(L / 2.05), PITCH = L / tileCount;
  const tileS = Array.from({ length: tileCount }, (_, k) => k * PITCH);
  const rims = new THREE.InstancedMesh(new THREE.BoxGeometry(2.0, 0.2, 3.0), new THREE.MeshLambertMaterial({ color: 0xfffdf4 }), tileCount);
  const tops = new THREE.InstancedMesh(new THREE.BoxGeometry(1.7, 0.2, 2.7), new THREE.MeshLambertMaterial(), tileCount);
  rims.receiveShadow = tops.receiveShadow = true;
  rims.castShadow = true;
  rims.frustumCulled = tops.frustumCulled = false;
  const col = new THREE.Color();
  const tileBase = tileS.map((s, k) => {
    tops.setColorAt(k, col.setHex(TILE_COLORS[k % TILE_COLORS.length]));
    return { p: posAt(s, new THREE.Vector3()), h: headingAt(s) };
  });
  scene.add(rims, tops);

  // ------------------------------------------------------------ models
  const voxel = new THREE.MeshLambertMaterial({ vertexColors: true });
  const tpl = {};
  gltf.scene.children.slice().forEach(o => {
    o.position.set(0, 0, 0);
    o.traverse(m => { if (m.isMesh) { m.material = voxel; m.castShadow = m.receiveShadow = true; } });
    tpl[o.name] = o;
  });

  // The car: `car` follows the path, `body` leans and bobs on top of it, the wheels stay on the road
  const car = tpl.car;
  const body = car.getObjectByName('car_body');
  const wheels = ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'].map(n => car.getObjectByName(n));
  scene.add(car);

  const puffs = Array.from({ length: 14 }, () => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.22), new THREE.MeshLambertMaterial({ color: 0xffffff }));
    m.visible = false;
    m.userData = { life: 0, v: new THREE.Vector3() };
    scene.add(m);
    return m;
  });

  // Scenery: scattered either side of the path, never on it and never on top of each other
  const rand = rng(7);
  const props = [];
  const tmp = new THREE.Vector3(), nrm = new THREE.Vector3();
  const farFromPath = (p, min) => { for (let i = 0; i <= SAMPLES; i += 3) if (sp[i].distanceToSquared(p) < min * min) return false; return true; };
  function place(name, s, side, dist, radius, opts = {}) {
    posAt(s, tmp);
    const h = headingAt(s);
    nrm.set(Math.sin(h), 0, Math.cos(h));              // across the path
    const p = tmp.clone().addScaledVector(nrm, side * dist);
    if (!farFromPath(p, radius + 2.2)) return null;
    if (props.some(q => q.p.distanceTo(p) < q.radius + radius)) return null;
    const obj = tpl[name].clone();
    const scale = opts.scale ?? 0.85 + rand() * 0.4;
    obj.position.copy(p);
    obj.rotation.y = opts.face !== undefined ? around(p) + opts.face : Math.floor(rand() * 4) * Math.PI / 2;
    scene.add(obj);
    const prop = { name, obj, s, p, radius, scale, phase: rand() * 6.28, y: opts.y ?? 0 };
    props.push(prop);
    return prop;
  }
  const facing = () => 0.25 + rand() * 0.5;            // buildings turn their fronts towards the camera
  let landN = 0;                                       // landmarks first, so they get the space
  for (let s = 18; s < L - 6; s += 19) {               // town buildings stand inside the ring, facing the camera
    const name = LANDMARKS[landN++ % LANDMARKS.length];
    place(name, s, -1, 6.5 + rand() * 2.5, 2.8, { face: facing(), scale: name === 'windmill' ? 1.25 : 1.1 });
  }
  for (let s = 4; s < L; s += 34) {
    place('mountain', s + 20, -1, 15 + rand() * 6, 5.5, { scale: 1 + rand() * 0.5 });
    place('mountain', s + 2, 1, 19 + rand() * 6, 5.5, { scale: 0.9 + rand() * 0.4 });
  }
  let houseN = 0;
  for (let s = 9; s < L; s += 13) {
    place(HOUSES[houseN++ % HOUSES.length], s, rand() < 0.5 ? 1 : -1, 4.8 + rand() * 4, 2.1, { face: facing(), scale: 1 });
    if (rand() < 0.55) place(rand() < 0.5 ? 'die_white' : 'die_red', s + 6, rand() < 0.5 ? 1 : -1, 3.6 + rand() * 3, 1.2, { y: 1.3, scale: 1 });
  }
  for (let s = 0; s < L; s += 1.4) {
    for (const side of [1, -1]) {
      if (rand() < 0.55) continue;
      const r = rand(), far = rand() < 0.3;
      const name = r < 0.4 ? 'tree_round' : r < 0.75 ? 'tree_pine' : r < 0.92 ? 'bush' : 'rock';
      place(name, s, side, far ? 11 + rand() * 14 : 3.3 + rand() * 7, name.startsWith('tree') ? 1.0 : 0.6);
    }
  }
  // Chimney smoke for the cottages
  const smokeGeo = new THREE.BoxGeometry(0.3, 0.3, 0.3), smokeMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  props.filter(p => SMOKE[p.name]).forEach(p => {
    p.chimney = SMOKE[p.name];
    p.smoke = [0, 1, 2].map(() => { const m = new THREE.Mesh(smokeGeo, smokeMat); p.obj.add(m); return m; });
  });
  props.filter(p => p.name === 'windmill').forEach(p => { p.blades = p.obj.getObjectByName('windmill_blades'); });

  // Floating things: balloons and clouds drift over the far side of the board
  const floaters = [];
  for (let s = 14; s < L; s += 30) {
    const h = headingAt(s);
    posAt(s, tmp);
    const b = tpl.balloon.clone();
    b.position.copy(tmp).add(new THREE.Vector3(Math.sin(h), 0, Math.cos(h)).multiplyScalar(-(7 + rand() * 6)));
    floaters.push({ obj: b, s, base: b.position.clone(), y: 4.5 + rand() * 2.5, phase: rand() * 6.28, kind: 'balloon' });
    scene.add(b);
    for (let i = 0; i < 2; i++) {
      const c = tpl.cloud.clone();
      posAt(s + 8 + i * 12, tmp);
      const ch = headingAt(s + 8 + i * 12);
      c.position.copy(tmp).add(new THREE.Vector3(Math.sin(ch), 0, Math.cos(ch)).multiplyScalar(-(6 + rand() * 11)));
      c.scale.setScalar(0.8 + rand() * 0.7);
      floaters.push({ obj: c, s: s + 8 + i * 12, base: c.position.clone(), y: 5.5 + rand() * 2.5, phase: rand() * 6.28, kind: 'cloud' });
      scene.add(c);
    }
  }

  // Coins hover over every sixth space and pop when the car reaches them
  const coins = [];
  for (let k = 7; k < tileCount - 6; k += 6) {
    const c = tpl.coin.clone();
    c.position.copy(tileBase[k].p);
    scene.add(c);
    coins.push({ obj: c, s: tileS[k], phase: k });
  }

  // Signs over the road for each stop, with confetti as the car drives under
  const confGeo = new THREE.BoxGeometry(0.16, 0.16, 0.16), confMat = new THREE.MeshLambertMaterial();
  const stops = STOPS.map((def, n) => {
    const group = tpl.arch.clone();
    const c = document.createElement('canvas');
    c.width = 688; c.height = 168;
    const texture = new THREE.CanvasTexture(c);
    texture.colorSpace = THREE.SRGBColorSpace;
    const draw = () => {
      const g = c.getContext('2d');
      g.fillStyle = def.color; g.fillRect(0, 0, c.width, c.height);
      g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 8; g.strokeRect(12, 12, c.width - 24, c.height - 24);
      g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = '700 104px "Pixelify Sans", ui-monospace, monospace';
      g.fillText(def.label, c.width / 2, c.height / 2 + 6);
      texture.needsUpdate = true;
    };
    draw();
    document.fonts.load('700 104px "Pixelify Sans"').then(draw, () => {});
    const signMat = new THREE.MeshBasicMaterial({ map: texture });
    for (const dir of [-1, 1]) {
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 1.1), signMat);
      sign.position.set(dir * 0.27, 3.875, 0);
      sign.rotation.y = dir * Math.PI / 2;
      group.add(sign);
    }
    const r = rng(100 + n);
    const bits = Array.from({ length: 44 }, () => ({
      v: new THREE.Vector3((r() - 0.5) * 7, 3 + r() * 5, (r() - 0.5) * 7), spin: r() * 9, z: (r() - 0.5) * 4,
    }));
    const confetti = new THREE.InstancedMesh(confGeo, confMat, bits.length);
    bits.forEach((_, i) => confetti.setColorAt(i, col.setHex(CONFETTI[i % CONFETTI.length])));
    confetti.frustumCulled = false;
    confetti.visible = false;
    scene.add(group, confetti);
    return { ...def, group, confetti, bits, s: 0, p: new THREE.Vector3() };
  });

  // ------------------------------------------------------------ layout
  const sections = { projects: document.getElementById('projects'), skills: document.getElementById('skills') };
  const heroCard = document.querySelector('.hero .card');
  const CAM_DIR = new THREE.Vector3();
  let W = 1, H = 1, maxScroll = 1, dist = 26, camAz = 0.4;
  const CAM_EL = 40 * Math.PI / 180;

  function layout() {
    W = document.documentElement.clientWidth; H = innerHeight;
    maxScroll = Math.max(1, document.documentElement.scrollHeight - H);
    const wide = W >= 1000;
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, wide ? 2 : 1.75));
    renderer.setSize(W, H, false);
    camera.aspect = W / H;

    // On wide screens the cards sit on the left, so the car is centred in the space to their right.
    // On narrow screens it sits low in the middle and shows in the gaps between sections.
    const cardRight = heroCard.getBoundingClientRect().right;
    const fx = wide ? (cardRight + W) / 2 / W : 0.5, fy = wide ? 0.54 : 0.68;
    camera.setViewOffset(W, H, (0.5 - fx) * W, (0.5 - fy) * H, W, H);
    camAz = (wide ? 24 : 12) * Math.PI / 180;
    const seeAcross = wide ? 12 * (W / (W - cardRight)) * 0.5 : 10.5;        // board units visible across
    dist = Math.max(24, seeAcross / (2 * Math.tan(15 * Math.PI / 180) * camera.aspect));
    scene.fog.near = dist * 1.25; scene.fog.far = dist * 2.9;
    camera.updateProjectionMatrix();

    // Each sign stands where the car will be when its section scrolls into view
    const at = el => CAR_START + clamp01((el.offsetTop - H * (wide ? 0.6 : 0.95)) / maxScroll) * L;
    const where = { start: CAR_START + 9, projects: Math.max(at(sections.projects), CAR_START + 26), skills: at(sections.skills), contact: L - 1 };
    stops.forEach(st => {
      st.s = where[st.id];
      posAt(st.s, st.p);
      st.group.position.copy(st.p);
      st.group.rotation.y = headingAt(st.s);
    });
  }

  // ------------------------------------------------------------ animation
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v3 = new THREE.Vector3(), sc = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  const sunRight = new THREE.Vector3().crossVectors(UP, SUN_DIR).normalize();
  const sunUp = new THREE.Vector3().crossVectors(SUN_DIR, sunRight);
  const carPos = new THREE.Vector3(), focus = new THREE.Vector3();
  let lead = scrollY, sy = scrollY, dir = 1, ang = null, time = 0, last = performance.now();
  let carS = CAR_START, prevS = null, speed = 0, lean = 0, puffClock = 0, hudKey = '';

  function frame(now) {
    const dt = Math.min(Math.max((now - last) / 1000, 0.001), 0.05);
    last = now;
    if (!reduce) time += dt;

    // Two-stage smoothing so the car eases into and out of motion
    lead = reduce ? scrollY : lead + (scrollY - lead) * Math.min(1, dt * 9);
    sy = reduce ? scrollY : sy + (lead - sy) * Math.min(1, dt * 7);
    carS = CAR_START + sy / maxScroll * L;
    if (prevS === null) prevS = carS;
    const vel = (carS - prevS) / dt;
    prevS = carS;
    speed += (vel - speed) * Math.min(1, dt * 8);
    if (speed > 0.6) dir = 1; else if (speed < -0.6) dir = -1;

    // Car: follow the path, face the way it's going (U-turn when scrolling back), lean into bends
    posAt(carS, carPos);
    const target = headingAt(carS) + (dir < 0 ? Math.PI : 0);
    if (ang === null) ang = target;
    const diff = ((target - ang) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
    const turn = reduce ? diff : diff * Math.min(1, dt * 9);
    ang += turn;
    lean += (THREE.MathUtils.clamp(turn / dt * 0.05, -0.16, 0.16) - lean) * Math.min(1, dt * 6);
    const fast = Math.min(Math.abs(speed) / 14, 1);
    car.position.set(carPos.x, 0.3, carPos.z);
    car.rotation.y = ang;
    body.position.y = Math.sin(time * 9) * 0.012 + Math.abs(Math.sin(carS * 2.6)) * 0.03 * fast;
    body.rotation.set(lean, 0, -0.05 * fast * Math.sign(speed) * dir);
    wheels.forEach(w => { w.rotation.z = -carS * dir / 0.25; });

    // Exhaust puffs while driving
    puffClock += dt;
    if (!reduce && fast > 0.12 && puffClock > 0.07) {
      puffClock = 0;
      const p = puffs.find(p => p.userData.life <= 0);
      if (p) {
        p.userData.life = 0.6;
        p.position.set(carPos.x - Math.cos(ang) * 1.25, 0.6, carPos.z + Math.sin(ang) * 1.25);
        p.userData.v.set((Math.random() - 0.5) * 0.8, 1.4 + Math.random(), (Math.random() - 0.5) * 0.8);
      }
    }
    puffs.forEach(p => {
      const u = p.userData;
      if (u.life <= 0) { p.visible = false; return; }
      u.life -= dt;
      p.visible = true;
      p.position.addScaledVector(u.v, dt);
      p.scale.setScalar(Math.max(u.life / 0.6, 0.01) * (1 + fast));
      p.rotation.y += dt * 4;
    });

    // Spaces drop in ahead of the car, ripple gently, and dip as the car rolls over them
    for (let k = 0; k < tileCount; k++) {
      const ds = ahead(tileS[k], carS), b = tileBase[k];
      const t = Math.min(clamp01((17 - ds) / 4.5), clamp01((ds + 60) / 6));   // and they lift away far behind
      const grow = t <= 0 ? 0.0001 : easeOutBack(t);
      const y = 0.1 + (1 - t) * 7 + Math.sin(time * 1.6 + k * 0.7) * 0.02 - 0.09 * Math.exp(-ds * ds * 1.4);
      e.set(0, b.h, (1 - t) * 1.2);
      q.setFromEuler(e);
      m4.compose(v3.set(b.p.x, y, b.p.z), q, sc.setScalar(grow));
      rims.setMatrixAt(k, m4);
      m4.compose(v3.set(b.p.x, y + 0.06, b.p.z), q, sc.setScalar(grow));
      tops.setMatrixAt(k, m4);
    }
    rims.instanceMatrix.needsUpdate = tops.instanceMatrix.needsUpdate = true;

    // Scenery pops up as the car approaches, sways, and bounces as the car goes by
    for (const p of props) {
      const ds = ahead(p.s, carS);
      const o = p.obj;
      o.visible = ds < 34 && ds > -64;
      if (!o.visible) continue;
      const t = Math.min(clamp01((34 - ds) / 6), clamp01((ds + 64) / 6));
      const near = Math.exp(-ds * ds / 10) * Math.exp(-Math.max(p.p.distanceTo(carPos) - 4, 0) * 0.3);
      const grow = p.scale * (t <= 0 ? 0.0001 : easeOutBack(t));
      const hop = Math.abs(Math.sin(time * 7 + p.phase)) * near * fast;
      o.scale.set(grow * (1 - hop * 0.08), grow * (1 + hop * 0.16), grow * (1 - hop * 0.08));
      o.position.y = p.y;
      if (p.name.startsWith('tree') || p.name === 'bush') {
        o.rotation.z = Math.sin(time * 1.4 + p.phase) * 0.035;
        o.rotation.x = Math.cos(time * 1.1 + p.phase) * 0.025;
      } else if (p.name.startsWith('die')) {
        o.position.y = p.y + Math.sin(time * 1.3 + p.phase) * 0.3;
        o.rotation.set(time * 0.7 + p.phase, time * 0.9, p.phase);
      }
      if (p.blades) p.blades.rotation.z = time * 1.5 + p.phase;
      if (p.smoke) p.smoke.forEach((m, i) => {
        const k = (time * 0.35 + i / 3 + p.phase) % 1;
        m.position.set(p.chimney[0] + Math.sin(k * 5 + i) * 0.15, p.chimney[1] + k * 1.9, p.chimney[2]);
        m.scale.setScalar(Math.sin(k * Math.PI) * 1.1 + 0.01);
      });
    }
    for (const f of floaters) {
      const ds = ahead(f.s, carS), o = f.obj;
      o.visible = ds < 50 && ds > -70;
      if (!o.visible) continue;
      if (f.kind === 'balloon') {
        const t = clamp01((40 - ds) / 8);
        o.position.set(f.base.x + Math.sin(time * 0.25 + f.phase) * 1.2, f.y * easeOutBack(t) + Math.sin(time * 0.8 + f.phase) * 0.35, f.base.z);
        o.rotation.y = time * 0.2 + f.phase;
        o.scale.setScalar(t <= 0 ? 0.0001 : easeOutBack(t));
      } else {
        o.position.set(f.base.x + Math.sin(time * 0.12 + f.phase) * 5, f.y + Math.sin(time * 0.5 + f.phase) * 0.2, f.base.z);
      }
    }
    let got = 0;
    for (const c of coins) {
      const ds = ahead(carS, c.s), o = c.obj;
      if (Math.min(carS - CAR_START, L) > wrap(c.s - CAR_START) - 0.5) got++;
      const k = clamp01((ds + 0.5) / 1.5);                   // 0 waiting, 1 collected
      const t = clamp01((17 + ds) / 4.5);                    // arrives with its space
      o.visible = k < 1 && t > 0;
      if (!o.visible) continue;
      o.position.y = 1.25 + Math.sin(time * 2.2 + c.phase) * 0.12 + k * 2.4 + (1 - t) * 7;
      o.rotation.y = time * 2.4 + c.phase + k * 14;
      o.scale.setScalar((1 - k * k) * t + 0.0001);
    }
    for (const st of stops) {
      const t = ahead(carS, st.s) / (st.id === 'contact' ? 18 : 9);
            st.group.rotation.z = Math.sin(time * 1.2 + st.s) * 0.008;
      st.confetti.visible = t > 0 && t < 1 && !(st.id === 'contact' && sy < maxScroll / 2);
      if (!st.confetti.visible) continue;
      const h = st.group.rotation.y, cx = Math.cos(h), sz = -Math.sin(h);
      st.bits.forEach((b, i) => {
        const tt = t * 1.6;
        v3.set(st.p.x + cx * 1.5 * t - sz * b.z + b.v.x * tt, 3.4 + b.v.y * tt - 7.5 * tt * tt, st.p.z + sz * 1.5 * t + cx * b.z + b.v.z * tt);
        if (v3.y < 0.08) v3.y = 0.08;
        e.set(b.spin * t * 3, b.spin * t * 2, 0);
        m4.compose(v3, q.setFromEuler(e), sc.setScalar(1 - t * t));
        st.confetti.setMatrixAt(i, m4);
      });
      st.confetti.instanceMatrix.needsUpdate = true;
    }

    // Camera rides along at a fixed angle, looking a little way up the road
    posAt(carS + 2.5, focus);
    focus.lerp(carPos, 0.5);
    const camA = around(focus) + camAz;
    CAM_DIR.set(Math.sin(camA) * Math.cos(CAM_EL), Math.sin(CAM_EL), Math.cos(camA) * Math.cos(CAM_EL));
    camera.position.copy(focus).addScaledVector(CAM_DIR, dist);
    camera.lookAt(focus.x, 0.4, focus.z);

    // Sunlight follows too, snapped to shadow-map texels so the shadows don't shimmer
    const texel = SHADOW_HALF * 2 / SHADOW_MAP;
    v3.copy(sunRight).multiplyScalar(Math.round(focus.dot(sunRight) / texel) * texel)
      .addScaledVector(sunUp, Math.round(focus.dot(sunUp) / texel) * texel)
      .addScaledVector(SUN_DIR, focus.dot(SUN_DIR));
    sun.target.position.copy(v3);
    sun.position.copy(v3).addScaledVector(SUN_DIR, 70);

    const space = Math.min(Math.max(Math.floor(wrap(carS) / PITCH) + 1, 1), tileCount);
    const key = space + '/' + got;
    if (key !== hudKey) {
      hudKey = key;
      hudSpace.textContent = String(space).padStart(3, '0') + ' / ' + tileCount;
      hudCoins.textContent = got;
    }

    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  // Arrow keys steer the car rather than the page: up always drives forward (the car heads up the
  // screen) and down always reverses, so they scroll the opposite way to the browser default.
  let held = 0, keyLast = 0;
  const lap = (top, sign) => {               // jump the page, and shift the car's smoothing so it doesn't notice
    scrollTo({ top, behavior: 'instant' });
    lead += sign * maxScroll; sy += sign * maxScroll; prevS += sign * L;
  };
  const drive = now => {
    if (!held) return;
    const dt = Math.min((now - keyLast) / 1000, 0.05);
    keyLast = now;
    // The road is a loop, so driving past either end of the page carries on from the other end
    if (held > 0 && scrollY >= maxScroll - 1) lap(0, -1);
    else if (held < 0 && scrollY <= 0) lap(maxScroll, 1);
    else scrollBy({ top: held * 900 * dt, behavior: 'instant' });
    requestAnimationFrame(drive);
  };
  addEventListener('keydown', ev => {
    if (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') return;
    if (ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey || document.body.classList.contains('no-scroll')) return;
    if (ev.target.closest?.('input, textarea, select, [contenteditable]')) return;
    ev.preventDefault();
    const was = held;
    held = ev.key === 'ArrowUp' ? 1 : -1;
    if (!was) { keyLast = performance.now(); requestAnimationFrame(drive); }
  });
  addEventListener('keyup', ev => { if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') held = 0; });
  addEventListener('blur', () => { held = 0; });

  let queued = false;
  const relayout = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; layout(); });
  };
  layout();
  addEventListener('resize', relayout);
  addEventListener('load', relayout);
  new ResizeObserver(relayout).observe(document.body);   // images loading in change the page height
  document.body.classList.add('world-ready');
  requestAnimationFrame(frame);
}

new GLTFLoader().load('models/world.glb', gltf => {
  try { main(gltf); } catch (err) { console.error(err); }   // without WebGL the page keeps its flat board background
}, undefined, err => console.error(err));
