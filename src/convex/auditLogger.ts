// ---------------------------------------------------------------------
// Layer 3 — Audit logging (platform binding).
//
// `logUserAction` appends an immutable tracking record to the existing
// `auditLog` table (schema.ts — append-only by convention: rows are
// written, never updated or deleted).
//
// Failure contract (per the platform requirement): if the database write
// fails for ANY reason, the error is swallowed and a structured
// `{ logged: false }` result is returned — a dropped audit write never
// crashes the core application flow. Callers should invoke-and-forget;
// they may check the result, but the calling mutation's success must not
// depend on it.
//
// Confidential material (tokens, emails, card numbers, auth headers) is
// redacted by the pure rules in src/lib/auditRedaction.ts before anything
// reaches the table; the log must never become a secondary leak channel.
// ---------------------------------------------------------------------

import { v } from "convex/values";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { getAccessContext } from "./access";
import { buildAuditMetadata } from "../lib/auditRedaction";
import type { LogMetadataInput } from "../lib/auditRedaction";

export type LogUserActionResult =
  | { logged: true }
  | { logged: false; reason: string };

/**
 * Capture who did what, from where — appending one immutable audit row
 * for the caller's organization. Fails silently on any database error.
 */
export async function logUserAction(
  ctx: MutationCtx,
  input: LogMetadataInput,
): Promise<LogUserActionResult> {
  try {
    // Tenant identity comes from the verified session, never from the
    // payload: if the caller has no active membership there is no
    // tenant to attribute the action to, and nothing is logged.
    const ac = await getAccessContext(ctx);
    if (!ac) return { logged: false, reason: "no_active_session" };

    const meta = buildAuditMetadata({
      ...input,
      userId: input.userId ?? ac.user._id,
      organizationId: input.organizationId ?? ac.org._id,
    });

    await ctx.db.insert("auditLog", {
      orgId: ac.org._id,
      matterId: undefined,
      actorId: ac.user._id,
      actorName: meta.actorName,
      action: meta.action,
      detail: [
        meta.detail,
        `ip=${meta.ip}`,
        `ua=${meta.userAgent}`,
      ]
        .filter(Boolean)
        .join(" "),
      createdAt: Date.now(),
    });
    return { logged: true };
  } catch (e) {
    // Fail SILENTLY: logging must never break the core flow. The error
    // is captured only as a structured result — never re-thrown, never
    // logged with confidential payload material.
    return {
      logged: false,
      reason: e instanceof Error ? "database_write_failed" : "unknown_error",
    };
  }
}

/**
 * Internal entry point for non-user-context flows (scheduled jobs,
 * webhooks) that still need an attributed, fail-silent audit record.
 */
export const recordSystemAction = internalMutation({
  args: {
    orgId: v.id("organizations"),
    actorId: v.id("users"),
    actorName: v.string(),
    action: v.string(),
    detail: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<LogUserActionResult> => {
    try {
      await ctx.db.insert("auditLog", {
        orgId: args.orgId,
        actorId: args.actorId,
        actorName: args.actorName,
        action: args.action,
        detail: args.detail,
        createdAt: Date.now(),
      });
      return { logged: true };
    } catch {
      return { logged: false, reason: "database_write_failed" };
    }
  },
});
