import { describe, it, expect, vi } from "vitest";
import { renderWithIntl } from "@/test/intl";

const keyboardHelpMock = vi.fn();
vi.mock("@theshyre/ui", () => ({
  KeyboardHelp: (props: {
    groups: Array<{ title: string; shortcuts: Array<{ keys: string }> }>;
    title: string;
  }) => {
    keyboardHelpMock(props);
    return <div data-testid="kh">{props.title}</div>;
  },
}));

import { GlobalKeyboardHelp } from "./GlobalKeyboardHelp";

describe("GlobalKeyboardHelp", () => {
  it("renders the @theshyre/ui KeyboardHelp with three groups (global / time / forms)", () => {
    renderWithIntl(<GlobalKeyboardHelp />);
    expect(keyboardHelpMock).toHaveBeenCalledTimes(1);
    const props = keyboardHelpMock.mock.calls[0]?.[0] as {
      title: string;
      groups: Array<{ title: string; shortcuts: Array<{ keys: string }> }>;
    };
    expect(props.groups).toHaveLength(3);
  });

  it("the 'time' group includes Space (start/stop timer)", () => {
    renderWithIntl(<GlobalKeyboardHelp />);
    const props = keyboardHelpMock.mock.calls[0]?.[0] as {
      groups: Array<{ shortcuts: Array<{ keys: string }> }>;
    };
    // Find the group whose shortcuts include Space.
    const hasSpace = props.groups.some((g) =>
      g.shortcuts.some((s) => s.keys === "Space"),
    );
    expect(hasSpace).toBe(true);
  });

  it("the 'global' group includes ⌘K (command palette)", () => {
    renderWithIntl(<GlobalKeyboardHelp />);
    const props = keyboardHelpMock.mock.calls[0]?.[0] as {
      groups: Array<{ shortcuts: Array<{ keys: string }> }>;
    };
    const hasCmdK = props.groups.some((g) =>
      g.shortcuts.some((s) => s.keys === "⌘K"),
    );
    expect(hasCmdK).toBe(true);
  });

  it("passes a localized title to KeyboardHelp", () => {
    renderWithIntl(<GlobalKeyboardHelp />);
    const props = keyboardHelpMock.mock.calls[0]?.[0] as { title: string };
    // i18n key is `common.keyboardHelp.title` → "Keyboard Shortcuts" in en.
    expect(props.title).toBe("Keyboard Shortcuts");
  });
});
