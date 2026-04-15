"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslations } from "next-intl";
import { X, Undo2, CheckCircle2, AlertCircle, Info } from "lucide-react";

export type ToastKind = "info" | "success" | "error";

export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
  /** Optional action button rendered next to the message. */
  actionLabel?: string;
  onAction?: () => void | Promise<void>;
  /** Total lifetime in ms before auto-dismiss. Default 10_000. */
  durationMs: number;
}

interface PushInput {
  message: string;
  kind?: ToastKind;
  actionLabel?: string;
  onAction?: () => void | Promise<void>;
  durationMs?: number;
}

interface ToastContextValue {
  push: (input: PushInput) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const DEFAULT_DURATION_MS = 10_000;

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error(
      "useToast must be used inside <ToastProvider>. Did you forget to mount it in the dashboard layout?",
    );
  }
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [toasts, setToasts] = useState<Toast[]>([]);
  // Stable id generator — browser-only, no ssr hydration concerns for IDs.
  const counter = useRef(0);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (input: PushInput): string => {
      counter.current += 1;
      const id = `t-${Date.now()}-${counter.current}`;
      const toast: Toast = {
        id,
        kind: input.kind ?? "info",
        message: input.message,
        actionLabel: input.actionLabel,
        onAction: input.onAction,
        durationMs: input.durationMs ?? DEFAULT_DURATION_MS,
      };
      setToasts((prev) => [...prev, toast]);
      return id;
    },
    [],
  );

  const value: ToastContextValue = { push, dismiss };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}): React.JSX.Element | null {
  // Dismiss the most recent toast on Escape — matches overlay rule.
  useEffect(() => {
    if (toasts.length === 0) return;
    function handleKey(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        const last = toasts[toasts.length - 1];
        if (last) onDismiss(last.id);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [toasts, onDismiss]);

  if (toasts.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex flex-col items-center gap-2 px-4"
      role="region"
      aria-label="Notifications"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: (id: string) => void;
}): React.JSX.Element {
  const t = useTranslations("common.toast");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), toast.durationMs);
    return () => clearTimeout(timer);
  }, [toast.id, toast.durationMs, onDismiss]);

  const Icon =
    toast.kind === "success"
      ? CheckCircle2
      : toast.kind === "error"
        ? AlertCircle
        : Info;
  // Color + icon + text = three-channel redundant encoding.
  const iconClass =
    toast.kind === "success"
      ? "text-success"
      : toast.kind === "error"
        ? "text-error"
        : "text-accent";

  async function handleAction(): Promise<void> {
    if (!toast.onAction || pending) return;
    setPending(true);
    try {
      await toast.onAction();
    } finally {
      setPending(false);
      onDismiss(toast.id);
    }
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-auto flex items-center gap-3 rounded-lg border border-edge bg-surface-raised px-4 py-2.5 text-sm text-content shadow-lg min-w-[280px] max-w-md"
    >
      <Icon size={16} className={`shrink-0 ${iconClass}`} />
      <span className="flex-1">{toast.message}</span>
      {toast.actionLabel && toast.onAction && (
        <button
          type="button"
          onClick={handleAction}
          disabled={pending}
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold text-accent hover:bg-accent-soft disabled:opacity-50 transition-colors"
        >
          <Undo2 size={12} />
          {toast.actionLabel}
        </button>
      )}
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label={t("dismiss")}
        className="rounded p-1 text-content-muted hover:bg-hover transition-colors"
      >
        <X size={14} />
      </button>
    </div>
  );
}
