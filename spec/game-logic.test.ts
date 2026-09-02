import { describe, expect, it } from "vitest";
import {
  LANE_COUNT,
  clampLane,
  difficultyForScore,
  generateRow,
  isCollision,
  speedForScore,
  generateFlower,
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

describe("flowers bloom where the rain isn't", () => {
  it("never puts a flower under a raindrop", () => {
    for (let i = 0; i < 500; i++) {
      const row = generateRow(Math.random, (i % 10) / 9);
      const flower = generateFlower(Math.random, row);
      if (flower !== null) expect(row.blocked).not.toContain(flower);
    }
  });

  it("returns nothing when every lane it could use is blocked", () => {
    expect(generateFlower(() => 0, { blocked: [0, 1, 2] })).toBe(null);
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
