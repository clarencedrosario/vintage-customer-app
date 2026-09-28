// =====================================================================
// Link base resolution — the production domain is CONFIGURATION, not code.
//
// The app currently runs on the platform preview origin and owns no
// domain. Every shareable link (platform-workforce invitations, intake
// completion, owner-console entry points) is therefore composed from this
// helper:
//   1. VITE_PUBLIC_APP_URL — set it later (project env/Keys config) to
//      whatever production domain gets purchased/connected; nothing else
//      changes.
//   2. window.location.origin — the running preview/dev origin (fallback
//      and default). A link generated in the preview always opens the
//      preview.
// In-app navigation (React Router <Link> / navigate) stays RELATIVE and
// never uses this helper.
// =====================================================================

/**
 * The origin that shareable links are built on. Configurable for a future
 * production domain via VITE_PUBLIC_APP_URL; falls back to the current
 * preview origin so the running app always links to itself.
 */
export function appOrigin(): string {
  const configured = String(
    import.meta.env.VITE_PUBLIC_APP_URL ?? "",
  )
    .trim()
    .replace(/\/+$/, "");
  if (configured) {
    // Accept values with or without a scheme; normalize to a bare origin.
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
