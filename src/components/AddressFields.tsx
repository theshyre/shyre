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
  // Each field's <input>/<select> gets an id so its FieldError (when
  // present) can be wired via aria-describedby — without this the
  // error text renders visually below the field but a screen-reader
  // user tabbing into the field never hears it. `prefix` is caller-
  // supplied and unique per form instance ("address",
  // "business_address"), so `${prefix}-street` etc. stay unique
  // even with two AddressFields on one page.
  const fieldId = (field: string): string => `${prefix}-${field}`;
  const errorId = (field: string): string => `${fieldId(field)}-error`;
  const describedBy = (field: string): string | undefined =>
    err(field) ? errorId(field) : undefined;

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
          id={fieldId("street")}
          name={`${prefix}.street`}
          defaultValue={value.street}
          placeholder="Street address"
          disabled={disabled}
          aria-describedby={describedBy("street")}
          className={inputClass}
        />
        <FieldError error={err("street")} id={errorId("street")} />
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
            id={fieldId("city")}
            name={`${prefix}.city`}
            defaultValue={value.city}
            placeholder="City"
            disabled={disabled}
            aria-describedby={describedBy("city")}
            className={inputClass}
          />
          <FieldError error={err("city")} id={errorId("city")} />
        </div>
        <div>
          <input
            id={fieldId("state")}
            name={`${prefix}.state`}
            defaultValue={value.state}
            placeholder="State / Province / Region"
            disabled={disabled}
            aria-describedby={describedBy("state")}
            className={inputClass}
          />
          <FieldError error={err("state")} id={errorId("state")} />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <input
            id={fieldId("postalCode")}
            name={`${prefix}.postalCode`}
            defaultValue={value.postalCode}
            placeholder="Postal / ZIP code"
            disabled={disabled}
            aria-describedby={describedBy("postalCode")}
            className={inputClass}
          />
          <FieldError error={err("postalCode")} id={errorId("postalCode")} />
        </div>
        <div>
          <select
            id={fieldId("country")}
            name={`${prefix}.country`}
            defaultValue={value.country}
            disabled={disabled}
            aria-describedby={describedBy("country")}
            className={selectClass}
          >
            <option value="">Country</option>
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
          <FieldError error={err("country")} id={errorId("country")} />
        </div>
      </div>
    </fieldset>
  );
}
