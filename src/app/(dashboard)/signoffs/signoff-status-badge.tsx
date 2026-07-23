import { useTranslations } from "next-intl";
import {
  FileEdit,
  Send,
  Eye,
  CheckCircle2,
  XCircle,
  History,
  Ban,
  type LucideIcon,
} from "lucide-react";

interface Props {
  status: string;
  size?: "default" | "prominent";
}

/** icon + tone classes per status — 3-channel (icon + text + color) per the
 *  redundant-visual-encoding rule. */
const CONFIG: Record<string, { icon: LucideIcon; tone: string }> = {
  draft: { icon: FileEdit, tone: "bg-surface-inset text-content-secondary" },
  sent: { icon: Send, tone: "bg-info-soft text-info-text" },
  viewed: { icon: Eye, tone: "bg-info-soft text-info-text" },
  completed: { icon: CheckCircle2, tone: "bg-success-soft text-success-text" },
  declined: { icon: XCircle, tone: "bg-error-soft text-error-text" },
  superseded: { icon: History, tone: "bg-surface-inset text-content-muted" },
  canceled: { icon: Ban, tone: "bg-surface-inset text-content-muted" },
};

/** Three-channel document sign-off status indicator. */
export function SignoffStatusBadge({
  status,
  size = "default",
}: Props): React.JSX.Element {
  const t = useTranslations("signoff.status");
  const { icon: Icon, tone } = CONFIG[status] ?? CONFIG.draft!;
  const prominent = size === "prominent";
  const lineThrough = status === "superseded" || status === "canceled";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-medium ${tone} ${
        prominent ? "px-2.5 py-1 text-body" : "px-2 py-0.5 text-label"
      }`}
    >
      <Icon size={prominent ? 15 : 13} aria-hidden="true" />
      <span className={lineThrough ? "line-through" : undefined}>
        {t(status)}
      </span>
    </span>
  );
}
