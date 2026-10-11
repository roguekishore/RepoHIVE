import { describe, expect, it } from "vitest";
import { commonNamePrefix, levelName, shortName } from "./names";

describe("commonNamePrefix", () => {
  it("finds the whole dotted segments every name shares", () => {
    const names = ["org.acme.core.order", "org.acme.common.util", "org.acme.core.catalog"];
    expect(commonNamePrefix(names)).toBe("org.acme.");
  });

  it("does not cut inside a segment", () => {
    expect(commonNamePrefix(["org.acme.core", "org.acmeish.core"])).toBe("org.");
  });

  it("is empty for no names, no shared segment, or one name", () => {
    expect(commonNamePrefix([])).toBe("");
    expect(commonNamePrefix(["core.order", "common.util"])).toBe("");
    expect(commonNamePrefix(["org.acme.core"])).toBe("org.acme.");
  });

  it("leaves every name at least one segment", () => {
    expect(commonNamePrefix(["org.acme", "org.acme.core"])).toBe("org.");
  });
});

describe("shortName", () => {
  it("strips the prefix and leaves other names alone", () => {
    expect(shortName("org.acme.core.order", "org.acme.")).toBe("core.order");
    expect(shortName("other.name", "org.acme.")).toBe("other.name");
    expect(shortName("any", "")).toBe("any");
  });
});

describe("levelName", () => {
  it("names the levels of a seven-level hierarchy and numbers any other", () => {
    expect(levelName(2, 7)).toBe("Groups");
    expect(levelName(2, 3)).toBe("Level 2");
  });
});
