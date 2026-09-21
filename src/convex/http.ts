import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { auth } from "./auth";
import { internal } from "./_generated/api";

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

export default http;
