import fs from "fs";
const p = "src/convex/billing.ts";
const src = fs.readFileSync(p, "utf8");
const reconcileStart = `/**
 * Idempotently apply a verified payment.captured / payment_link.paid
 * event. The event id is the dedupe key: replays are recorded but never
 * double-applied.
 */`;
const refundMarker = `/** Refund a provider payment through Razorpay (where supported). */`;
const outstandingMarker = `/** Outstanding (unpaid, non-cancelled) invoices for the dashboard. */`;

const iStart = src.indexOf(reconcileStart);
const iRefund = src.indexOf(refundMarker);
const iOutstanding = src.indexOf(outstandingMarker);
if (iStart === -1 || iRefund === -1 || iOutstanding === -1) { console.error("ANCHOR_MISSING", {iStart, iRefund, iOutstanding}); process.exit(1); }
if (iRefund < iStart || iOutstanding < iRefund) { console.error("ANCHOR_ORDER_WRONG"); process.exit(1); }

const newReconcile = fs.readFileSync(".tmp-splices/new_reconcile.txt", "utf8").trimEnd();
const newRefunds = fs.readFileSync(".tmp-splices/new_refunds.txt", "utf8").trimEnd();

const out =
  src.slice(0, iStart) +
  newReconcile + "\n\n" +
  newRefunds + "\n\n" +
  src.slice(iOutstanding);
fs.writeFileSync(p, out);
console.log("SPLICE_OK", out.length);
