import { getUserTeams } from "@/lib/team-context";
import { Upload } from "lucide-react";
import { HarvestImport } from "./harvest-import";

export default async function ImportPage(): Promise<React.JSX.Element> {
  const teams = await getUserTeams();

  return (
    <div>
      <div className="flex items-center gap-3">
        <Upload size={24} className="text-accent" />
        <h1 className="text-2xl font-bold text-content">Import Data</h1>
      </div>

      <p className="mt-2 text-sm text-content-secondary">
        Import your existing data from other time tracking services.
      </p>

      <HarvestImport teams={teams} />
    </div>
  );
}
