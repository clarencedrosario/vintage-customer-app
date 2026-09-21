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

export default http;
