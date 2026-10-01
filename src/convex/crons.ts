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

// Daily AI housekeeping: pending jobs whose runner never resolved are
// marked expired so users see honest failure states, not a stuck spinner.
crons.daily(
  "ai-expire-stale-jobs",
  { hourUTC: 21, minuteUTC: 0 },
  internal.ai.expireStaleJobs,
  {},
);

// Daily legal-source sweep (26.8): scheduler-triggered ingestion tick.
// Opens run rows per registered source (with duplicate prevention) and
// records a legalSweepLogs execution row (trigger=schedule) — the record
// that distinguishes scheduled runs from manual retries. No automated
// fetcher is configured: opened runs are completed by explicit
// authenticated ingestion (scripts/ingest-legal-text.mjs).
crons.daily(
  "legal-source-ingestion-sweep",
  { hourUTC: 18, minuteUTC: 30 }, // 00:00 Asia/Kolkata
  internal.legalIntel.scheduledSweep,
  {},
);

// Daily official-source connector check (turn 17): fetches every
// registered connector notice (currently the Delhi Police official
// reproduction of the POCSO 2012 English text; see
// docs/OFFICIAL_SOURCES.md for the per-channel decision record),
// sequentially and politely. Dedupe means unchanged documents create
// nothing; genuine updates create new versions AND fire opt-in
// matter-impact alerts. Failures are RECORDED, never silently retried,
// and never advance a freshness timestamp.
crons.daily(
  "official-source-connector-sweep",
  { hourUTC: 17, minuteUTC: 45 }, // 23:15 Asia/Kolkata
  internal.sourceConnector.scheduledConnectorSweep,
  {},
);

export default crons;
