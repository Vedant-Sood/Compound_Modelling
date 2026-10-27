import { describe, expect, it } from "vitest";
import { geometry, toXYZ } from "./MolecularBuilder";

describe("molecular geometry helpers", () => {
  it("distance, angle and dihedral", () => {
    expect(geometry.dist([0, 0, 0], [3, 4, 0])).toBe(5);
    expect(geometry.angleDeg([1, 0, 0], [0, 0, 0], [0, 1, 0])).toBeCloseTo(90);
    expect(Math.abs(geometry.dihedralDeg([0, 0, 0], [1, 0, 0], [1, 1, 0], [1, 1, 1]))).toBeCloseTo(90);
  });

  it("writes XYZ", () => {
    const txt = toXYZ({ atoms: [{ symbol: "H", xyz: [0, 0, 0] }, { symbol: "H", xyz: [0, 0, 0.74] }], bonds: [], charge: 0, multiplicity: 1 }, "H2");
    expect(txt.split("\n").slice(0, 4)).toEqual(["2", "H2", "H 0.000000 0.000000 0.000000", "H 0.000000 0.000000 0.740000"]);
  });
});
