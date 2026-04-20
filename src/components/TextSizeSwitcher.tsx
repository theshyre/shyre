"use client";

import { useTranslations } from "next-intl";
import { useTextSize, type TextSize } from "./text-size-provider";

const SIZES: TextSize[] = ["compact", "regular", "large"];

// Per-button font size so the A visually scales even at regular root size.
// Kept as literal px so the previewed sizing stays legible regardless of
// the user's current text-size setting.
const PREVIEW_PX: Record<TextSize, string> = {
  compact: "11px",
  regular: "13px",
  large: "15px",
};

interface Props {
  /** Smaller height variant for dense surfaces like the sidebar footer. */
  dense?: boolean;
}

/**
 * Three-button A/A/A text-size control. Used in the sidebar footer and on
 * the profile Appearance section. Each button is icon-free (the letter A
 * is the icon); `aria-label` + `title` provide the text channel for the
 * redundant-encoding rule.
 */
export function TextSizeSwitcher({ dense = false }: Props): React.JSX.Element {
  const t = useTranslations("settings.textSize");
  const { textSize, setTextSize } = useTextSize();

  const sizeClass = dense ? "h-7 w-7" : "h-8 w-8";

  return (
    <div
      role="radiogroup"
      aria-label={t("title")}
      className="inline-flex items-center gap-1"
    >
      {SIZES.map((s) => {
        const isActive = textSize === s;
        return (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={isActive}
            aria-label={t(s)}
            title={t(s)}
            onClick={() => setTextSize(s)}
            className={`${sizeClass} inline-flex items-center justify-center rounded-md font-semibold transition-colors ${
              isActive
                ? "bg-accent text-content-inverse"
                : "border border-edge text-content-secondary hover:bg-hover"
            }`}
            style={{ fontSize: PREVIEW_PX[s] }}
          >
            A
          </button>
        );
      })}
    </div>
  );
}
