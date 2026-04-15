import { getTranslations } from "next-intl/server";
import { UserCog } from "lucide-react";

export default async function BusinessPeoplePage(): Promise<React.JSX.Element> {
  const t = await getTranslations("business.tiles.people");

  return (
    <div className="rounded-lg border border-dashed border-edge bg-surface-raised/40 p-8 text-center space-y-3">
      <UserCog size={28} className="text-content-muted mx-auto" />
      <div>
        <p className="text-sm font-medium text-content">{t("title")}</p>
        <p className="mt-1 text-xs text-content-muted max-w-md mx-auto">
          {t("hint")}
        </p>
      </div>
    </div>
  );
}
