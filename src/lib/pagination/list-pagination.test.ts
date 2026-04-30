import { describe, it, expect } from "vitest";
import {
  parseListPagination,
  DEFAULT_LIST_LIMIT,
  MAX_LIST_LIMIT,
} from "./list-pagination";

describe("parseListPagination", () => {
  it("returns the default when no limit param is present", () => {
    expect(parseListPagination({})).toEqual({ limit: DEFAULT_LIST_LIMIT });
  });

  it("returns the default when limit is empty string", () => {
    expect(parseListPagination({ limit: "" })).toEqual({
      limit: DEFAULT_LIST_LIMIT,
    });
  });

  it("respects an explicit defaultLimit override", () => {
    expect(parseListPagination({}, 25)).toEqual({ limit: 25 });
  });

  it("accepts a valid limit string", () => {
    expect(parseListPagination({ limit: "100" })).toEqual({ limit: 100 });
  });

  it("ignores leading/trailing junk via parseInt", () => {
    // parseInt("100abc", 10) === 100 — defensive but acceptable since
    // we clamp below.
    expect(parseListPagination({ limit: "100abc" })).toEqual({ limit: 100 });
  });

  it("falls back to default for non-numeric input", () => {
    expect(parseListPagination({ limit: "abc" })).toEqual({
      limit: DEFAULT_LIST_LIMIT,
    });
  });

  it("falls back to default for negative numbers", () => {
    expect(parseListPagination({ limit: "-5" })).toEqual({
      limit: DEFAULT_LIST_LIMIT,
    });
  });

  it("falls back to default for zero", () => {
    expect(parseListPagination({ limit: "0" })).toEqual({
      limit: DEFAULT_LIST_LIMIT,
    });
  });

  it("clamps values above MAX_LIST_LIMIT", () => {
    expect(parseListPagination({ limit: "999999" })).toEqual({
      limit: MAX_LIST_LIMIT,
    });
  });

  it("accepts the array form (Next 16 hands repeated params as arrays)", () => {
    expect(parseListPagination({ limit: ["100", "200"] })).toEqual({
      limit: 100,
    });
  });

  it("falls back to default when the array is empty", () => {
    expect(parseListPagination({ limit: [] })).toEqual({
      limit: DEFAULT_LIST_LIMIT,
    });
  });
});
