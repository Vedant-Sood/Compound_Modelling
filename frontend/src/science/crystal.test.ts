import { describe, expect, it } from "vitest";
import { boxEdges, formulaFromComposition, fracToCart, millerPlanePolygons, parseBasis } from "./crystal";

describe("crystal geometry", () => {
  it("unit box has 12 edges", () => {
    expect(boxEdges([1, 1, 1])).toHaveLength(12);
    expect(boxEdges([2, 1, 3]).every(([a, b]) => a.filter((x, i) => x !== b[i]).length === 1)).toBe(true);
  });

  it("fractional to Cartesian uses rows as lattice vectors", () => {
    const hex = [[2, 0, 0], [-1, Math.sqrt(3), 0], [0, 0, 5]];
    expect(fracToCart([1, 1, 0], hex).map((x) => +x.toFixed(6))).toEqual([1, 1.732051, 0]);
  });

  it("Miller planes cut the unit cell correctly", () => {
    const p100 = millerPlanePolygons([1, 0, 0]);
    expect(p100).toHaveLength(2); // x = 0 and x = 1 faces
    expect(p100[0]).toHaveLength(4);
    const p111 = millerPlanePolygons([1, 1, 1]);
    // h+k+l = 1 and 2 are triangles; 0 and 3 touch only a corner
    expect(p111.map((p) => p.length).sort()).toEqual([3, 3]);
    expect(millerPlanePolygons([2, 0, 0])).toHaveLength(3);
    expect(millerPlanePolygons([0, 0, 0])).toEqual([]);
    for (const poly of millerPlanePolygons([1, 1, 0], [2, 2, 1])) for (const v of poly) expect(Math.abs(v[0] + v[1] - Math.round(v[0] + v[1]))).toBeLessThan(1e-9);
  });

  it("formula reduces by the gcd", () => {
    expect(formulaFromComposition({ Na: 4, Cl: 4 })).toBe("NaCl");
    expect(formulaFromComposition({ Ca: 4, F: 8 })).toBe("CaF2");
    expect(formulaFromComposition({ Na: 31, Cl: 32 })).toBe("Na31Cl32");
  });

  it("parses a basis", () => {
    expect(parseBasis("Na 0 0 0\n# comment\nCl 0.5 0.5 0.5")).toEqual({ species: ["Na", "Cl"], frac: [[0, 0, 0], [0.5, 0.5, 0.5]] });
    expect(() => parseBasis("Na 0 0")).toThrow();
  });
});
