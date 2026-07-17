"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Upload, ImagePlus, Trash2 } from "lucide-react";
import { AlertBanner } from "@theshyre/ui";
import { createClient } from "@/lib/supabase/client";
import { buttonSecondaryClass, buttonGhostClass } from "@/lib/form-styles";

interface Props {
  /** Storage path prefix inside the `branding` bucket — the owning team_id
   *  (optionally with a sub-path, e.g. `<teamId>/customers/<id>`). The RLS
   *  policy authorizes writes by the FIRST segment (the team). */
  folder: string;
  initialUrl: string | null;
  /** Server action that persists the chosen URL. Receives FormData carrying
   *  `logo_url` (absent = remove) plus every entry in `hiddenFields`. */
  action: (formData: FormData) => Promise<unknown>;
  /** Context the action needs to authorize + target the write, e.g.
   *  `{ team_id }` or `{ customer_id }`. */
  hiddenFields: Record<string, string>;
  /** Accessible description of what this logo is (e.g. "Team logo"). */
  altText: string;
}

const MAX_BYTES = 2 * 1024 * 1024;
const ACCEPTED = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];

/**
 * Upload / preview / remove a branding logo. Client-side direct-to-Storage
 * (the avatar-picker pattern), then a server action stores the public URL.
 * Generic over the target row via `action` + `hiddenFields`, so team and
 * customer logos share one widget.
 */
export function LogoPicker({
  folder,
  initialUrl,
  action,
  hiddenFields,
  altText,
}: Props): React.JSX.Element {
  const t = useTranslations("common.logoPicker");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(initialUrl);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [, startTransition] = useTransition();

  const commit = useCallback(
    (next: string | null) => {
      setLogoUrl(next);
      setError(null);
      const fd = new FormData();
      for (const [k, v] of Object.entries(hiddenFields)) fd.set(k, v);
      if (next) fd.set("logo_url", next);
      startTransition(async () => {
        try {
          await action(fd);
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });
    },
    [action, hiddenFields],
  );

  async function handleUpload(file: File): Promise<void> {
    setError(null);
    if (!ACCEPTED.includes(file.type)) {
      setError(t("errorType"));
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(t("errorSize"));
      return;
    }
    setUploading(true);
    try {
      const supabase = createClient();
      const ext = file.name.split(".").pop() || "png";
      const filename = `${folder}/${Date.now()}.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from("branding")
        .upload(filename, file, { upsert: true, contentType: file.type });
      if (uploadErr) {
        setError(uploadErr.message);
        return;
      }
      const { data } = supabase.storage.from("branding").getPublicUrl(filename);
      commit(data.publicUrl);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4">
        <span
          className="flex h-[64px] w-[64px] shrink-0 items-center justify-center overflow-hidden rounded-lg border border-edge bg-surface"
          aria-hidden={logoUrl ? undefined : "true"}
        >
          {logoUrl ? (
            // A stored Supabase public URL; next/image would need remotePatterns
            // config and the avatar precedent uses a plain <img>.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt={altText}
              className="max-h-full max-w-full object-contain"
            />
          ) : (
            <ImagePlus size={22} className="text-content-muted" />
          )}
        </span>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className={buttonSecondaryClass}
          >
            {uploading ? (
              <>
                <Upload size={14} aria-hidden="true" className="animate-pulse" />
                {t("uploading")}
              </>
            ) : (
              <>
                <ImagePlus size={14} aria-hidden="true" />
                {logoUrl ? t("replace") : t("upload")}
              </>
            )}
          </button>
          {logoUrl && (
            <button
              type="button"
              onClick={() => commit(null)}
              disabled={uploading}
              className={buttonGhostClass}
            >
              <Trash2 size={14} aria-hidden="true" className="text-error" />
              <span className="text-error">{t("remove")}</span>
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED.join(",")}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleUpload(f);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      {error && <AlertBanner tone="error">{error}</AlertBanner>}
      <p className="text-caption text-content-muted">{t("helpText")}</p>
    </div>
  );
}
