# Backups, retention and restore

## What is backed up

- **Database** — Convex runs scheduled snapshots of the production
  deployment (clients, matters, hearings, invoices, audit log, and all
  other tables).
- **Object storage** — uploaded files (scans, PDFs, logos) live in Convex
  file storage and are covered by the platform's storage backup schedule
  together with the database snapshot window.

## Retention

- Daily snapshots are retained for **30 days**.
- Weekly snapshots are retained for **12 months**.
- Chamber-initiated archive exports (JSON) are stored alongside the
  chamber's records and counted in the restore-test register on the
  Settings page until the chamber removes them.

## Restore procedure

1. Raise the restore request with the platform owner, naming the target
   snapshot date and time.
2. The restore is executed into a **non-production environment** first —
   never in place over live data.
3. Verify the restored data: sample clients, matters, hearings, documents
   and the audit log for the requested window.
4. Only after sign-off is the verified snapshot promoted or data migrated
   back into production, with the steps recorded.

## Restore tests

A restore test means actually executing the procedure above against a
real snapshot in a non-production environment and checking the results.
Every executed test is recorded by owners/administrators in **Settings →
Backups & restore → Restore-test register** with the environment, result
and procedure note. Nothing is marked verified automatically.

## Never do this

- No destructive reset (dropping/recreating the deployment) as a way to
  "fix" migration problems. Migrations are forward-only with a verified
  backup taken beforehand.
- No claim of instant remote revocation of content on a disconnected
  device (see Offline Court Mode) — backups do not change that.
