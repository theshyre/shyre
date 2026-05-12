import { describe, it, expect } from "vitest";
import { render, act } from "@testing-library/react";
import { useRef, useEffect } from "react";
import { useDropdownPlacement } from "./use-dropdown-placement";

/**
 * Probe that exposes the hook's return value to the test.
 */
interface ProbeProps {
  open: boolean;
  estimatedMenuHeight?: number;
  rect: { top: number; bottom: number };
  onPlacement: (p: "top" | "bottom") => void;
  innerHeight?: number;
}

function Probe({
  open,
  estimatedMenuHeight,
  rect,
  onPlacement,
  innerHeight,
}: ProbeProps): React.JSX.Element {
  const triggerRef = useRef<HTMLDivElement | null>(null);

  // Override the ref element's getBoundingClientRect to return the
  // fixture rect (DOM doesn't have layout in jsdom). Also override
  // window.innerHeight if provided.
  useEffect(() => {
    if (triggerRef.current) {
      triggerRef.current.getBoundingClientRect = () =>
        ({
          top: rect.top,
          bottom: rect.bottom,
          left: 0,
          right: 0,
          width: 0,
          height: rect.bottom - rect.top,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }) as DOMRect;
    }
    if (innerHeight !== undefined) {
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: innerHeight,
      });
    }
  });

  const placement = useDropdownPlacement({
    triggerRef,
    open,
    estimatedMenuHeight,
  });

  useEffect(() => {
    onPlacement(placement);
  }, [placement, onPlacement]);

  return <div ref={triggerRef} />;
}

describe("useDropdownPlacement", () => {
  it("defaults to 'bottom' when closed (doesn't compute)", () => {
    let captured: "top" | "bottom" | null = null;
    render(
      <Probe
        open={false}
        rect={{ top: 100, bottom: 130 }}
        innerHeight={800}
        onPlacement={(p) => {
          captured = p;
        }}
      />,
    );
    expect(captured).toBe("bottom");
  });

  it("returns 'bottom' when there's enough room below", () => {
    let captured: "top" | "bottom" | null = null;
    render(
      <Probe
        open
        rect={{ top: 100, bottom: 130 }}
        innerHeight={800}
        estimatedMenuHeight={320}
        onPlacement={(p) => {
          captured = p;
        }}
      />,
    );
    expect(captured).toBe("bottom");
  });

  it("returns 'top' when room below is insufficient AND room above is greater", () => {
    let captured: "top" | "bottom" | null = null;
    render(
      <Probe
        open
        rect={{ top: 650, bottom: 680 }}
        innerHeight={800}
        estimatedMenuHeight={320}
        onPlacement={(p) => {
          captured = p;
        }}
      />,
    );
    // spaceBelow = 800 - 680 = 120; spaceAbove = 650; menu = 320.
    // Insufficient below AND more above → 'top'.
    expect(captured).toBe("top");
  });

  it("stays 'bottom' when room below is insufficient but room above is even smaller (no good option, pick bottom)", () => {
    let captured: "top" | "bottom" | null = null;
    render(
      <Probe
        open
        rect={{ top: 50, bottom: 600 }}
        innerHeight={800}
        estimatedMenuHeight={320}
        onPlacement={(p) => {
          captured = p;
        }}
      />,
    );
    // spaceBelow = 200; spaceAbove = 50; below < menu BUT spaceAbove
    // (50) is NOT > spaceBelow (200) → keep 'bottom'.
    expect(captured).toBe("bottom");
  });

  it("recomputes on window resize", () => {
    let captured: "top" | "bottom" | null = null;
    render(
      <Probe
        open
        rect={{ top: 100, bottom: 130 }}
        innerHeight={800}
        estimatedMenuHeight={320}
        onPlacement={(p) => {
          captured = p;
        }}
      />,
    );
    expect(captured).toBe("bottom");
    // Shrink the viewport so there's no longer room below.
    act(() => {
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: 200,
      });
      window.dispatchEvent(new Event("resize"));
    });
    expect(captured).toBe("top");
  });
});
