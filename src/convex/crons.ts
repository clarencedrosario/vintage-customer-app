// =====================================================================
// Deployment-supported scheduler (Convex crons). Time-sensitive
// delivery never depends on someone opening the dashboard: every few
// minutes the runner scans for
//   - hearings starting within 24h          -> hearing reminders
//   - deadlines due / on their reminder day -> deadline reminders
//   - invoices past due                     -> invoice follow-ups
// and then executes enabled automation rules. Every notification and
// run row is deduped, so re-scans never double-send.
// =====================================================================

import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Every 5 minutes — hearing/deadline/invoice reminders + automation.
crons.interval(
  "reminder-and-automation-runner",
  { minutes: 5 },
  internal.reminders.runScan,
  {},
);

// Hourly housekeeping: keep any straggler scan state consistent.
crons.interval(
  "automation-rule-rescheduler",
  { minutes: 60 },
  internal.reminders.rescheduleCron,
  {},
);

// Daily SaaS subscription lifecycle: trial expiry, missed renewals,
// grace-period end → read-only (section 24).
crons.daily(
  "saas-subscription-expiry",
  {
    hourUTC: 20, // 01:30 Asia/Kolkata — after the local day has ended.
    minuteUTC: 30,
  },
  internal.subscriptions.runExpiryScan,
  {},
);

export default crons;
