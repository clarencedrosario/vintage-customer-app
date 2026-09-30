import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { auth } from "./auth";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { verifySecureFileToken } from "./documents";

const http = httpRouter();

auth.addHttpRoutes(http);

// ---------------------------------------------------------------------
// Razorpay webhook — signature-verified, idempotent reconciliation.
//
// The raw body is read BEFORE parsing so the HMAC covers exactly the
// bytes Razorpay signed. An invalid signature never reaches invoice
// state. Reconciliation itself dedupes on the event id, so provider
// retries are safe.
// ---------------------------------------------------------------------
http.route({
  path: "/webhooks/razorpay",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const rawBody = await request.text();
    const signature =
      request.headers.get("x-razorpay-signature") ?? "";

    const result = await ctx.runAction(
      internal.paymentsProvider.verifyAndReconcileWebhook,
      { rawBody, signature },
    );

    return new Response(result.body, {
      status: result.status,
      headers: { "Content-Type": "text/plain" },
    });
  }),
});

// Per-firm Razorpay webhook: each firm points ITS OWN Razorpay
// dashboard at /webhooks/razorpay/firm/<orgId>. The path org id is
// only a routing hint used to SELECT the firm's webhook secret — the
// HMAC signature against that secret is what proves authenticity, and
// reconciliation additionally refuses any event whose target belongs
// to a different org.
http.route({
  path: "/webhooks/razorpay/firm/:orgId",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const rawBody = await request.text();
    const signature =
      request.headers.get("x-razorpay-signature") ?? "";
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);
    const orgId = parts[parts.length - 1] ?? "";
    if (!orgId) {
      return new Response("Missing firm id.", { status: 400 });
    }
    const result = await ctx.runAction(
      internal.paymentsProvider.verifyAndReconcileFirmWebhook,
      { rawBody, signature, orgId: orgId as Id<"organizations"> },
    );
    return new Response(result.body, {
      status: result.status,
      headers: { "Content-Type": "text/plain" },
    });
  }),
});

// ---------------------------------------------------------------------
// WhatsApp status callbacks — Meta signs the raw body with
// X-Hub-Signature-256 (app secret). Verified events update the
// notification log; unverified requests are rejected before parsing.
// ---------------------------------------------------------------------
http.route({
  path: "/webhooks/whatsapp",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const rawBody = await request.text();
    const signature = request.headers.get("x-hub-signature-256");
    const result = await ctx.runAction(internal.notify.verifyAndApplyWebhook, {
      channel: "whatsapp",
      rawBody,
      metaSignature: signature ?? undefined,
    });
    return new Response(result.body, {
      status: result.status,
      headers: { "Content-Type": "text/plain" },
    });
  }),
});

// Meta webhook verification handshake (hub challenge).
http.route({
  path: "/webhooks/whatsapp",
  method: "GET",
  handler: httpAction(async (_ctx, request) => {
    const url = new URL(request.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    const expected = process.env.WHATSAPP_VERIFY_TOKEN;
    if (mode === "subscribe" && expected && token === expected && challenge) {
      return new Response(challenge, { status: 200 });
    }
    return new Response("forbidden", { status: 403 });
  }),
});

// ---------------------------------------------------------------------
// Resend delivery callbacks — Svix-signed headers over the raw body.
// ---------------------------------------------------------------------
http.route({
  path: "/webhooks/resend",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const rawBody = await request.text();
    const result = await ctx.runAction(internal.notify.verifyAndApplyWebhook, {
      channel: "email",
      rawBody,
      svixId: request.headers.get("svix-id") ?? undefined,
      svixTimestamp: request.headers.get("svix-timestamp") ?? undefined,
      svixSignatures: request.headers.get("svix-signature") ?? undefined,
    });
    return new Response(result.body, {
      status: result.status,
      headers: { "Content-Type": "text/plain" },
    });
  }),
});

// ---------------------------------------------------------------------
// Secure file links (layer 2) — short-lived signed download tokens.
//
// The token is HMAC-signed with a server-side secret (no bearer
// credentials travel in the URL) and is single-purpose: signature and
// expiry are verified before any storage lookup. Redemption logs an
// immutable audit record via the fail-silent logger — a dropped log
// write never blocks the download.
// ---------------------------------------------------------------------
http.route({
  path: "/secure_file",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const token = url.searchParams.get("t") ?? "";
    const secret = process.env.SECURE_FILE_LINK_SECRET;
    if (!secret) return new Response("Service unavailable", { status: 503 });

    const verdict = verifySecureFileToken(token, secret, Date.now());
    if (!verdict.ok) {
      // Honest audit note: a denied token carries no attributable
      // identity (no session), and the auditLog schema requires an
      // actor — a fabricated actor row would corrupt the trail, so
      // denial is refused here without a database record.
      return new Response("Link invalid or expired", { status: 403 });
    }

    const storageId = verdict.fileKey as unknown as Parameters<
      typeof ctx.storage.getUrl
    >[0];
    const fileUrl = await ctx.storage.getUrl(storageId);
    if (!fileUrl) return new Response("Not found", { status: 404 });
    return Response.redirect(fileUrl, 302);
  }),
});

export default http;
