import {
  LANE_COUNT,
  type Lane,
  type Row,
  generateRow,
  generatePickup,
  type Pickup,
  isCollision,
  clampLane,
  speedForScore,
  difficultyForScore,
  honeyAfterHit,
  honeyAfterRefill,
  isGrounded,
  MAX_HONEY,
  LEVEL_COUNT,
  type Level,
  type Vine,
  clampLevel,
  generateVine,
  vineReach,
  vineCatches,
} from "./game-logic.ts";

const WORLD_W = 300;
const WORLD_H = 500;
const LANE_W = WORLD_W / LANE_COUNT;
const ROW_H = 56;
// The bee flies in the lower band of the sky: high enough to have somewhere
// to climb to, low enough that rain from the top is still readable on the way
// down.
const LEVEL_TOP = WORLD_H * 0.44;
const LEVEL_BOTTOM = WORLD_H - 64;
const VINE_GROW_S = 0.9;
const VINE_HOLD_S = 1.4;
const VINE_LIFE_S = VINE_GROW_S * 2 + VINE_HOLD_S;
const VINE_INTERVAL_S = 2.6;
const VINE_HALF_H = 26;
const ROW_SPACING_PX = 170;
const SPEED_SCALE = 50;
// Playtesting (not reading the code) turned this up: on a fresh load the
// first row could already reach the player only ~3s in, tight for a
// stranger who's still orienting on their very first look. This holds the
// spawn timer back so the opening run gets a beat longer before it matters.
const START_GRACE_PX = 120;
/** How long the bee flickers and cannot be hit again after taking one. */
const STUNNED_S = 1.1;

const canvas = document.querySelector<HTMLCanvasElement>("#game")!;
const ctx = canvas.getContext("2d")!;
const live = document.querySelector<HTMLElement>("#live")!;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;


// --- Flight of the Bumblebee -------------------------------------------
// public/flight-of-the-bumblebee.mp3 --- The US Army Band, Creative Commons
// Public Domain Mark 1.0, via archive.org. Both halves of the copyright have
// to be clear to ship a recording, not just one: Rimsky-Korsakov died in 1908
// so the *composition* is long out of copyright, but a performance carries its
// own separate rights on top of that. A US Army Band recording is a work of
// the federal government, so it has none.
const music = new Audio("./flight-of-the-bumblebee.mp3");
music.loop = true;
music.volume = 0.55;

let musicOn = true;
let musicStarted = false;

/** The bee flies faster as the rain thickens, and the tune goes with it. */
function setBuzzRate(speed: number): void {
  music.playbackRate = 1 + Math.min(0.18, (speed - 3) * 0.03);
}

/** Browsers refuse to start audio without a gesture, so this runs on the
 *  first real input rather than on load. */
function startMusic(): void {
  if (musicStarted || !musicOn) return;
  musicStarted = true;
  // A rejected play() is not worth breaking input over --- the player just
  // gets a silent game.
  void music.play().catch(() => {
    musicStarted = false;
  });
}

function toggleMusic(): void {
  musicOn = !musicOn;
  if (musicOn) {
    musicStarted = false;
    startMusic();
  } else {
    music.pause();
  }
}

function laneCenter(lane: Lane): number {
  return lane * LANE_W + LANE_W / 2;
}

function levelY(level: Level): number {
  return LEVEL_TOP + ((LEVEL_BOTTOM - LEVEL_TOP) * level) / (LEVEL_COUNT - 1);
}

let playerLane: Lane = 1;
let playerLevel: Level = 2;
let playerX = laneCenter(playerLane);
let playerY = levelY(playerLevel);
let score = 0;
let best = 0;
let honey = MAX_HONEY;
let flowers = 0;
let stunned = 0;
let clock = 0;
type Drop = { row: Row; y: number; scored: boolean; pickup: Pickup | null; taken: boolean };
let rows: Drop[] = [];
let vines: { vine: Vine; age: number }[] = [];
let vineTimer = VINE_INTERVAL_S;
let spawnAccumulator = -START_GRACE_PX;
let lastTime = 0;
let gameOver = false;

function resetGame(): void {
  playerLane = 1;
  playerLevel = 2;
  playerX = laneCenter(playerLane);
  playerY = levelY(playerLevel);
  vines = [];
  vineTimer = VINE_INTERVAL_S;
  score = 0;
  honey = MAX_HONEY;
  flowers = 0;
  stunned = 0;
  rows = [];
  spawnAccumulator = 0;
  gameOver = false;
  live.textContent = "";
}

function endGame(): void {
  gameOver = true;
  best = Math.max(best, score);
  live.textContent = `Grounded. Score ${score}.`;
}

function move(delta: -1 | 1): void {
  if (gameOver) {
    resetGame();
    return;
  }
  playerLane = clampLane(playerLane + delta);
}

function climb(delta: -1 | 1): void {
  if (gameOver) {
    resetGame();
    return;
  }
  playerLevel = clampLevel(playerLevel + delta);
}

/** One hit's worth of damage, wherever it came from. */
function takeHit(): void {
  if (stunned > 0) return;
  honey = honeyAfterHit(honey);
  stunned = STUNNED_S;
  if (isGrounded(honey)) endGame();
  else live.textContent = `Hit. ${honey} honey left.`;
}

function update(dt: number): void {
  clock += dt;
  if (stunned > 0) stunned = Math.max(0, stunned - dt);

  const speed = speedForScore(score) * SPEED_SCALE;
  setBuzzRate(speedForScore(score));
  spawnAccumulator += dt * speed;
  if (spawnAccumulator >= ROW_SPACING_PX) {
    spawnAccumulator -= ROW_SPACING_PX;
    const row = generateRow(Math.random, difficultyForScore(score));
    rows.push({ row, y: -ROW_H, scored: false, pickup: generatePickup(Math.random, row), taken: false });
  }

  // Vines grow in from the sides across one level at a time. generateVine
  // refuses to leave the bee fewer than MIN_CLEAR_LEVELS to fly to, so there
  // is always somewhere to go and it is never more than one move away.
  vineTimer -= dt;
  if (vineTimer <= 0) {
    vineTimer = VINE_INTERVAL_S;
    const born = generateVine(Math.random, vines.map((v) => v.vine));
    if (born) vines.push({ vine: born, age: 0 });
  }
  for (const v of vines) {
    v.age += dt;
    v.vine.reach = vineReach(v.age, VINE_GROW_S, VINE_HOLD_S);
  }
  vines = vines.filter((v) => v.age < VINE_LIFE_S);

  for (const r of rows) {
    r.y += speed * dt;

    // A pickup is taken on the way past, a little before the rain in the same
    // row reaches the bee.
    if (
      !r.taken &&
      r.pickup !== null &&
      r.pickup.lane === playerLane &&
      Math.abs(r.y + ROW_H / 2 - playerY) < ROW_H * 0.7
    ) {
      r.taken = true;
      if (r.pickup.kind === "flower") {
        flowers += 1;
      } else {
        const refilled = honeyAfterRefill(honey);
        if (refilled !== honey) {
          honey = refilled;
          live.textContent = `Honey gathered. ${honey} in store.`;
        }
      }
    }

    if (!r.scored && r.y + ROW_H / 2 >= playerY) {
      r.scored = true;
      if (isCollision(playerLane, r.row)) takeHit();
      else score += 1;
    }
  }
  rows = rows.filter((r) => r.y < WORLD_H + ROW_H);

  // A vine catches the bee for as long as both are in the same place, so the
  // stun timer is what stops one vine taking every drop of honey at once.
  for (const v of vines) {
    if (vineCatches(v.vine, playerLevel, playerX, WORLD_W)) takeHit();
  }

  playerX += (laneCenter(playerLane) - playerX) * Math.min(1, dt * 14);
  playerY += (levelY(playerLevel) - playerY) * Math.min(1, dt * 11);
}

function drawRaindrop(cx: number, cy: number, h: number, fat = 0.42): void {
  // A teardrop: round belly, drawn point-up.
  const w = h * fat;
  ctx.beginPath();
  ctx.moveTo(cx, cy - h / 2);
  ctx.bezierCurveTo(cx + w * 0.55, cy - h * 0.05, cx + w * 0.5, cy + h / 2, cx, cy + h / 2);
  ctx.bezierCurveTo(cx - w * 0.5, cy + h / 2, cx - w * 0.55, cy - h * 0.05, cx, cy - h / 2);
  ctx.fill();
}

function drawFlower(cx: number, cy: number, r: number): void {
  ctx.fillStyle = "#f2a2d0";
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * Math.PI * 2;
    ctx.beginPath();
    ctx.ellipse(cx + Math.cos(a) * r * 0.8, cy + Math.sin(a) * r * 0.8, r * 0.5, r * 0.36, a, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "#ffd34d";
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.42, 0, Math.PI * 2);
  ctx.fill();
}

function drawBee(cx: number, cy: number, tilt: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(tilt);

  // Drawn nose-up, because that is the way it is flying. Wings first, so the
  // body sits over them. They blur rather than flap: at a bee's wingbeat that
  // is what you would actually see.
  const flutter = 0.75 + 0.25 * Math.sin(clock * 42);
  ctx.fillStyle = "rgba(232,244,255,0.55)";
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(side * 12, -3, 12 * flutter, 7, side * 0.6, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = "#f7c948";
  ctx.beginPath();
  ctx.ellipse(0, 0, 13, 17, 0, 0, Math.PI * 2);
  ctx.fill();

  // Stripes, clipped to the body so they end where it does.
  ctx.save();
  ctx.clip();
  ctx.fillStyle = "#221a08";
  for (const y of [-2, 7]) ctx.fillRect(-14, y, 28, 5);
  ctx.restore();

  ctx.fillStyle = "#221a08";
  ctx.beginPath();
  ctx.arc(0, -13, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#221a08";
  ctx.lineWidth = 1.4;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(side * 3, -16);
    ctx.quadraticCurveTo(side * 8, -23, side * 4, -25);
    ctx.stroke();
  }
  ctx.restore();
}

function drawHoney(cx: number, cy: number, full: boolean): void {
  ctx.fillStyle = full ? "#ffb31a" : "rgba(255,179,26,0.22)";
  drawRaindrop(cx, cy, 17);
}

function drawHoneyPot(cx: number, cy: number, r: number): void {
  ctx.fillStyle = "#c98a14";
  drawRaindrop(cx, cy, r * 2.4, 0.62);
  ctx.fillStyle = "#ffb31a";
  drawRaindrop(cx, cy + r * 0.1, r * 2, 0.6);
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.beginPath();
  ctx.ellipse(cx - r * 0.28, cy + r * 0.15, r * 0.16, r * 0.3, -0.3, 0, Math.PI * 2);
  ctx.fill();
}

function drawVine(v: { vine: Vine; age: number }): void {
  const y = levelY(v.vine.level);
  const across = v.vine.reach * WORLD_W;
  if (across <= 0) return;
  const fromLeft = v.vine.side === "left";
  const x0 = fromLeft ? 0 : WORLD_W;
  const dir = fromLeft ? 1 : -1;

  ctx.save();
  ctx.strokeStyle = "#3f7d3a";
  ctx.lineWidth = 7;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x0, y);
  // A stem that waves rather than a straight bar, so it reads as growing.
  for (let t = 0; t <= 1.001; t += 0.1) {
    const x = x0 + dir * across * t;
    ctx.lineTo(x, y + Math.sin(t * 7 + v.age * 3) * 6);
  }
  ctx.stroke();

  ctx.fillStyle = "#57a84e";
  const leaves = Math.max(1, Math.floor(across / 26));
  for (let i = 0; i < leaves; i += 1) {
    const t = (i + 0.5) / leaves;
    const x = x0 + dir * across * t;
    const wobble = Math.sin(t * 7 + v.age * 3) * 6;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(x, y + wobble + side * 9, 11, 6, side * 0.5 * dir, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // The growing tip, so you can see which way it is heading.
  ctx.fillStyle = "#7ec96f";
  ctx.beginPath();
  ctx.arc(x0 + dir * across, y + Math.sin(7 + v.age * 3) * 6, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawBackground(): void {
  const sky = ctx.createLinearGradient(0, 0, 0, WORLD_H);
  sky.addColorStop(0, "#4d7ba8");
  sky.addColorStop(0.55, "#7fa3c0");
  sky.addColorStop(1, "#b7cbd6");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);

  // Everything below drifts at its own rate, so the sky has depth without a
  // single extra asset: far clouds crawl, near rain streaks tear past.
  const drift = clock * 10;
  ctx.fillStyle = "rgba(255,255,255,0.16)";
  for (let i = 0; i < 5; i += 1) {
    const cx = ((i * 97 + drift * (0.3 + i * 0.05)) % (WORLD_W + 160)) - 80;
    const cy = 40 + i * 63;
    for (const [dx, dy, r] of [[0, 0, 26], [22, 6, 20], [-24, 7, 18]]) {
      ctx.beginPath();
      ctx.arc(cx + (dx ?? 0), cy + (dy ?? 0), r ?? 20, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Distant hills, and a meadow the bee is flying over.
  ctx.fillStyle = "rgba(90,124,96,0.55)";
  ctx.beginPath();
  ctx.moveTo(0, WORLD_H - 46);
  for (let x = 0; x <= WORLD_W; x += 20) {
    ctx.lineTo(x, WORLD_H - 46 - Math.sin(x / 58) * 14 - Math.cos(x / 31) * 6);
  }
  ctx.lineTo(WORLD_W, WORLD_H);
  ctx.lineTo(0, WORLD_H);
  ctx.fill();

  ctx.fillStyle = "#5c7f4f";
  ctx.fillRect(0, WORLD_H - 30, WORLD_W, 30);
  for (let i = 0; i < 14; i += 1) {
    const x = ((i * 41 + drift * 1.6) % (WORLD_W + 30)) - 15;
    ctx.fillStyle = i % 3 === 0 ? "#e79ac4" : "#f2d06b";
    ctx.beginPath();
    ctx.arc(x, WORLD_H - 22 + (i % 3) * 5, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Background rain, well behind the lanes it is raining in.
  ctx.strokeStyle = "rgba(226,240,250,0.30)";
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 26; i += 1) {
    const x = (i * 53) % WORLD_W;
    const y = ((i * 91 + clock * 460) % (WORLD_H + 60)) - 30;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - 2, y + 16);
    ctx.stroke();
  }
}

function render(): void {
  ctx.clearRect(0, 0, WORLD_W, WORLD_H);
  drawBackground();

  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  for (let i = 1; i < LANE_COUNT; i++) {
    ctx.beginPath();
    ctx.moveTo(i * LANE_W, 0);
    ctx.lineTo(i * LANE_W, WORLD_H);
    ctx.stroke();
  }

  for (const r of rows) {
    if (r.pickup !== null && !r.taken) {
      const px = laneCenter(r.pickup.lane);
      const py = r.y + ROW_H / 2;
      if (r.pickup.kind === "flower") drawFlower(px, py, 15);
      else drawHoneyPot(px, py, 11);
    }
    for (const lane of r.row.blocked) {
      const cx = laneCenter(lane);
      const cy = r.y + ROW_H / 2;
      ctx.fillStyle = "rgba(255,255,255,0.30)";
      drawRaindrop(cx, cy - 22, 24, 0.7);
      ctx.fillStyle = "#3d6fa8";
      drawRaindrop(cx, cy, ROW_H - 8, 0.78);
      ctx.fillStyle = "rgba(255,255,255,0.45)";
      ctx.beginPath();
      ctx.ellipse(cx - 6, cy + 4, 4, 7, -0.3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  for (const v of vines) drawVine(v);

  // A stunned bee flickers, which is also the only thing telling you the next
  // raindrop cannot hurt you yet.
  const visible = gameOver || stunned === 0 || Math.floor(clock * 14) % 2 === 0;
  if (visible) {
    const tilt = (laneCenter(playerLane) - playerX) * -0.012;
    drawBee(playerX, playerY, gameOver ? 1.4 : tilt);
  }

  ctx.fillStyle = "#12233a";
  ctx.font = "600 20px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(`${score}`, 14, 32);

  // Flowers are their own tally: they are what you are playing for, and they
  // are deliberately not health, so gathering one is never a wash.
  drawFlower(22, 56, 9);
  ctx.fillStyle = "#12233a";
  ctx.font = "600 15px system-ui, sans-serif";
  ctx.fillText(`${flowers}`, 36, 61);

  for (let i = 0; i < MAX_HONEY; i += 1) {
    drawHoney(WORLD_W - 22 - i * 22, 24, i < honey);
  }

  ctx.textAlign = "right";
  ctx.font = "13px system-ui, sans-serif";
  ctx.fillStyle = musicOn ? "#12233a" : "rgba(18,35,58,0.35)";
  ctx.fillText(musicOn ? "\u266a" : "\u266a\u0338", WORLD_W - 14, 52);
  ctx.textAlign = "left";

  if (gameOver) {
    ctx.fillStyle = "rgba(10,20,34,0.72)";
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);
    ctx.textAlign = "center";
    ctx.fillStyle = "#f7c948";
    ctx.font = "600 16px system-ui, sans-serif";
    ctx.fillText("GROUNDED", WORLD_W / 2, WORLD_H / 2 - 30);
    ctx.fillStyle = "#f5f5fa";
    ctx.font = "32px system-ui, sans-serif";
    ctx.fillText(`${score}`, WORLD_W / 2, WORLD_H / 2 + 8);
    ctx.font = "13px system-ui, sans-serif";
    ctx.fillStyle = "rgba(245,245,250,0.7)";
    ctx.fillText(`best ${best}`, WORLD_W / 2, WORLD_H / 2 + 32);
    ctx.fillText(`${flowers} flowers`, WORLD_W / 2, WORLD_H / 2 + 52);
    ctx.textAlign = "left";
  }
}

function frame(t: number): void {
  if (!lastTime) lastTime = t;
  const dt = Math.min(0.05, (t - lastTime) / 1000);
  lastTime = t;
  if (!gameOver) update(dt);
  render();
  requestAnimationFrame(frame);
}

function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  const availW = Math.min(window.innerWidth - 32, 480);
  const availH = window.innerHeight - canvas.getBoundingClientRect().top - 24;
  const scale = Math.max(0.5, Math.min(availW / WORLD_W, availH / WORLD_H));
  canvas.style.width = `${WORLD_W * scale}px`;
  canvas.style.height = `${WORLD_H * scale}px`;
  canvas.width = WORLD_W * dpr;
  canvas.height = WORLD_H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

window.addEventListener("resize", resize);
resize();

window.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  // A keyboard user tabbed to another focusable element (here, the header's
  // Home link) is using this key for that element's own native behaviour,
  // not the game --- don't swallow it.
  if ((e.target as HTMLElement).closest("a, button, input, select, textarea")) return;
  if (e.key === "m" || e.key === "M") {
    e.preventDefault();
    toggleMusic();
    return;
  }
  startMusic();
  if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") {
    e.preventDefault();
    move(-1);
  } else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") {
    e.preventDefault();
    move(1);
  } else if (e.key === "ArrowUp" || e.key === "w" || e.key === "W") {
    e.preventDefault();
    climb(-1);
  } else if (e.key === "ArrowDown" || e.key === "s" || e.key === "S") {
    e.preventDefault();
    climb(1);
  } else if (e.key === " " || e.key === "Enter") {
    // Prevent Space's default page-scroll even while playing, when it does
    // nothing in-game --- without this, a short viewport (the letterbox's
    // 0.5 minimum scale can leave the canvas taller than the window) lets
    // Space scroll the canvas out of view mid-round.
    e.preventDefault();
    if (gameOver) resetGame();
  }
});

canvas.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  startMusic();
  if (gameOver) {
    resetGame();
    return;
  }
  // Two axes now, so a tap picks the one it is furthest along: left or right
  // of the bee moves lanes, above or below it climbs or drops.
  const rect = canvas.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * WORLD_W;
  const y = ((e.clientY - rect.top) / rect.height) * WORLD_H;
  const dx = x - playerX;
  const dy = y - playerY;
  if (Math.abs(dx) >= Math.abs(dy)) move(dx < 0 ? -1 : 1);
  else climb(dy < 0 ? -1 : 1);
});

requestAnimationFrame(frame);
