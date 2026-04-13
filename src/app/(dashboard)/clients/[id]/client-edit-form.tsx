"use client";

import { Users } from "lucide-react";
import {
  inputClass,
  textareaClass,
  labelClass,
  buttonPrimaryClass,
} from "@/lib/form-styles";
import { updateClientAction } from "../actions";

interface Client {
  id: string;
  name: string;
  email: string | null;
  address: string | null;
  notes: string | null;
  default_rate: number | null;
}

export function ClientEditForm({
  client,
}: {
  client: Client;
}): React.JSX.Element {
  return (
    <form action={updateClientAction} className="space-y-4">
      <input type="hidden" name="id" value={client.id} />

      <div className="flex items-center gap-3">
        <Users size={24} className="text-accent" />
        <h1 className="text-2xl font-bold text-content">Edit Client</h1>
      </div>

      <div className="rounded-lg border border-edge bg-surface-raised p-4 space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass}>Name *</label>
            <input
              name="name"
              required
              defaultValue={client.name}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Email</label>
            <input
              name="email"
              type="email"
              defaultValue={client.email ?? ""}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Default Rate ($/hr)</label>
            <input
              name="default_rate"
              type="number"
              step="0.01"
              min="0"
              defaultValue={client.default_rate ?? ""}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Address</label>
            <input
              name="address"
              defaultValue={client.address ?? ""}
              className={inputClass}
            />
          </div>
        </div>
        <div>
          <label className={labelClass}>Notes</label>
          <textarea
            name="notes"
            rows={3}
            defaultValue={client.notes ?? ""}
            className={textareaClass}
          />
        </div>
      </div>

      <button type="submit" className={buttonPrimaryClass}>
        Save Changes
      </button>
    </form>
  );
}
