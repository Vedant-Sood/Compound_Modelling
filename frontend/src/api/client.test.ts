import { describe, expect, it } from "vitest";
import { api, jobPath } from "./client";

describe("job ids from opened files", () => {
  it("accepts the 24-hex ids the backend issues", () => {
    expect(jobPath("0123456789abcdef01234567", "/esp")).toBe("/api/jobs/0123456789abcdef01234567/esp");
  });
  it("rejects ids that would change the request path", async () => {
    for (const bad of ["../molecule/examples", "abc", "0123456789abcdef01234567/../x", ""]) {
      expect(() => jobPath(bad)).toThrow();
      await expect(api.job(bad)).rejects.toThrow("invalid job id");
    }
  });
});
