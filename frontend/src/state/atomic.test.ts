import { describe, expect, it } from "vitest";
import { historyReducer, initialAtomicState, type History } from "./atomic";
import { measure } from "../components/SliceView";

describe("atomic state", () => {
  it("keeps quantum numbers valid", () => {
    let h: History = { past: [], present: initialAtomicState, future: [] };
    h = historyReducer(h, { type: "set", patch: { n: 3, l: 2, m: -2 } });
    h = historyReducer(h, { type: "set", patch: { n: 2 } });
    expect([h.present.n, h.present.l, h.present.m]).toEqual([2, 1, -1]);
  });

  it("undo and redo", () => {
    let h: History = { past: [], present: initialAtomicState, future: [] };
    h = historyReducer(h, { type: "set", patch: { symbol: "C" } });
    h = historyReducer(h, { type: "set", patch: { symbol: "N" } });
    h = historyReducer(h, { type: "undo" });
    expect(h.present.symbol).toBe("C");
    h = historyReducer(h, { type: "redo" });
    expect(h.present.symbol).toBe("N");
  });
});

describe("measurement", () => {
  it("distances and angles in model coordinates", () => {
    const r = measure([
      [100, 0],
      [0, 0],
      [0, 50],
    ]);
    expect(r.distances).toEqual([100, Math.hypot(0, 50)]);
    expect(r.angleDeg).toBeCloseTo(90);
  });
});
