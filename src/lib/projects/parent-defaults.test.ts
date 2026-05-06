import { describe, it, expect } from "vitest";
import {
  applyParentDefaults,
  readParentInheritableFields,
  type InheritableFormValues,
  type InheritableTouched,
  type ParentInheritableFields,
} from "./parent-defaults";

const PARENT: ParentInheritableFields = {
  hourly_rate: 250,
  default_billable: true,
  github_repo: "acme/engagement",
  jira_project_key: "ENG",
  invoice_code: "ENG-2026",
  category_set_id: "set-software",
  require_timestamps: true,
};

const EMPTY_FORM: InheritableFormValues = {
  hourly_rate: "",
  github_repo: "",
  invoice_code: "",
  category_set_id: "",
  default_billable: true,
  require_timestamps: false,
};

const NO_TOUCHES: InheritableTouched = {
  hourly_rate: false,
  github_repo: false,
  invoice_code: false,
  category_set_id: false,
  default_billable: false,
  require_timestamps: false,
};

describe("readParentInheritableFields", () => {
  it("returns null for a null parent", () => {
    expect(readParentInheritableFields(null)).toBeNull();
  });

  it("passes through a fully-populated parent verbatim", () => {
    expect(
      readParentInheritableFields({
        hourly_rate: 250,
        default_billable: true,
        github_repo: "acme/engagement",
        jira_project_key: "ENG",
        invoice_code: "ENG-2026",
        category_set_id: "set-software",
        require_timestamps: true,
      }),
    ).toEqual({
      hourly_rate: 250,
      default_billable: true,
      github_repo: "acme/engagement",
      jira_project_key: "ENG",
      invoice_code: "ENG-2026",
      category_set_id: "set-software",
      require_timestamps: true,
    });
  });

  it("coerces a numeric-string hourly_rate (Supabase numeric → string round-trip) into a number", () => {
    const result = readParentInheritableFields({
      hourly_rate: "175.50" as unknown as number,
      default_billable: true,
      github_repo: null,
      jira_project_key: null,
      invoice_code: null,
      category_set_id: null,
      require_timestamps: false,
    });
    expect(result?.hourly_rate).toBe(175.5);
  });

  it("preserves null hourly_rate (parent has no rate set) — child stays null and the rollup falls back at display time", () => {
    const result = readParentInheritableFields({
      hourly_rate: null,
      default_billable: true,
      github_repo: null,
      jira_project_key: null,
      invoice_code: null,
      category_set_id: null,
      require_timestamps: false,
    });
    expect(result?.hourly_rate).toBeNull();
  });

  it("defaults boolean columns to false when the parent row carries null (matches form unset behavior)", () => {
    const result = readParentInheritableFields({
      hourly_rate: null,
      default_billable: null,
      github_repo: null,
      jira_project_key: null,
      invoice_code: null,
      category_set_id: null,
      require_timestamps: null,
    });
    expect(result?.default_billable).toBe(false);
    expect(result?.require_timestamps).toBe(false);
  });

  it("normalises undefined optional columns (Supabase omits null fields when not selected) to null/false", () => {
    const result = readParentInheritableFields({});
    expect(result).toEqual({
      hourly_rate: null,
      default_billable: false,
      github_repo: null,
      jira_project_key: null,
      invoice_code: null,
      category_set_id: null,
      require_timestamps: false,
    });
  });
});

describe("applyParentDefaults", () => {
  it("fills every untouched field from the parent on a fresh form", () => {
    const { values, appliedAny } = applyParentDefaults(
      PARENT,
      EMPTY_FORM,
      NO_TOUCHES,
    );
    expect(values).toEqual({
      hourly_rate: "250",
      github_repo: "acme/engagement",
      invoice_code: "ENG-2026",
      category_set_id: "set-software",
      default_billable: true,
      require_timestamps: true,
    });
    expect(appliedAny).toBe(true);
  });

  it("keeps a touched hourly_rate verbatim — user's typed value wins over parent", () => {
    const { values } = applyParentDefaults(
      PARENT,
      { ...EMPTY_FORM, hourly_rate: "175" },
      { ...NO_TOUCHES, hourly_rate: true },
    );
    expect(values.hourly_rate).toBe("175");
    // Other untouched fields still inherit.
    expect(values.github_repo).toBe("acme/engagement");
    expect(values.invoice_code).toBe("ENG-2026");
  });

  it("keeps a touched checkbox value (even if user un-checked default_billable on purpose)", () => {
    const { values } = applyParentDefaults(
      PARENT,
      { ...EMPTY_FORM, default_billable: false },
      { ...NO_TOUCHES, default_billable: true },
    );
    expect(values.default_billable).toBe(false);
  });

  it("respects every touched flag in one pass without leaking parent values into touched fields", () => {
    const allTouched: InheritableTouched = {
      hourly_rate: true,
      github_repo: true,
      invoice_code: true,
      category_set_id: true,
      default_billable: true,
      require_timestamps: true,
    };
    const userTyped: InheritableFormValues = {
      hourly_rate: "100",
      github_repo: "user/typed",
      invoice_code: "USER",
      category_set_id: "set-user",
      default_billable: false,
      require_timestamps: false,
    };
    const { values, appliedAny } = applyParentDefaults(
      PARENT,
      userTyped,
      allTouched,
    );
    expect(values).toEqual(userTyped);
    expect(appliedAny).toBe(false);
  });

  it("when parent has no values to share, preserves the user's untouched empties (no spurious 'undefined' / 'null' strings)", () => {
    const sparseParent: ParentInheritableFields = {
      hourly_rate: null,
      default_billable: false,
      github_repo: null,
      jira_project_key: null,
      invoice_code: null,
      category_set_id: null,
      require_timestamps: false,
    };
    const { values } = applyParentDefaults(
      sparseParent,
      EMPTY_FORM,
      NO_TOUCHES,
    );
    expect(values.hourly_rate).toBe("");
    expect(values.github_repo).toBe("");
    expect(values.invoice_code).toBe("");
    expect(values.category_set_id).toBe("");
  });

  it("appliedAny is true when only checkbox values changed (booleans always count)", () => {
    const sparseParent: ParentInheritableFields = {
      hourly_rate: null,
      default_billable: true,
      github_repo: null,
      jira_project_key: null,
      invoice_code: null,
      category_set_id: null,
      require_timestamps: false,
    };
    const { appliedAny } = applyParentDefaults(
      sparseParent,
      EMPTY_FORM,
      NO_TOUCHES,
    );
    expect(appliedAny).toBe(true);
  });

  it("coerces a numeric hourly_rate to a string (form input is a string-typed slot)", () => {
    const { values } = applyParentDefaults(
      { ...PARENT, hourly_rate: 175.5 },
      EMPTY_FORM,
      NO_TOUCHES,
    );
    expect(values.hourly_rate).toBe("175.5");
  });
});
