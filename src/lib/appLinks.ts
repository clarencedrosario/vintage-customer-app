// =====================================================================
// Link base resolution — the production domain is CONFIGURATION, not code.
//
// The app currently runs on the platform preview origin and owns no
// domain. Every shareable link (platform-workforce invitations, intake
// completion, client/employee invites, owner-console entry points) is
// therefore composed from this helper:
//   1. VITE_PUBLIC_APP_URL — set it later (project env/Keys config) to
//      whatever production domain gets purchased/connected; nothing else
//      changes.
//   2. window.location.origin — the running preview/dev origin (fallback
//      and default). A link generated in the preview always opens the
//      preview.
// In-app navigation (React Router <Link> / navigate) stays RELATIVE and
// never uses this helper.
//
// REBUILD REQUIREMENT: VITE_PUBLIC_APP_URL is injected by Vite at BUILD
// time (it becomes a literal inside the shipped JS bundle). Changing it —
// via the platform env/Keys UI or .env — takes effect only after the
// frontend is REBUILT and REDEPLOYED. Server-side Convex env vars (set via
// `bunx convex env set`) are unrelated and need no rebuild. In practice:
// connect the production domain → set VITE_PUBLIC_APP_URL → redeploy the
// frontend; then all newly generated shareable links use the new origin.
// =====================================================================

/**
 * Test/programmatic override for the configured link base. Non-null makes
 * appOrigin() behave exactly as if VITE_PUBLIC_APP_URL were set to this
 * value ("" behaves as unset). Production code never touches this.
 */
let _configOverride: string | null = null;

/** Test hook: force the configured link base (null clears the override). */
export function __setConfiguredBaseForTests(value: string | null): void {
  _configOverride = value;
}

function configuredBase(): string {
  if (_configOverride !== null) return _configOverride;
  // Read the env var through a narrow cast: this module is also compiled
  // under the tests tsconfig, which does not load vite/client's
  // ImportMeta.env declaration (same cast approach as import.meta.glob
  // elsewhere in the repo). Vite injects import.meta.env statically, so
  // runtime stubbing never affects it — hence the explicit override hook.
  const env = (
    import.meta as unknown as { env?: Record<string, string | undefined> }
  ).env;
  return String(env?.VITE_PUBLIC_APP_URL ?? "").trim();
}

/**
 * The origin that shareable links are built on. Configurable for a future
 * production domain via VITE_PUBLIC_APP_URL; falls back to the current
 * preview origin so the running app always links to itself.
 */
export function appOrigin(): string {
  const configured = configuredBase();
  if (configured) {
    // Scheme check runs on the trimmed value BEFORE any slash stripping,
    // so a degenerate value like "http://" fails to parse and falls back
    // instead of mutating into a bogus host. Trailing slashes, paths,
    // query and hash are normalized away by URL parsing itself.
    const withScheme = /^https?:\/\//i.test(configured)
      ? configured
      : `https://${configured}`;
    try {
      return new URL(withScheme).origin;
    } catch {
      // Unparseable value: fall through to the live origin.
    }
  }
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return "";
}

/** Absolute URL for an in-app path, e.g. appLink("/owner"). */
export function appLink(path: string): string {
  return `${appOrigin()}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Post-authentication redirect guard (open-redirect safe).
 *
 * Distinct concern from appLink(): auth redirects must stay RELATIVE,
 * same-origin paths — an absolute or scheme-relative value in `?returnTo=`
 * would send the freshly authenticated session elsewhere. Shareable links
 * (appLink) are the opposite: always absolute, built on appOrigin().
 * Returns the fallback (default "/dashboard") for anything not a plain
 * internal path.
 */
export function safeInternalPath(
  value: string | null | undefined,
  fallback = "/dashboard",
): string {
  // Browsers normalize "\\" to "/" in URLs, so ANY backslash is treated as
  // hostile ("/x\\evil.example" must never masquerade as a path). Genuine
  // router paths in this app contain no backslashes.
  if (
    value &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("\\")
  ) {
    return value;
  }
  return fallback;
}
