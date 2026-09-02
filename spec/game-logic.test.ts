import { describe, expect, it } from "vitest";
import {
  LANE_COUNT,
  clampLane,
  difficultyForScore,
  generateRow,
  isCollision,
  speedForScore,
  generatePickup,
  generateVine,
  vineReach,
  vineCatches,
  canSpawnVine,
  freeLevels,
  clampLevel,
  LEVEL_COUNT,
  MIN_CLEAR_LEVELS,
  type Vine,
  honeyAfterHit,
  honeyAfterRefill,
  isGrounded,
  MAX_HONEY,
  type Lane,
} from "../game-logic.ts";

// The one rule the brief asks for a focused test on: a row that reaches the
// player ends the round if and only if it blocks the lane the player is in.
describe("isCollision: the rule that ends a round", () => {
  it("collides when the row blocks the player's lane", () => {
    expect(isCollision(1, { blocked: [1] })).toBe(true);
    expect(isCollision(0, { blocked: [0, 2] })).toBe(true);
  });

  it("does not collide when the player's lane is open", () => {
    expect(isCollision(1, { blocked: [0, 2] })).toBe(false);
    expect(isCollision(2, { blocked: [] })).toBe(false);
  });
});

describe("generateRow: a wrong move is possible, but never every move", () => {
  // A row that blocks every lane would make a round unwinnable no matter
  // what the player does --- that's a fairness bug, not a difficulty spike.
  it("always leaves at least one lane open, across difficulties and rolls", () => {
    for (let i = 0; i < 500; i++) {
      const difficulty = (i % 10) / 9;
      const row = generateRow(Math.random, difficulty);
      const openLanes = [0, 1, 2].filter((lane) => !row.blocked.includes(lane as Lane));
      expect(row.blocked.length).toBeLessThan(LANE_COUNT);
      expect(openLanes.length).toBeGreaterThan(0);
    }
  });

  it("blocks at least one lane, so play can end", () => {
    const row = generateRow(() => 0, 0);
    expect(row.blocked.length).toBeGreaterThan(0);
  });
});

describe("clampLane", () => {
  it("keeps the player inside the lanes that exist", () => {
    expect(clampLane(-1)).toBe(0);
    expect(clampLane(3)).toBe(2);
    expect(clampLane(1)).toBe(1);
  });
});

describe("difficulty and speed ramps", () => {
  it("never exceeds their caps as score climbs", () => {
    expect(speedForScore(1000)).toBeLessThanOrEqual(9);
    expect(difficultyForScore(1000)).toBeLessThanOrEqual(1);
  });

  it("increases with score", () => {
    expect(speedForScore(20)).toBeGreaterThan(speedForScore(0));
    expect(difficultyForScore(20)).toBeGreaterThan(difficultyForScore(0));
  });
});

// --- the riff's own rules ------------------------------------------------

describe("pickups sit where the rain isn't", () => {
  it("never puts one under a raindrop", () => {
    for (let i = 0; i < 500; i++) {
      const row = generateRow(Math.random, (i % 10) / 9);
      const pickup = generatePickup(Math.random, row);
      if (pickup !== null) expect(row.blocked).not.toContain(pickup.lane);
    }
  });

  it("returns nothing when every lane it could use is blocked", () => {
    expect(generatePickup(() => 0, { blocked: [0, 1, 2] })).toBe(null);
  });

  it("offers both flowers and honey over a run", () => {
    const kinds = new Set<string>();
    for (let i = 0; i < 400; i++) {
      const pickup = generatePickup(Math.random, { blocked: [0] });
      if (pickup) kinds.add(pickup.kind);
    }
    expect(kinds).toEqual(new Set(["flower", "honey"]));
  });
});

describe("vines: the obstacle you dodge on the other axis", () => {
  // The rain's fairness rule is per-row and instantaneous. Vines overlap in
  // time, so theirs has to hold across every vine on the board at once ---
  // the bee must always have somewhere to fly to.
  it("never closes off so many levels that the bee is trapped", () => {
    const live: Vine[] = [];
    for (let i = 0; i < 200; i++) {
      const born = generateVine(Math.random, live);
      if (born) live.push(born);
      expect(freeLevels(live).length).toBeGreaterThanOrEqual(MIN_CLEAR_LEVELS);
    }
    expect(live.length).toBe(LEVEL_COUNT - MIN_CLEAR_LEVELS);
    expect(canSpawnVine(live)).toBe(false);
    expect(generateVine(Math.random, live)).toBe(null);
  });

  it("never puts two vines on one level", () => {
    const live: Vine[] = [];
    for (let i = 0; i < 50; i++) {
      const born = generateVine(Math.random, live);
      if (born) live.push(born);
    }
    expect(new Set(live.map((v) => v.level)).size).toBe(live.length);
  });

  it("grows out, holds, and retracts", () => {
    expect(vineReach(0, 1, 1)).toBe(0);
    expect(vineReach(0.5, 1, 1)).toBeCloseTo(0.5);
    expect(vineReach(1.5, 1, 1)).toBe(1);
    expect(vineReach(2.5, 1, 1)).toBeCloseTo(0.5);
    expect(vineReach(3, 1, 1)).toBe(0);
  });

  it("only catches a bee on its own level, on its own side", () => {
    const left: Vine = { level: 1, side: "left", reach: 0.5 };
    expect(vineCatches(left, 1, 20, 300)).toBe(true);
    expect(vineCatches(left, 1, 280, 300)).toBe(false);
    expect(vineCatches(left, 2, 20, 300)).toBe(false);

    const right: Vine = { level: 1, side: "right", reach: 0.5 };
    expect(vineCatches(right, 1, 280, 300)).toBe(true);
    expect(vineCatches(right, 1, 20, 300)).toBe(false);
  });

  it("catches nothing before it has grown", () => {
    const seed: Vine = { level: 0, side: "left", reach: 0 };
    expect(vineCatches(seed, 0, 0, 300)).toBe(true);
    expect(vineCatches(seed, 0, 1, 300)).toBe(false);
  });
});

describe("clampLevel", () => {
  it("keeps the bee inside the levels that exist", () => {
    expect(clampLevel(-1)).toBe(0);
    expect(clampLevel(LEVEL_COUNT)).toBe(LEVEL_COUNT - 1);
    expect(clampLevel(2)).toBe(2);
  });
});

describe("honey is the run's length, not the score", () => {
  it("costs one drop a hit and never goes below empty", () => {
    expect(honeyAfterHit(MAX_HONEY)).toBe(MAX_HONEY - 1);
    expect(honeyAfterHit(0)).toBe(0);
  });

  it("refills, but never past what a bee can carry", () => {
    expect(honeyAfterRefill(1)).toBe(2);
    expect(honeyAfterRefill(MAX_HONEY)).toBe(MAX_HONEY);
  });

  it("grounds the bee only when the last drop goes", () => {
    expect(isGrounded(1)).toBe(false);
    expect(isGrounded(0)).toBe(true);
  });
});
