/// <reference lib="dom" />
/**
 * The arcade page: starts the Worker that owns the World, sends it the
 * keyboard each time it changes, and draws each snapshot with Three.js.
 * The simulation is 2D; only the presentation is 3D.
 */
import {
  AmbientLight,
  Color,
  ConeGeometry,
  DirectionalLight,
  DynamicDrawUsage,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Scene,
  SphereGeometry,
  Vector3,
  WebGLRenderer
} from 'three';

import { FRAME_MS, HEIGHT, WIDTH, type InputState } from '../sim/sim';
import { KIND, STRIDE, type FromWorker, type ToWorker } from './protocol';

const MAX_ASTEROIDS = 8000;
const MAX_BULLETS = 512;

type FrameMessage = Extract<FromWorker, { type: 'frame' }>;

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const hud = document.querySelector<HTMLDivElement>('#hud')!;
const banner = document.querySelector<HTMLDivElement>('#banner')!;

const renderer = new WebGLRenderer({ antialias: true, canvas });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new Scene();
scene.background = new Color(0x05_07_10);

const camera = new PerspectiveCamera(40, 1, 10, 6000);
camera.position.set(0, 1250, 800);
camera.lookAt(0, 0, 40);

scene.add(new AmbientLight(0xff_ff_ff, 0.35));
const sun = new DirectionalLight(0xff_f1_e0, 2.2);
sun.position.set(-600, 900, 300);
scene.add(sun);

const floor = new Mesh(
  new PlaneGeometry(WIDTH, HEIGHT),
  new MeshStandardMaterial({ color: 0x0b_10_20, roughness: 1 })
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -60;
scene.add(floor);

const asteroids = new InstancedMesh(
  new IcosahedronGeometry(1, 0),
  new MeshStandardMaterial({
    color: 0x8a_7f_72,
    flatShading: true,
    roughness: 0.9
  }),
  MAX_ASTEROIDS
);
const bullets = new InstancedMesh(
  new SphereGeometry(1, 6, 4),
  new MeshBasicMaterial({ color: 0xff_e0_66 }),
  MAX_BULLETS
);
for (const mesh of [asteroids, bullets]) {
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.count = 0;
  scene.add(mesh);
}

// The cone points along +x, the direction a rotation of 0 faces.
const shipGeometry = new ConeGeometry(10, 30, 4);
shipGeometry.rotateZ(-Math.PI / 2);
const ship = new Mesh(
  shipGeometry,
  new MeshStandardMaterial({
    color: 0x5c_d6_ff,
    emissive: 0x0a_30_40,
    flatShading: true
  })
);
scene.add(ship);

const resize = () => {
  const { innerHeight: h, innerWidth: w } = window;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
};
window.addEventListener('resize', resize);
resize();

// --- the World, in its Worker ---

const worker = new Worker('./worker.js', { type: 'module' });
const post = (message: ToWorker) => worker.postMessage(message);

let previous: FrameMessage | undefined;
let current: FrameMessage | undefined;
let currentAt = 0;
let error: string | undefined;

worker.addEventListener('message', (event: MessageEvent<FromWorker>) => {
  const message = event.data;
  if (message.type === 'error') {
    ({ message: error } = message);
    return;
  }
  previous = current;
  current = message;
  currentAt = performance.now();
});
worker.addEventListener('error', event => {
  error = event.message;
});

// --- input ---

const held = new Set<string>();
let sent = '';
const sendInput = () => {
  const left = held.has('ArrowLeft') || held.has('KeyA');
  const right = held.has('ArrowRight') || held.has('KeyD');
  const input: InputState = {
    fire: held.has('Space'),
    thrust: held.has('ArrowUp') || held.has('KeyW'),
    turn: (right ? 1 : 0) - (left ? 1 : 0)
  };
  const key = JSON.stringify(input);
  if (key !== sent) {
    sent = key;
    post({ input, type: 'input' });
  }
};
window.addEventListener('keydown', event => {
  if (event.code === 'KeyR') {
    previous = undefined;
    current = undefined;
    post({ seed: Date.now() % 100_000, type: 'restart' });
    return;
  }
  held.add(event.code);
  sendInput();
  if (event.code.startsWith('Arrow') || event.code === 'Space') {
    event.preventDefault();
  }
});
window.addEventListener('keyup', event => {
  held.delete(event.code);
  sendInput();
});
window.addEventListener('blur', () => {
  held.clear();
  sendInput();
});

// --- drawing ---

const matrix = new Matrix4();
const position = new Vector3();
const quaternion = new Quaternion();
const scale = new Vector3();
const up = new Vector3(0, 1, 0);
const tumble = new Quaternion();
const tilt = new Vector3(1, 0, 0.4).normalize();

/** Each entity's index in the previous snapshot, by id */
const previousIndex = (frame: FrameMessage | undefined) => {
  const index = new Map<number, number>();
  if (frame) {
    for (let i = 0; i < frame.entities.length; i += STRIDE) {
      index.set(frame.entities[i + 1]!, i);
    }
  }
  return index;
};

let indexed: FrameMessage | undefined;
let index = new Map<number, number>();

const lerp = (a: number, b: number, t: number, span: number) =>
  // An entity that wrapped across an edge jumps rather than sweeping back.
  Math.abs(b - a) > span / 2 ? b : a + (b - a) * t;

const draw = () => {
  requestAnimationFrame(draw);
  if (!current) {
    banner.textContent = error ?? 'Starting the World…';
    renderer.render(scene, camera);
    return;
  }
  if (indexed !== previous) {
    indexed = previous;
    index = previousIndex(previous);
  }

  // How far we are into the next Frame: draw that far from the previous
  // snapshot towards the current one.
  const t = Math.min(1, (performance.now() - currentAt) / FRAME_MS);
  const { entities } = current;
  const old = previous?.entities;
  let asteroidCount = 0;
  let bulletCount = 0;
  ship.visible = false;

  for (let i = 0; i < entities.length; i += STRIDE) {
    const kind = entities[i]!;
    const id = entities[i + 1]!;
    let x = entities[i + 2]!;
    let y = entities[i + 3]!;
    let rotation = entities[i + 4]!;
    const radius = entities[i + 5]!;
    const j = index.get(id);
    if (old && j !== undefined) {
      x = lerp(old[j + 2]!, x, t, WIDTH);
      y = lerp(old[j + 3]!, y, t, HEIGHT);
      rotation = old[j + 4]! + (rotation - old[j + 4]!) * t;
    }
    position.set(x - WIDTH / 2, 0, y - HEIGHT / 2);

    if (kind === KIND.ship) {
      ship.visible = true;
      ship.position.copy(position);
      ship.rotation.set(0, -rotation, 0);
    } else if (kind === KIND.asteroid && asteroidCount < MAX_ASTEROIDS) {
      quaternion.setFromAxisAngle(up, -rotation);
      tumble.setFromAxisAngle(tilt, rotation * 0.7 + id);
      quaternion.multiply(tumble);
      scale.setScalar(radius);
      matrix.compose(position, quaternion, scale);
      asteroids.setMatrixAt(asteroidCount++, matrix);
    } else if (kind === KIND.bullet && bulletCount < MAX_BULLETS) {
      quaternion.identity();
      scale.setScalar(radius * 1.5);
      matrix.compose(position, quaternion, scale);
      bullets.setMatrixAt(bulletCount++, matrix);
    }
  }
  asteroids.count = asteroidCount;
  bullets.count = bulletCount;
  asteroids.instanceMatrix.needsUpdate = true;
  bullets.instanceMatrix.needsUpdate = true;

  hud.textContent =
    `score ${current.score}   lives ${current.lives}   wave ${current.wave}` +
    `   ·   ${asteroidCount} asteroids   Frame ${current.frameMs.toFixed(2)} ms`;
  banner.textContent =
    error ?? (current.lives <= 0 ? 'Game over. Press R to play again.' : '');
  renderer.render(scene, camera);
};

requestAnimationFrame(draw);
