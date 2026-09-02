import {
  LANE_COUNT,
  type Lane,
  type Row,
  generateRow,
  generateFlower,
  isCollision,
  clampLane,
  speedForScore,
  difficultyForScore,
  honeyAfterHit,
  honeyAfterRefill,
  isGrounded,
  MAX_HONEY,
  FLOWERS_PER_HONEY,
  FLOWER_POINTS,
} from "./game-logic.ts";

const WORLD_W = 300;
const WORLD_H = 500;
const LANE_W = WORLD_W / LANE_COUNT;
const ROW_H = 56;
const PLAYER_Y = WORLD_H - 70;
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
// Rimsky-Korsakov, 1900, and long out of copyright --- but a *recording* of it
// would not be, so the notes are encoded here and synthesised rather than
// shipped as audio. It also means the tempo can ride the game's own speed,
// which a file could not do.
//
// The famous opening is a chromatic run, which is the whole reason the piece
// sounds like an insect: semitone steps with no gaps read as a buzz.
const PHRASE: number[] = [
  76, 75, 74, 73, 72, 71, 70, 69, 68, 67, 66, 65,
  64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75,
];
const BASE_NOTE_S = 0.082;

let audioCtx: AudioContext | null = null;
let musicOn = true;
let noteAt = 0;
let noteIndex = 0;
let noteLength = BASE_NOTE_S;

/** The bee flies faster as the rain thickens, and so does the tune. */
function setBuzzRate(speed: number): void {
  noteLength = BASE_NOTE_S * (3 / Math.max(3, speed)) ** 0.35;
}

function noteHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

function scheduleNote(midi: number, at: number): void {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  const filter = audioCtx.createBiquadFilter();
  // Sawtooth through a lowpass is the cheapest thing that reads as "buzz"
  // rather than "beep".
  osc.type = "sawtooth";
  osc.frequency.value = noteHz(midi);
  filter.type = "lowpass";
  filter.frequency.value = 1400;
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(0.09, at + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + noteLength * 0.95);
  osc.connect(filter).connect(gain).connect(audioCtx.destination);
  osc.start(at);
  osc.stop(at + noteLength);
}

function pump(): void {
  if (!audioCtx) return;
  while (noteAt < audioCtx.currentTime + 0.25) {
    scheduleNote(PHRASE[noteIndex % PHRASE.length] ?? 69, noteAt);
    noteAt += noteLength;
    noteIndex += 1;
  }
  window.setTimeout(pump, 60);
}

/** Browsers refuse to start audio without a gesture, so this runs on the
 *  first real input rather than on load. */
function startMusic(): void {
  if (audioCtx || !musicOn) return;
  audioCtx = new AudioContext();
  noteAt = audioCtx.currentTime + 0.08;
  pump();
}

function toggleMusic(): void {
  musicOn = !musicOn;
  if (!audioCtx) {
    if (musicOn) startMusic();
    return;
  }
  if (musicOn) void audioCtx.resume();
  else void audioCtx.suspend();
}

function laneCenter(lane: Lane): number {
  return lane * LANE_W + LANE_W / 2;
}

let playerLane: Lane = 1;
let playerX = laneCenter(playerLane);
let score = 0;
let best = 0;
let honey = MAX_HONEY;
let flowers = 0;
let stunned = 0;
let clock = 0;
type Drop = { row: Row; y: number; scored: boolean; flower: Lane | null; taken: boolean };
let rows: Drop[] = [];
let spawnAccumulator = -START_GRACE_PX;
let lastTime = 0;
let gameOver = false;

function resetGame(): void {
  playerLane = 1;
  playerX = laneCenter(playerLane);
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

function update(dt: number): void {
  clock += dt;
  if (stunned > 0) stunned = Math.max(0, stunned - dt);

  const speed = speedForScore(score) * SPEED_SCALE;
  setBuzzRate(speedForScore(score));
  spawnAccumulator += dt * speed;
  if (spawnAccumulator >= ROW_SPACING_PX) {
    spawnAccumulator -= ROW_SPACING_PX;
    const row = generateRow(Math.random, difficultyForScore(score));
    rows.push({ row, y: -ROW_H, scored: false, flower: generateFlower(Math.random, row), taken: false });
  }
  for (const r of rows) {
    r.y += speed * dt;

    // The flower is picked up on the way past, a little before the rain in the
    // same row reaches the bee.
    if (!r.taken && r.flower !== null && r.flower === playerLane && r.y >= PLAYER_Y - ROW_H) {
      r.taken = true;
      flowers += 1;
      score += FLOWER_POINTS;
      if (flowers % FLOWERS_PER_HONEY === 0) {
        const refilled = honeyAfterRefill(honey);
        if (refilled !== honey) {
          honey = refilled;
          live.textContent = `Honey restored. ${honey} left.`;
        }
      }
    }

    if (!r.scored && r.y >= PLAYER_Y - ROW_H / 2) {
      r.scored = true;
      if (isCollision(playerLane, r.row)) {
        // A hit costs honey rather than the run. Only when the last drop goes
        // does the bee come down.
        if (stunned === 0) {
          honey = honeyAfterHit(honey);
          stunned = STUNNED_S;
          if (isGrounded(honey)) endGame();
          else live.textContent = `Hit. ${honey} honey left.`;
        }
      } else {
        score += 1;
      }
    }
  }
  rows = rows.filter((r) => r.y < WORLD_H + ROW_H);
  playerX += (laneCenter(playerLane) - playerX) * Math.min(1, dt * 14);
}

function drawRaindrop(cx: number, cy: number, h: number): void {
  // A teardrop: round belly, drawn point-up.
  const w = h * 0.42;
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

  // Wings first, so the body sits over them. They blur rather than flap:
  // at a bee's wingbeat that is what you would actually see.
  const flutter = 0.75 + 0.25 * Math.sin(clock * 42);
  ctx.fillStyle = "rgba(232,244,255,0.55)";
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(side * 9, -12, 7, 12 * flutter, side * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = "#f7c948";
  ctx.beginPath();
  ctx.ellipse(0, 0, 17, 13, 0, 0, Math.PI * 2);
  ctx.fill();

  // Stripes, clipped to the body so they end where it does.
  ctx.save();
  ctx.clip();
  ctx.fillStyle = "#221a08";
  for (const x of [-2, 7]) ctx.fillRect(x, -14, 5, 28);
  ctx.restore();

  ctx.fillStyle = "#221a08";
  ctx.beginPath();
  ctx.arc(-13, 0, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#221a08";
  ctx.lineWidth = 1.4;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(-16, side * 3);
    ctx.quadraticCurveTo(-23, side * 8, -25, side * 4);
    ctx.stroke();
  }
  ctx.restore();
}

function drawHoney(cx: number, cy: number, full: boolean): void {
  ctx.fillStyle = full ? "#ffb31a" : "rgba(255,179,26,0.22)";
  drawRaindrop(cx, cy, 17);
}

function render(): void {
  ctx.clearRect(0, 0, WORLD_W, WORLD_H);

  const sky = ctx.createLinearGradient(0, 0, 0, WORLD_H);
  sky.addColorStop(0, "#5b7fa6");
  sky.addColorStop(1, "#9db8cc");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);

  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  for (let i = 1; i < LANE_COUNT; i++) {
    ctx.beginPath();
    ctx.moveTo(i * LANE_W, 0);
    ctx.lineTo(i * LANE_W, WORLD_H);
    ctx.stroke();
  }

  for (const r of rows) {
    if (r.flower !== null && !r.taken) {
      drawFlower(laneCenter(r.flower), r.y + ROW_H / 2, 15);
    }
    for (const lane of r.row.blocked) {
      const cx = laneCenter(lane);
      const cy = r.y + ROW_H / 2;
      ctx.fillStyle = "rgba(255,255,255,0.30)";
      drawRaindrop(cx, cy - 20, 22);
      ctx.fillStyle = "#3d6fa8";
      drawRaindrop(cx, cy, ROW_H - 12);
      ctx.fillStyle = "rgba(255,255,255,0.45)";
      ctx.beginPath();
      ctx.ellipse(cx - 4, cy + 4, 3, 5, -0.3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // A stunned bee flickers, which is also the only thing telling you the next
  // raindrop cannot hurt you yet.
  // `clock` stops advancing once the run ends, so the flicker freezes wherever
  // it happened to be --- half the time, with the bee hidden. The grounded bee
  // is the whole picture at that point, so it always shows.
  const visible = gameOver || stunned === 0 || Math.floor(clock * 14) % 2 === 0;
  if (visible) {
    const tilt = (laneCenter(playerLane) - playerX) * -0.012;
    drawBee(playerX, PLAYER_Y, gameOver ? 1.4 : tilt);
  }

  ctx.fillStyle = "#12233a";
  ctx.font = "600 20px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(`${score}`, 14, 32);

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
  const rect = canvas.getBoundingClientRect();
  const relX = (e.clientX - rect.left) / rect.width;
  move(relX < 0.5 ? -1 : 1);
});

requestAnimationFrame(frame);
