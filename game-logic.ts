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

/** Flowers gathered before the hive gives a drop of honey back. */
export const FLOWERS_PER_HONEY = 5;

/** Points a flower is worth, against 1 for surviving a row of rain. */
export const FLOWER_POINTS = 5;

/**
 * Where a flower blooms in a row of rain, if one does. Only ever in a lane the
 * rain leaves open --- a flower under a raindrop would be asking the player to
 * choose between the two things the game rewards, which is a different (and
 * meaner) game than this one.
 */
export function generateFlower(random: () => number, row: Row): Lane | null {
  const open = ([0, 1, 2] as Lane[]).filter((lane) => !row.blocked.includes(lane));
  if (open.length === 0) return null;
  if (random() > 0.45) return null;
  return open[Math.floor(random() * open.length)] ?? null;
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
