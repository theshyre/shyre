"use client";

import { useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { useKeyboardShortcut } from "@theshyre/ui";
import { buttonPrimaryClass, kbdClass } from "@/lib/form-styles";

interface Props {
  /** Pre-translated label — parent is a server component. */
  label: string;
}

/** Link to /signoffs/new with the `N` shortcut + visible kbd badge
 *  (mirrors NewProposalLink). Suppressed while an input is focused. */
export function NewSignoffLink({ label }: Props): React.JSX.Element {
  const router = useRouter();
  useKeyboardShortcut({
    key: "n",
    onTrigger: useCallback(() => router.push("/signoffs/new"), [router]),
  });
  return (
    <Link href="/signoffs/new" className={buttonPrimaryClass}>
      <Plus size={16} />
      {label}
      <kbd className={kbdClass}>N</kbd>
    </Link>
  );
}
