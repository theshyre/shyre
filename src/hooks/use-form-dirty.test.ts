import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRef, useEffect } from "react";
import { useFormDirty } from "./use-form-dirty";

function setup(initialFormHtml: string) {
  return renderHook(() => {
    const ref = useRef<HTMLFormElement>(null);
    // Mount the form into the DOM through the ref. Doing this in an
    // effect after first render mirrors how callers wire it up
    // (formRef → <form>).
    useEffect(() => {
      const wrapper = document.createElement("div");
      wrapper.innerHTML = initialFormHtml;
      const form = wrapper.firstElementChild as HTMLFormElement;
      document.body.appendChild(form);
      // Cast through unknown — the ref is typed read-only by React
      // but for this test harness we wire it manually.
      (ref as unknown as { current: HTMLFormElement }).current = form;
      return () => {
        form.remove();
      };
    }, []);
    return { dirty: useFormDirty(ref), ref };
  });
}

describe("useFormDirty", () => {
  it("starts clean", () => {
    const { result } = setup(
      `<form><input name="description" value="hello" /></form>`,
    );
    expect(result.current.dirty).toBe(false);
  });

  it("marks dirty when a text input changes", () => {
    const { result } = setup(
      `<form><input name="description" value="hello" /></form>`,
    );
    const input = document.querySelector<HTMLInputElement>(
      "input[name='description']",
    )!;
    act(() => {
      input.value = "world";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(result.current.dirty).toBe(true);
  });

  it("returns to clean when the input is reverted", () => {
    const { result } = setup(
      `<form><input name="description" value="hello" /></form>`,
    );
    const input = document.querySelector<HTMLInputElement>(
      "input[name='description']",
    )!;
    act(() => {
      input.value = "world";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(result.current.dirty).toBe(true);
    act(() => {
      input.value = "hello";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(result.current.dirty).toBe(false);
  });

  it("tracks checkbox changes", () => {
    const { result } = setup(
      `<form><input type="checkbox" name="billable" /></form>`,
    );
    const cb = document.querySelector<HTMLInputElement>(
      "input[name='billable']",
    )!;
    act(() => {
      cb.checked = true;
      cb.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(result.current.dirty).toBe(true);
  });

  it("ignores fields without a name", () => {
    const { result } = setup(
      `<form>
        <input value="anonymous" />
        <input name="description" value="hello" />
      </form>`,
    );
    const inputs = document.querySelectorAll<HTMLInputElement>("input");
    act(() => {
      inputs[0]!.value = "still anonymous";
      inputs[0]!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(result.current.dirty).toBe(false);
  });
});
