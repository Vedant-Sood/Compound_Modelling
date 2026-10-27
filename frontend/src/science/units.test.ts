import { describe, expect, it } from "vitest";
import { bestUnit, formatLength, niceScaleBar, representationLevel } from "./units";
import { enclosedThreshold } from "./threshold";

describe("units", () => {
  it("chooses readable units", () => {
    expect(bestUnit(0.0012).unit).toBe("fm");
    expect(bestUnit(52.9).unit).toBe("pm");
    expect(bestUnit(154).unit).toBe("Å");
    expect(bestUnit(3.6e3).unit).toBe("nm");
    expect(bestUnit(2e6).unit).toBe("µm");
    expect(formatLength(154)).toBe("1.54 Å");
    expect(formatLength(0.0084)).toBe("8.4 fm");
  });

  it("scale bar is a 1-2-5 length that fits", () => {
    const bar = niceScaleBar(1.3, 140);
    expect(bar.pm).toBe(100);
    expect(bar.px).toBeCloseTo(100 / 1.3);
    expect(bar.label).toBe("1 Å");
    const tiny = niceScaleBar(1e-5, 140);
    expect(tiny.pm).toBeCloseTo(1e-3);
    expect(tiny.label).toBe("1 fm");
  });

  it("labels representation changes", () => {
    expect(representationLevel(0.01).level).toMatch(/Nuclear/);
    expect(representationLevel(500).level).toMatch(/Atomic/);
    expect(representationLevel(1e6).level).toMatch(/Beyond/);
  });
});

describe("enclosed threshold", () => {
  it("finds the cut holding the requested share", () => {
    const d = new Float32Array([4, 3, 2, 1]); // total 10
    expect(enclosedThreshold(d, 0.4)).toBe(4);
    expect(enclosedThreshold(d, 0.7)).toBe(3);
    expect(enclosedThreshold(d, 0.95)).toBe(1);
  });
});

import { writeCube } from "./cube";

describe("cube export", () => {
  it("writes header in bohr and z-fastest data", () => {
    const vals = new Float32Array([0, 1, 2, 3, 4, 5, 6, 7]); // x-fastest 2x2x2
    const txt = writeCube("test", vals, [2, 2, 2], [-52.917721, 0, 0], 52.917721, [{ Z: 1, positionPm: [0, 0, 0] }]);
    const lines = txt.trim().split("\n");
    expect(lines[2]).toMatch(/^\s+1\s+-1\.000000\s+0\.000000\s+0\.000000$/);
    expect(lines[3]).toMatch(/^\s+2\s+1\.000000/);
    // first data row: x=0,y=0, z=0..1 -> indices 0 and 4
    expect(lines[7].split(" ").map(Number)).toEqual([0, 4]);
  });
});
