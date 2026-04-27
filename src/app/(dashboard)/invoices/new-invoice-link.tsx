"use client";

import { useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { useKeyboardShortcut } from "@theshyre/ui";
import { buttonPrimaryClass, kbdClass } from "@/lib/form-styles";

interface Props {
  /** Pre-translated label so the parent (a server component) can
   *  render the surrounding page without paying a client-component
   *  hydration cost just for the shortcut. */
  label: string;
}

/** Link to /invoices/new with `N`-key shortcut. The visible `<kbd>`
 *  badge is mandatory per CLAUDE.md "Keyboard shortcuts". The
 *  shortcut is suppressed when an input is focused (handled by
 *  `useKeyboardShortcut`), so it doesn't conflict with form typing. */
export function NewInvoiceLink({ label }: Props): React.JSX.Element {
  const router = useRouter();

  useKeyboardShortcut({
    key: "n",
    onTrigger: useCallback(() => router.push("/invoices/new"), [router]),
  });

  return (
    <Link href="/invoices/new" className={buttonPrimaryClass}>
      <Plus size={16} />
      {label}
      <kbd className={kbdClass}>N</kbd>
    </Link>
  );
}
