"use node";

// =====================================================================
// Communications provider bridge — runs in the Node runtime.
//
// EMAIL: Resend REST API (plain fetch; no SDK needed).
// WHATSAPP: Meta WhatsApp Cloud API (plain fetch).
//
// Delivery/failure callbacks are verified BEFORE anything touches the
// notification log: Meta signs with X-Hub-Signature-256 (HMAC-SHA256 of
// the raw body with the app secret); Resend uses Svix-style signed
// headers. Unverified callbacks are rejected with 401.
//
// Env vars (Keys tab): RESEND_API_KEY, RESEND_FROM_EMAIL,
// WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_APP_SECRET,
// RESEND_WEBHOOK_SECRET (optional), APP_PUBLIC_URL (optional link base).
// =====================================================================

import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { createHmac, timingSafeEqual } from "node:crypto";

// ---------------------------------------------------------------------
// Signature helpers
// ---------------------------------------------------------------------

function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Meta WhatsApp: sha256=<hex hmac(appSecret, rawBody)>. */
function verifyMetaSignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header || !header.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  return safeEqualHex(expected, header.slice(7).trim());
}

/**
 * Resend (Svix): signatures cover "{id}.{timestamp}.{payload}" with a
 * base64-encoded secret. Tolerates small clock skew.
 */
function verifySvixSignature(
  rawBody: string,
  headers: { id: string | null; timestamp: string | null; signatures: string | null },
  secret: string,
): boolean {
  if (!headers.id || !headers.timestamp || !headers.signatures) return false;
  let key = secret;
  if (key.startsWith("whsec_")) key = key.slice(6);
  const keyBuf = Buffer.from(key, "base64");
  const ts = Number(headers.timestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Date.now() / 1000 - ts) > 5 * 60) return false;
  const expected = createHmac("sha256", keyBuf)
    .update(`${headers.id}.${headers.timestamp}.${rawBody}`, "utf8")
    .digest("base64");
  return headers.signatures
    .split(",")
    .map((s) => s.trim())
    .some((sig) => sig === expected);
}

// ---------------------------------------------------------------------
// Email — Resend
// ---------------------------------------------------------------------

async function resendSend(
  apiKey: string,
  from: string,
  to: string,
  subject: string,
  html: string,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to: [to], subject, html }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    id?: string;
    message?: string;
    name?: string;
  };
  if (!res.ok || !body.id) {
    return { ok: false, error: body.message ?? `Resend error ${res.status}` };
  }
  return { ok: true, id: body.id };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function emailShell(title: string, bodyHtml: string, footerNote: string): string {
  return `<!doctype html><html><body style="margin:0;background:#F7F5EF;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#FFFFFF;border:1px solid #E5E7EB;border-radius:8px;overflow:hidden;">
    <div style="background:#0F172A;padding:20px 28px;">
      <span style="color:#C39A52;font-family:Georgia,serif;font-size:18px;letter-spacing:0.06em;">ADVOKATE.IN</span>
      <span style="color:#94A3B8;font-size:12px;margin-left:10px;">The Digital Chamber</span>
    </div>
    <div style="padding:28px;font-family:Georgia,'Times New Roman',serif;color:#0F172A;">
      <h1 style="margin:0 0 14px;font-size:20px;">${escapeHtml(title)}</h1>
      ${bodyHtml}
    </div>
    <div style="padding:16px 28px;border-top:1px solid #E5E7EB;font-family:Helvetica,Arial,sans-serif;font-size:11px;color:#64748B;">
      ${escapeHtml(footerNote)}
    </div>
  </div></body></html>`;
}

/**
 * Send a transactional email through Resend and record it in the
 * notification log with the provider message id (delivery callbacks
 * update status later). Sends fail loudly when unconfigured.
 */
export const sendEmail = action({
  args: {
    orgId: v.id("organizations"),
    to: v.string(),
    recipientUserId: v.optional(v.id("users")),
    category: v.string(),
    subject: v.string(),
    title: v.string(),
    bodyHtml: v.string(),
    footerNote: v.optional(v.string()),
    conversationId: v.optional(v.id("conversations")),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ logId: Id<"notificationLog">; providerMessageId: string }> => {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.RESEND_FROM_EMAIL;
    if (!apiKey || !from) {
      throw new Error(
        "Email sending is not configured. Add RESEND_API_KEY and RESEND_FROM_EMAIL in the Keys tab.",
      );
    }
    const logId = await ctx.runMutation(internal.notifyLog.logQueued, {
      orgId: args.orgId,
      channel: "email",
      recipientUserId: args.recipientUserId,
      recipient: args.to,
      category: args.category,
      subject: args.subject,
      conversationId: args.conversationId,
    });
    try {
      const result = await resendSend(
        apiKey,
        from,
        args.to,
        args.subject,
        emailShell(args.title, args.bodyHtml, args.footerNote ?? "Sent via Advokate — your chamber's digital workspace."),
      );
      if (!result.ok) {
        await ctx.runMutation(internal.notifyLog.markFailed, { logId, reason: result.error });
        throw new Error(result.error);
      }
      await ctx.runMutation(internal.notifyLog.markSent, {
        logId,
        providerMessageId: result.id,
      });
      return { logId, providerMessageId: result.id };
    } catch (e) {
      const reason = e instanceof Error ? e.message : "Unknown email error";
      await ctx.runMutation(internal.notifyLog.markFailed, { logId, reason });
      throw e;
    }
  },
});

/** Standalone invitation email (used by the team/client invitation flow). */
export const sendInviteEmail = action({
  args: {
    orgId: v.id("organizations"),
    to: v.string(),
    orgName: v.string(),
    roleLabel: v.string(),
    inviteUrl: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ logId: Id<"notificationLog">; providerMessageId: string }> => {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.RESEND_FROM_EMAIL;
    if (!apiKey || !from) {
      throw new Error(
        "Email sending is not configured. Add RESEND_API_KEY and RESEND_FROM_EMAIL in the Keys tab.",
      );
    }
    const logId = await ctx.runMutation(internal.notifyLog.logQueued, {
      orgId: args.orgId,
      channel: "email",
      recipient: args.to,
      category: "invite",
      subject: `Invitation — ${args.orgName} on Advokate`,
    });
    const body = `
      <p style="margin:0 0 12px;">You have been invited to join <strong>${escapeHtml(args.orgName)}</strong> on Advokate as <strong>${escapeHtml(args.roleLabel)}</strong>.</p>
      <p style="margin:0 0 20px;">This invitation link is personal and single-use.</p>
      <a href="${escapeHtml(args.inviteUrl)}" style="display:inline-block;background:#0F172A;color:#FFFFFF;text-decoration:none;padding:10px 18px;border-radius:6px;font-family:Helvetica,Arial,sans-serif;font-size:14px;">Accept invitation</a>
      <p style="margin:18px 0 0;font-size:13px;color:#64748B;">If the button does not work, paste this address into your browser:<br>${escapeHtml(args.inviteUrl)}</p>`;
    try {
      const result = await resendSend(
        apiKey,
        from,
        args.to,
        `Invitation — ${args.orgName} on Advokate`,
        emailShell(
          `You are invited to ${args.orgName}`,
          body,
          "Invitations expire. If you were not expecting this email, ignore it.",
        ),
      );
      if (!result.ok) {
        await ctx.runMutation(internal.notifyLog.markFailed, { logId, reason: result.error });
        throw new Error(result.error);
      }
      await ctx.runMutation(internal.notifyLog.markSent, {
        logId,
        providerMessageId: result.id,
      });
      return { logId, providerMessageId: result.id };
    } catch (e) {
      const reason = e instanceof Error ? e.message : "Unknown email error";
      await ctx.runMutation(internal.notifyLog.markFailed, { logId, reason });
      throw e;
    }
  },
});

// ---------------------------------------------------------------------
// WhatsApp — Meta Cloud API
// ---------------------------------------------------------------------

async function whatsappSendTemplate(
  token: string,
  phoneNumberId: string,
  to: string,
  templateName: string,
  languageCode: string,
  params: string[],
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: templateName,
        language: { code: languageCode },
        components: [
          {
            type: "body",
            parameters: params.map((text) => ({ type: "text", text })),
          },
        ],
      },
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    messages?: Array<{ id?: string }>;
    error?: { message?: string };
  };
  const id = body.messages?.[0]?.id;
  if (!res.ok || !id) {
    return { ok: false, error: body.error?.message ?? `WhatsApp error ${res.status}` };
  }
  return { ok: true, id };
}

/**
 * Send an approved WhatsApp template to an opted-in recipient and log it.
 * The template registry and opt-in check live in comm.ts — this action
 * only talks to the provider. Recipients without WhatsApp enabled never
 * reach this path.
 */
export const sendWhatsappTemplate = action({
  args: {
    orgId: v.id("organizations"),
    to: v.string(),
    recipientUserId: v.optional(v.id("users")),
    category: v.string(),
    templateName: v.string(),
    languageCode: v.optional(v.string()),
    params: v.array(v.string()),
    conversationId: v.optional(v.id("conversations")),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ logId: Id<"notificationLog">; providerMessageId: string }> => {
    const token = process.env.WHATSAPP_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    if (!token || !phoneNumberId) {
      throw new Error(
        "WhatsApp sending is not configured. Add WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID in the Keys tab.",
      );
    }
    const logId = await ctx.runMutation(internal.notifyLog.logQueued, {
      orgId: args.orgId,
      channel: "whatsapp",
      recipientUserId: args.recipientUserId,
      recipient: args.to,
      category: args.category,
      templateName: args.templateName,
      conversationId: args.conversationId,
    });
    try {
      const result = await whatsappSendTemplate(
        token,
        phoneNumberId,
        args.to,
        args.templateName,
        args.languageCode ?? "en",
        args.params,
      );
      if (!result.ok) {
        await ctx.runMutation(internal.notifyLog.markFailed, { logId, reason: result.error });
        throw new Error(result.error);
      }
      await ctx.runMutation(internal.notifyLog.markSent, {
        logId,
        providerMessageId: result.id,
      });
      return { logId, providerMessageId: result.id };
    } catch (e) {
      const reason = e instanceof Error ? e.message : "Unknown WhatsApp error";
      await ctx.runMutation(internal.notifyLog.markFailed, { logId, reason });
      throw e;
    }
  },
});

// ---------------------------------------------------------------------
// Notification-log mutations live in notifyLog.ts (Node modules may
// only define actions). The actions above call them via internal.*
// ---------------------------------------------------------------------

// ---------------------------------------------------------------------
// Verified webhook verification entry point (called from http.ts)
// ---------------------------------------------------------------------

export type ProviderEvent = {
  channel: "email" | "whatsapp";
  providerMessageId: string;
  eventType: string;
  failureReason?: string;
};

export const verifyAndApplyWebhook = internalAction({
  args: {
    channel: v.union(v.literal("email"), v.literal("whatsapp")),
    rawBody: v.string(),
    metaSignature: v.optional(v.string()),
    svixId: v.optional(v.string()),
    svixTimestamp: v.optional(v.string()),
    svixSignatures: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ status: number; body: string }> => {
    const events: ProviderEvent[] = [];
    if (args.channel === "whatsapp") {
      const secret = process.env.WHATSAPP_APP_SECRET;
      if (!secret || !verifyMetaSignature(args.rawBody, args.metaSignature ?? null, secret)) {
        return { status: 401, body: "invalid signature" };
      }
      const parsed = JSON.parse(args.rawBody) as {
        entry?: Array<{
          changes?: Array<{
            value?: {
              statuses?: Array<{
                id: string;
                status: string;
                errors?: Array<{ title?: string }>;
              }>;
            };
          }>;
        }>;
      };
      for (const entry of parsed.entry ?? []) {
        for (const change of entry.changes ?? []) {
          for (const st of change.value?.statuses ?? []) {
            events.push({
              channel: "whatsapp",
              providerMessageId: st.id,
              eventType: st.status,
              failureReason: st.errors?.[0]?.title,
            });
          }
        }
      }
    } else {
      const secret = process.env.RESEND_WEBHOOK_SECRET;
      if (
        !secret ||
        !verifySvixSignature(
          args.rawBody,
          {
            id: args.svixId ?? null,
            timestamp: args.svixTimestamp ?? null,
            signatures: args.svixSignatures ?? null,
          },
          secret,
        )
      ) {
        return { status: 401, body: "invalid signature" };
      }
      const parsed = JSON.parse(args.rawBody) as {
        type: string;
        data?: { email_id?: string };
      };
      if (parsed.data?.email_id) {
        events.push({
          channel: "email",
          providerMessageId: parsed.data.email_id,
          eventType: parsed.type.replace("email.", ""),
        });
      }
    }

    for (const ev of events) {
      await ctx.runMutation(internal.notifyLog.applyProviderEvent, {
        channel: ev.channel,
        providerMessageId: ev.providerMessageId,
        eventType: ev.eventType,
        payload: args.rawBody.slice(0, 4000),
        failureReason: ev.failureReason,
      });
    }
    return { status: 200, body: "ok" };
  },
});
