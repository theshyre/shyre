import { z } from "zod";

import { runIntegrationRoute } from "@/lib/integrations/api-auth";
import { deleteEntry, getEntry, updateEntry } from "@/lib/integrations/service";

/**
 * GET / PATCH / DELETE /api/v1/entries/:id — read, edit, or soft-delete a
 * single time entry (SAL-051 entry-mutation API).
 *
 * PATCH and DELETE touch ONLY agent-created rows (started_by_kind='agent')
 * owned by the token's user, and refuse invoiced / period-locked rows —
 * enforced in the RPCs. GET is `entries:read`, PATCH is `entries:write`,
 * DELETE is `entries:delete` (soft-delete → recoverable via /trash).
 */

const idSchema = z.uuid();

/** A malformed id is a client error, not an existence oracle → 400. */
function badId(): Response {
  return Response.json(
    { error: "invalid_request", message: "entry id must be a uuid" },
    { status: 400 },
  );
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) return badId();
  return runIntegrationRoute(request, {
    action: "api.v1.entries.get",
    invoke: (tokenHash) => getEntry(tokenHash, id),
  });
}

const patchSchema = z
  .object({
    start_time: z.iso.datetime({ offset: true }).optional(),
    end_time: z.iso.datetime({ offset: true }).optional(),
    description: z.string().min(1).max(2000).optional(),
    category_id: z.uuid().optional(),
    billable: z.boolean().optional(),
  })
  .strict();

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) return badId();
  return runIntegrationRoute(request, {
    action: "api.v1.entries.update",
    bodySchema: patchSchema,
    invoke: (tokenHash, body) =>
      updateEntry(tokenHash, id, {
        startTime: body.start_time,
        endTime: body.end_time,
        description: body.description,
        categoryId: body.category_id,
        billable: body.billable,
      }),
  });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) return badId();
  return runIntegrationRoute(request, {
    action: "api.v1.entries.delete",
    invoke: (tokenHash) => deleteEntry(tokenHash, id),
  });
}
