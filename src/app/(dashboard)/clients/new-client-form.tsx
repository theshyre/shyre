"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import {
  inputClass,
  textareaClass,
  labelClass,
  buttonPrimaryClass,
  buttonSecondaryClass,
} from "@/lib/form-styles";
import { createClientAction } from "./actions";

export function NewClientForm(): React.JSX.Element {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className={`${buttonPrimaryClass} mt-4`}
      >
        <Plus size={16} />
        Add Client
      </button>
    );
  }

  return (
    <form
      action={async (formData) => {
        await createClientAction(formData);
        setOpen(false);
      }}
      className="mt-4 space-y-3 rounded-lg border border-edge bg-surface-raised p-4"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass}>Name *</label>
          <input name="name" required className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Email</label>
          <input name="email" type="email" className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Default Rate ($/hr)</label>
          <input
            name="default_rate"
            type="number"
            step="0.01"
            min="0"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Address</label>
          <input name="address" className={inputClass} />
        </div>
      </div>
      <div>
        <label className={labelClass}>Notes</label>
        <textarea name="notes" rows={2} className={textareaClass} />
      </div>
      <div className="flex gap-2">
        <button type="submit" className={buttonPrimaryClass}>
          Save Client
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className={buttonSecondaryClass}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
