import { ALLOWED_ENTITY_TYPES } from "@/lib/business/allow-lists";

/**
 * i18n key (under the `business.entityTypes` namespace) for a stored
 * `businesses.entity_type`, or `null` when the value is absent or not a
 * recognized type — in which case the caller renders nothing rather than
 * a raw enum token.
 *
 * Replaces the hardcoded, English-only `ENTITY_LABEL` maps that were
 * duplicated in the business list page and the hub layout (i18n is
 * MANDATORY: every user-facing string is a translation key). Call sites
 * hold the translator, so this returns the key, not the resolved text:
 *
 *   const key = entityTypeLabelKey(business.entity_type);
 *   const label = key ? t(key) : null;
 */
export function entityTypeLabelKey(
  entityType: string | null | undefined,
): string | null {
  if (!entityType || !ALLOWED_ENTITY_TYPES.has(entityType)) return null;
  return `entityTypes.${entityType}`;
}
