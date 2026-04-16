"use client";

import { SubmitButton as BaseSubmitButton } from "@theshyre/ui";
import { buttonPrimaryClass } from "@/lib/form-styles";
import type { ComponentProps } from "react";

type BaseProps = ComponentProps<typeof BaseSubmitButton>;

/**
 * Shyre-local wrapper around `@theshyre/ui`'s `SubmitButton`.
 *
 * Defaults `className` to `buttonPrimaryClass` so existing callers that
 * relied on the implicit primary styling keep working.
 */
export function SubmitButton({
  className,
  ...rest
}: Omit<BaseProps, "className"> & {
  className?: string;
}): React.JSX.Element {
  return <BaseSubmitButton {...rest} className={className ?? buttonPrimaryClass} />;
}
