// Pure game rules --- no DOM, no canvas, no timers. Kept separate from
// main.ts so the rule that ends a round can be unit-tested in isolation.

export const LANE_COUNT = 3;
export type Lane = 0 | 1 | 2;

export interface Row {
  /** Lanes this row blocks. Never all of them --- see generateRow. */
  blocked: Lane[];
}

/** A row that blocks every lane would make the game unwinnable no matter
 * what the player does, so generation always leaves at least one lane open. */
export function generateRow(random: () => number, difficulty: number): Row {
  // difficulty 0 → always exactly one blocked lane; difficulty 1 → up to
  // LANE_COUNT - 1 blocked, still always leaving a safe lane.
  const maxBlocked = Math.max(1, Math.min(LANE_COUNT - 1, 1 + Math.floor(difficulty * (LANE_COUNT - 1))));
  const blockedCount = 1 + Math.floor(random() * maxBlocked);
  const lanes: Lane[] = [0, 1, 2];
  const blocked: Lane[] = [];
  for (let i = 0; i < blockedCount; i++) {
    const pick = Math.floor(random() * lanes.length);
    blocked.push(lanes.splice(pick, 1)[0]);
  }
  return { blocked };
}

/** The one rule a round ends on: the player's lane is blocked when a row
 * reaches them. */
export function isCollision(playerLane: Lane, row: Row): boolean {
  return row.blocked.includes(playerLane);
}

export function clampLane(lane: number): Lane {
  return Math.max(0, Math.min(LANE_COUNT - 1, lane)) as Lane;
}

/** Speed (world units/sec) climbs with score, capped so it stays playable. */
export function speedForScore(score: number): number {
  return Math.min(9, 3 + score * 0.08);
}

/** Difficulty (0..1) feeds generateRow's blocked-lane count. */
export function difficultyForScore(score: number): number {
  return Math.min(1, score / 40);
}

// --- the riff: rain, flowers, honey -------------------------------------
// Same three lanes and the same collision rule; what changes is that a hit
// costs you something you can win back, so a run has a shape instead of just
// a length. Kept in this file with the rest of the rules, per the note in
// CLAUDE.md about why game-logic.ts has no DOM in it.

/** How much honey a bee can hold. Also the number of hits a run survives. */
export const MAX_HONEY = 3;

/** What can be sitting in an open lane. Flowers are the tally you are playing
 *  for; honey is the health you spend staying alive long enough to gather
 *  them. Keeping them separate means picking one up is never a wash. */
export type PickupKind = "flower" | "honey" | "shield" | "slow";

export interface Pickup {
  readonly lane: Lane;
  readonly kind: PickupKind;
}

/** How often an open lane has something in it at all, and how much of that is
 *  honey rather than a flower. Honey is the rarer of the two because it is
 *  the one that undoes a mistake. */
const PICKUP_CHANCE = 0.45;
// Shares of that, in order: the rest are flowers. Honey undoes a mistake and
// the powerups prevent one, so both are rarer than the thing you play for.
const HONEY_SHARE = 0.2;
const SHIELD_SHARE = 0.1;
const SLOW_SHARE = 0.08;

/**
 * What is sitting in a row of rain, if anything. Only ever in a lane the rain
 * leaves open --- a pickup under a raindrop would be asking the player to
 * choose between the two things the game rewards, which is a different (and
 * meaner) game than this one.
 */
export function generatePickup(random: () => number, row: Row): Pickup | null {
  const open = ([0, 1, 2] as Lane[]).filter((lane) => !row.blocked.includes(lane));
  if (open.length === 0) return null;
  if (random() > PICKUP_CHANCE) return null;
  const roll = random();
  const kind: PickupKind =
    roll < HONEY_SHARE
      ? "honey"
      : roll < HONEY_SHARE + SHIELD_SHARE
        ? "shield"
        : roll < HONEY_SHARE + SHIELD_SHARE + SLOW_SHARE
          ? "slow"
          : "flower";
  const lane = open[Math.floor(random() * open.length)];
  return lane === undefined ? null : { lane, kind };
}

/** A raindrop hit. Honey never goes below empty. */
export function honeyAfterHit(honey: number): number {
  return Math.max(0, honey - 1);
}

/** The hive tops you up, but never past what a bee can carry. */
export function honeyAfterRefill(honey: number): number {
  return Math.min(MAX_HONEY, honey + 1);
}

/** Out of honey is out of run. */
export function isGrounded(honey: number): boolean {
  return honey <= 0;
}

// --- the second axis: levels, and vines that close across them -----------
// Rain falls down the lanes, so you dodge it sideways. Vines grow in from the
// sides across one level, so you dodge those by climbing or dropping. Neither
// obstacle can be beaten on the other one's axis, which is the whole reason
// for having both.

// Six of them, spanning the whole sky rather than a band near the floor: the
// bee can climb right to the top. That is a real trade rather than free room,
// because rain enters from the top edge and arrives with far less warning up
// there.
export const LEVEL_COUNT = 6;
export type Level = number;

/** At least this many levels stay clear of vines, so there is always
 *  somewhere to go and it is never more than one move away. */
export const MIN_CLEAR_LEVELS = 3;

const LEVELS: Level[] = Array.from({ length: LEVEL_COUNT }, (_, i) => i);

/**
 * How long a vine shows at the edge before it starts growing. The level is
 * reserved for the whole of it, so the warning is a promise: nothing else will
 * take that level, and the bee has a full second to be somewhere else.
 */
export const TELEGRAPH_S = 1;

export interface Vine {
  readonly level: Level;
  readonly side: "left" | "right";
  /** 0 at the edge, 1 fully across the playfield. */
  reach: number;
}

export function clampLevel(level: number): Level {
  return Math.max(0, Math.min(LEVEL_COUNT - 1, level));
}

/**
 * How far a vine has grown at a given point in its life: out, hold, back.
 * Returned as a fraction of the full width, so the caller never deals in
 * pixels and this stays testable.
 */
export function vineReach(age: number, grow: number, hold: number): number {
  if (age <= 0) return 0;
  if (age < grow) return age / grow;
  if (age < grow + hold) return 1;
  const retract = age - grow - hold;
  return Math.max(0, 1 - retract / grow);
}

/**
 * Which levels a new vine may use: never so many that the bee is left with
 * fewer than MIN_CLEAR_LEVELS to fly to. The lane version of this rule
 * ("never block every lane") is per-row and instantaneous; this one has to
 * look at every vine currently on the board, because vines overlap in time.
 */
export function freeLevels(vines: readonly Vine[]): Level[] {
  const taken = new Set(vines.map((vine) => vine.level));
  return LEVELS.filter((level) => !taken.has(level));
}

export function canSpawnVine(vines: readonly Vine[]): boolean {
  return freeLevels(vines).length > MIN_CLEAR_LEVELS;
}

/** A vine on a level that is currently clear, or nothing if none is safe. */
export function generateVine(random: () => number, vines: readonly Vine[]): Vine | null {
  if (!canSpawnVine(vines)) return null;
  const open = freeLevels(vines);
  const level = open[Math.floor(random() * open.length)];
  if (level === undefined) return null;
  return { level, side: random() < 0.5 ? "left" : "right", reach: 0 };
}

/**
 * Does this vine have the bee? `x` and the width are in the same units,
 * whatever they are --- the rule is only about how far across the vine has
 * grown from its own side.
 */
export function vineCatches(vine: Vine, level: Level, x: number, width: number): boolean {
  if (vine.level !== level) return false;
  // A vine that has not grown yet catches nothing, including a bee sitting
  // exactly on the edge it is about to come out of.
  if (vine.reach <= 0) return false;
  const across = vine.reach * width;
  return vine.side === "left" ? x <= across : x >= width - across;
}


// --- wasps and powerups --------------------------------------------------

/** How long each powerup lasts, in seconds. */
export const SHIELD_S = 7;
export const SLOW_S = 5;
/** What the world's speed is multiplied by while syrup is in effect. */
export const SLOW_FACTOR = 0.55;

/**
 * A wasp does not belong to a lane. It weaves across them as it falls, so it
 * is the one threat you cannot answer by thinking in lanes at all --- and the
 * one reason to look at where the bee actually is rather than which column it
 * is in.
 */
export function waspDrift(t: number, phase: number, width: number, margin: number): number {
  const span = Math.max(0, width / 2 - margin);
  return width / 2 + Math.sin(t * 1.7 + phase) * span;
}

/** Two circles touching. The wasp's collision is positional, not lane-based,
 *  which is the whole point of it. */
export function overlaps(
  ax: number,
  ay: number,
  ar: number,
  bx: number,
  by: number,
  br: number,
): boolean {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy <= (ar + br) * (ar + br);
}

/** A shield spends itself stopping one hit; everything else gets through. */
export function absorbs(shieldUntil: number, now: number): boolean {
  return shieldUntil > now;
}
