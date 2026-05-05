"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Upload, ImagePlus, Trash2 } from "lucide-react";
import { AlertBanner } from "@theshyre/ui";
import { createClient } from "@/lib/supabase/client";
import { Avatar, AVATAR_PRESETS } from "@/components/Avatar";
import { buttonSecondaryClass, buttonGhostClass } from "@/lib/form-styles";
import { setAvatarAction } from "./actions";

interface Props {
  userId: string;
  displayName: string;
  initialAvatarUrl: string | null;
}

const MAX_BYTES = 2 * 1024 * 1024;
const ACCEPTED = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/**
 * Avatar picker: choose a preset tile or upload a photo.
 * Writes the chosen value into `user_profiles.avatar_url` via setAvatarAction.
 */
export function AvatarPicker({
  userId,
  displayName,
  initialAvatarUrl,
}: Props): React.JSX.Element {
  const t = useTranslations("settings.profile.avatar_picker");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(initialAvatarUrl);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [, startTransition] = useTransition();

  const commitAvatar = useCallback((next: string | null) => {
    setAvatarUrl(next);
    setError(null);
    const fd = new FormData();
    if (next) fd.set("avatar_url", next);
    startTransition(async () => {
      await setAvatarAction(fd);
    });
  }, []);

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
      const filename = `${userId}/${Date.now()}.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from("avatars")
        .upload(filename, file, {
          upsert: true,
          contentType: file.type,
        });
      if (uploadErr) {
        setError(uploadErr.message);
        setUploading(false);
        return;
      }
      const { data } = supabase.storage.from("avatars").getPublicUrl(filename);
      const publicUrl = data.publicUrl;
      commitAvatar(publicUrl);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-3">
      {/* Current avatar preview */}
      <div className="flex items-center gap-4">
        <Avatar avatarUrl={avatarUrl} displayName={displayName} size={72} />
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className={buttonSecondaryClass}
          >
            {uploading ? (
              <>
                <Upload size={14} className="animate-pulse" />
                {t("uploading")}
              </>
            ) : (
              <>
                <ImagePlus size={14} />
                {t("upload")}
              </>
            )}
          </button>
          {avatarUrl && (
            <button
              type="button"
              onClick={() => commitAvatar(null)}
              className={buttonGhostClass}
            >
              <Trash2 size={14} className="text-error" />
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

      {/* Presets */}
      <div>
        <p className="text-caption text-content-muted mb-2">{t("orPickPreset")}</p>
        <div className="flex flex-wrap gap-2">
          {AVATAR_PRESETS.map((preset) => {
            const key = `preset:${preset.key}`;
            const active = avatarUrl === key;
            const initial = (displayName.trim().charAt(0) || "?").toUpperCase();
            return (
              <button
                key={preset.key}
                type="button"
                aria-label={preset.key}
                aria-pressed={active}
                onClick={() => commitAvatar(key)}
                className={`relative inline-flex items-center justify-center rounded-full transition-transform hover:scale-110 ${
                  active ? "ring-2 ring-accent ring-offset-2 ring-offset-surface-raised" : ""
                }`}
                style={{
                  width: 36,
                  height: 36,
                  backgroundColor: preset.bg,
                  color: preset.fg,
                }}
              >
                <span className="text-body-lg font-semibold">{initial}</span>
              </button>
            );
          })}
        </div>
      </div>

      <p className="text-caption text-content-muted">{t("helpText")}</p>
    </div>
  );
}
