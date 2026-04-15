"use client";

import { useEffect, useRef } from "react";
import { useTextSize, type TextSize } from "./text-size-provider";

interface Props {
  /**
   * Text size the server read from user_settings.text_size. `null` means the
   * user hasn't picked one — fall back to the localStorage/default path.
   */
  preferredTextSize: TextSize | null;
}

/**
 * One-way DB → TextSizeProvider sync. Runs **once per mount**: if the
 * server-read preference differs from what the provider is showing, we push
 * the DB value in. After that, the provider is authoritative for the session.
 *
 * Why the ref-guard: if this effect re-ran on every `textSize` change, an
 * in-app click (setTextSize "compact") would trigger a rerender, the effect
 * would see `preferredTextSize !== textSize` and push the DB value back,
 * undoing the click. Asked us to ship this feature and its own sync was
 * fighting it.
 */
export function TextSizeSync({ preferredTextSize }: Props): null {
  const { textSize, applyExternalTextSize } = useTextSize();
  const didSync = useRef(false);

  useEffect(() => {
    if (didSync.current) return;
    didSync.current = true;
    if (preferredTextSize && preferredTextSize !== textSize) {
      applyExternalTextSize(preferredTextSize);
    }
  }, [preferredTextSize, textSize, applyExternalTextSize]);

  return null;
}
