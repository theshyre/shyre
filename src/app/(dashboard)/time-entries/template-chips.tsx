"use client";

import { useTranslations } from "next-intl";
import { Bookmark, Play } from "lucide-react";
import type { TimeTemplate } from "@/lib/templates/types";
import { useFormAction } from "@/hooks/use-form-action";
import { Tooltip } from "@/components/Tooltip";
import { startFromTemplateAction } from "../templates/actions";

interface Props {
  templates: TimeTemplate[];
}

export function TemplateChips({ templates }: Props): React.JSX.Element | null {
  const t = useTranslations("templates");
  const { handleSubmit, pending } = useFormAction({
    action: startFromTemplateAction,
  });

  if (templates.length === 0) return null;

  return (
    <div>
      <p className="mb-2 flex items-center gap-1.5 text-caption font-semibold uppercase tracking-wider text-content-muted">
        <Bookmark size={12} />
        {t("startFrom")}
      </p>
      <div className="flex flex-wrap gap-2">
        {templates.map((tpl) => {
          const trigger = (
            <button
              type="submit"
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1 text-caption font-medium text-accent-text hover:bg-accent/20 transition-colors disabled:opacity-50"
            >
              <Play size={10} />
              {tpl.name}
            </button>
          );
          return (
            <form key={tpl.id} action={handleSubmit}>
              <input type="hidden" name="template_id" value={tpl.id} />
              {tpl.description ? (
                <Tooltip label={tpl.description}>{trigger}</Tooltip>
              ) : (
                trigger
              )}
            </form>
          );
        })}
      </div>
    </div>
  );
}
