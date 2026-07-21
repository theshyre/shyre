import { describe, expect, it } from "vitest";
import { entityTypeLabelKey } from "./entity-label";

describe("entityTypeLabelKey", () => {
  it("returns the namespaced key for each recognized entity type", () => {
    expect(entityTypeLabelKey("sole_prop")).toBe("entityTypes.sole_prop");
    expect(entityTypeLabelKey("llc")).toBe("entityTypes.llc");
    expect(entityTypeLabelKey("s_corp")).toBe("entityTypes.s_corp");
    expect(entityTypeLabelKey("c_corp")).toBe("entityTypes.c_corp");
    expect(entityTypeLabelKey("partnership")).toBe("entityTypes.partnership");
    expect(entityTypeLabelKey("nonprofit")).toBe("entityTypes.nonprofit");
    expect(entityTypeLabelKey("other")).toBe("entityTypes.other");
  });

  it("returns null for a null or empty value", () => {
    expect(entityTypeLabelKey(null)).toBeNull();
    expect(entityTypeLabelKey(undefined)).toBeNull();
    expect(entityTypeLabelKey("")).toBeNull();
  });

  it("returns null for an unrecognized value (never a raw enum leak)", () => {
    expect(entityTypeLabelKey("bogus")).toBeNull();
    expect(entityTypeLabelKey("LLC")).toBeNull();
  });
});
