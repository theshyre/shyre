"use client";

import { inputClass, selectClass, labelClass } from "@/lib/form-styles";
import { COUNTRIES } from "@/lib/schemas/address";
import type { Address } from "@/lib/schemas/address";
import { FieldError } from "./FieldError";
import { MapPin } from "lucide-react";

interface AddressFieldsProps {
  /** Field name prefix (e.g., "address" or "business_address") */
  prefix: string;
  /** Current address values */
  value: Address;
  /** Label for the section */
  label?: string;
  /** Whether fields are disabled */
  disabled?: boolean;
  /** Field-level errors keyed by full path (e.g., "address.street") */
  errors?: Record<string, string>;
}

/**
 * Structured address fields with international support.
 * Renders street, street2, city, state/province, postal code, and country.
 */
export function AddressFields({
  prefix,
  value,
  label,
  disabled,
  errors,
}: AddressFieldsProps): React.JSX.Element {
  const err = (field: string): string | undefined =>
    errors?.[`${prefix}.${field}`];

  return (
    <fieldset className="space-y-3">
      {label && (
        <legend className={`${labelClass} flex items-center gap-1.5`}>
          <MapPin size={14} className="text-accent" />
          {label}
        </legend>
      )}

      <div>
        <input
          name={`${prefix}.street`}
          defaultValue={value.street}
          placeholder="Street address"
          disabled={disabled}
          className={inputClass}
        />
        <FieldError error={err("street")} />
      </div>

      <div>
        <input
          name={`${prefix}.street2`}
          defaultValue={value.street2}
          placeholder="Apartment, suite, unit, etc."
          disabled={disabled}
          className={inputClass}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <input
            name={`${prefix}.city`}
            defaultValue={value.city}
            placeholder="City"
            disabled={disabled}
            className={inputClass}
          />
          <FieldError error={err("city")} />
        </div>
        <div>
          <input
            name={`${prefix}.state`}
            defaultValue={value.state}
            placeholder="State / Province / Region"
            disabled={disabled}
            className={inputClass}
          />
          <FieldError error={err("state")} />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <input
            name={`${prefix}.postalCode`}
            defaultValue={value.postalCode}
            placeholder="Postal / ZIP code"
            disabled={disabled}
            className={inputClass}
          />
          <FieldError error={err("postalCode")} />
        </div>
        <div>
          <select
            name={`${prefix}.country`}
            defaultValue={value.country}
            disabled={disabled}
            className={selectClass}
          >
            <option value="">Country</option>
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
          <FieldError error={err("country")} />
        </div>
      </div>
    </fieldset>
  );
}
