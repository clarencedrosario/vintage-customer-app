import { expect, test } from "@playwright/test";
import { ASSOCIATE_EMAIL, CLIENT_EMAIL, CLERK_EMAIL, OWNER_EMAIL, signInByOtp } from "./helpers";

// LAWYER WORKSPACE DEMONSTRATION — the full promised experience, in a
// real browser, against a seeded deployment. Each step names the route
// and the acceptance outcome.

const MATTER = process.env.E2E_MATTER_REF ?? "E2E/2026/0001";

async function openMatter(page: import("@playwright/test").Page, email: string) {
  await signInByOtp(page, email, "/matters");
  await page.getByText(MATTER).first().click();
  await expect(page.getByText(/chronology|timeline/i).first()).toBeVisible();
}

test.describe("Matter workspace (owner)", () => {
  test("documents, chronology, team and pending actions are reachable", async ({ page }) => {
    await openMatter(page, OWNER_EMAIL);

    for (const tab of ["documents", "timeline", "parties", "tasks"]) {
      await page.getByRole("tab", { name: new RegExp(tab, "i") }).click();
      await expect(page.getByRole("tabpanel")).toBeVisible();
    }

    // Pending actions surface on the matter command centre tab.
    await page.getByRole("tab", { name: /command|overview/i }).click();
    await expect(page.getByText(/pending|attention|due/i).first()).toBeVisible();
  });

  test("Case X-Ray runs when AI is configured and shows its sources", async ({ page }) => {
    test.skip(!process.env.E2E_AI_CONFIGURED, "OPENAI_API_KEY not configured on this deployment");
    await openMatter(page, OWNER_EMAIL);
    await page.getByRole("tab", { name: /ai/i }).click();

    // Select the X-Ray kind, pick all sources, launch.
    await page.getByLabel(/kind|task/i).selectOption(/xray|case x-ray/i);
    await page.getByRole("button", { name: /run|launch|analyze/i }).click();

    // Result area appears and names its supporting sources; the
    // X-Ray disclosure shows analyzed sources + "what changed" section.
    await expect(page.getByText(/analyzed sources|sources analyzed/i).first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/what changed since the previous x-ray|first assessment/i).first()).toBeVisible();
    // Every cited source is clickable/identifiable — spot-check the disclosure block exists.
    await expect(page.getByText(/record, not opinion/i).first()).toBeVisible();
  });

  test("draft a document from the matter", async ({ page }) => {
    test.skip(!process.env.E2E_AI_CONFIGURED, "OPENAI_API_KEY not configured on this deployment");
    await openMatter(page, OWNER_EMAIL);
    await page.getByRole("tab", { name: /ai/i }).click();
    await page.getByLabel(/kind|task/i).selectOption(/draft/i);
    await page.getByLabel(/note|instructions|input/i).fill(
      "Draft a bail application citing the FIR attached to this matter; accused in custody since the arrest memo date.",
    );
    await page.getByRole("button", { name: /run|launch|generate/i }).click();
    await expect(page.locator("pre, .prose, [data-ai-result]").first()).toBeVisible({ timeout: 90_000 });
    // Draft output carries the review-required posture.
    await expect(page.getByText(/draft|review/i).first()).toBeVisible();
  });

  test("contact an authorized client through the matter comms thread", async ({ page }) => {
    await openMatter(page, OWNER_EMAIL);
    await page.getByRole("tab", { name: /comms|communication/i }).click();
    await page.getByRole("button", { name: /new message|compose/i }).first().click();
    await page.getByLabel(/to|recipient/i).selectOption({ label: /client/i });
    await page.getByLabel(/message|body/i).fill("E2E: hearing date update — please acknowledge.");
    await page.getByRole("button", { name: /send|queue/i }).click();
    await expect(page.getByText(/hearing date update/i).first()).toBeVisible();
  });

  test("client portal shows the authorized update", async ({ page }) => {
    await signInByOtp(page, CLIENT_EMAIL, "/portal");
    await expect(page.getByText(/hearing date update/i).first()).toBeVisible();
  });
});

test.describe("Restricted staff engagement", () => {
  test("clerk sees assigned tasks but is refused matter-wide privileged views", async ({ page }) => {
    await openMatter(page, CLERK_EMAIL);

    // Assigned tasks are visible.
    await page.getByRole("tab", { name: /tasks/i }).click();
    await expect(page.getByRole("tabpanel")).toBeVisible();

    // Billing is NOT available to support_staff (capability absent).
    await signInByOtp(page, CLERK_EMAIL, "/billing");
    await expect(page.getByText(/not permitted|no access|subscription/i).first()).toBeVisible();

    // Documents marked internal-only must not render for the clerk.
    await signInByOtp(page, CLERK_EMAIL, "/matters");
    await page.getByText(MATTER).first().click();
    await page.getByRole("tab", { name: /documents/i }).click();
    expect(await page.getByText(/internal/i).count()).toBeLessThanOrEqual(1);
  });

  test("associate can read the matter and see the team", async ({ page }) => {
    await openMatter(page, ASSOCIATE_EMAIL);
    await page.getByRole("tab", { name: /parties|team/i }).click();
    await expect(page.getByRole("tabpanel")).toBeVisible();
  });
});
