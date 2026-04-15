"use client";

import { useEffect } from "react";
import { useTextSize, type TextSize } from "./text-size-provider";

interface Props {
  /**
   * Text size the server read from user_settings.text_size. `null` means the
   * user hasn't picked one — fall back to the localStorage/default path.
   */
  preferredTextSize: TextSize | null;
}

/**
 * One-way DB → TextSizeProvider sync, mirror of ThemeSync. Runs on the
 * dashboard layout so cross-device preference propagates on login.
 */
export function TextSizeSync({ preferredTextSize }: Props): null {
  const { textSize, applyExternalTextSize } = useTextSize();

  useEffect(() => {
    if (preferredTextSize && preferredTextSize !== textSize) {
      applyExternalTextSize(preferredTextSize);
    }
    // Intentionally depend only on preferredTextSize so DB pushes override
    // local state on mount, but subsequent in-app changes flow through the
    // provider unchanged.
  }, [preferredTextSize, applyExternalTextSize, textSize]);

  return null;
}
