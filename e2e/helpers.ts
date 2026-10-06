// Shared E2E environment contract.
//
// TEST IDENTITIES (create in the target deployment before running):
//   owner@e2e-advokate.test   — firm OWNER on plan "practice_ai" (AI enabled)
//   associate@e2e-advokate.test — associate on the same matter
//   clerk@e2e-advokate.test   — support_staff (restricted access) on the same matter
//   client@e2e-advokate.test  — portal client on the same matter
//
// Login is EMAIL OTP: each sign-in emails a 6-digit code. The runner must
// supply the codes via E2E_OTP_JSON (a JSON map email→code) — retrieve
// them from the mail host for the test domain, or point the deployment's
// OTP sender at a catch-all inbox you can read programmatically.

export const OWNER_EMAIL = process.env.E2E_OWNER_EMAIL ?? "owner@e2e-advokate.test";
export const ASSOCIATE_EMAIL = process.env.E2E_ASSOCIATE_EMAIL ?? "associate@e2e-advokate.test";
export const CLERK_EMAIL = process.env.E2E_CLERK_EMAIL ?? "clerk@e2e-advokate.test";
export const CLIENT_EMAIL = process.env.E2E_CLIENT_EMAIL ?? "client@e2e-advokate.test";

export function otpCodeFor(email: string): string {
  const raw = process.env.E2E_OTP_JSON;
  if (!raw) {
    throw new Error(
      "E2E_OTP_JSON is required: a JSON map of { email: 6-digit-code } captured from the OTP mail host.",
    );
  }
  const map = JSON.parse(raw) as Record<string, string>;
  const code = map[email];
  if (!code || !/^\d{6}$/.test(code)) {
    throw new Error(`No 6-digit OTP captured for ${email} in E2E_OTP_JSON.`);
  }
  return code;
}

/** Sign in through the real /login flow (email OTP), preserving path. */
export async function signInByOtp(
  page: import("@playwright/test").Page,
  email: string,
  returnTo = "/dashboard",
) {
  await page.goto(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  await page.getByLabel(/email/i).fill(email);
  await page.getByRole("button", { name: /send|continue|sign in/i }).click();
  await page.getByLabel(/code|otp/i).fill(otpCodeFor(email));
  await page.getByRole("button", { name: /verify|sign in/i }).click();
  await page.waitForURL(returnTo);
}
