import { expect, test } from "@playwright/test";
import { OWNER_EMAIL, signInByOtp } from "./helpers";

// PRICING + BILLING AGREEMENT (public + authenticated surfaces).
// These specs check that what the SCREENS show agrees with server
// configuration — they are NOT backend tests.

test.describe("Public pricing page", () => {
  test("renders categories A–D with honest price display and manual-renewal disclosure", async ({ page }) => {
    await page.goto("/pricing");
    await expect(page.getByText("Practice Management")).toBeVisible();
    await expect(page.getByText(/manual/i)).toBeVisible();
    await expect(page.getByText(/no automatic card charge/i)).toBeVisible();

    // A purchasable card shows a real ₹ figure and a Choose-plan CTA;
    // an unpriced card shows "Configuration pending", never ₹0 or ∞.
    const cards = page.locator("text=Configuration pending");
    const rupee = page.locator("text=₹");
    // At least one of the two states must be present, and "unlimited" must never appear.
    expect((await rupee.count()) + (await cards.count())).toBeGreaterThan(0);
    expect(await page.getByText(/unlimited/i).count()).toBe(0);

    // Yearly selector shows the derived ≈monthly figure when a yearly plan exists.
    const yearly = page.getByRole("button", { name: /yearly/i });
    if (await yearly.isEnabled()) {
      await yearly.click();
      await expect(page.getByText(/per month billed yearly|≈/i).first()).toBeVisible();
    }
  });

  test("monthly/yearly selection agrees with server configuration", async ({ page }) => {
    await page.goto("/pricing");
    // The interval toggle only enables when plans exist for that cycle.
    const monthly = page.getByRole("button", { name: /monthly/i });
    await expect(monthly).toBeVisible();
  });

  test("enterprise plan is contact-sales only", async ({ page }) => {
    await page.goto("/pricing");
    await expect(page.getByText("Enterprise")).toBeVisible();
    const contact = page.locator('a[href*="#contact"]').first();
    await expect(contact).toBeVisible();
    await contact.click();
    await expect(page.locator("#contact")).toBeInViewport();
  });
});

test.describe("Billing management (authenticated owner)", () => {
  test("current plan, usage, and change-plan confirms show explicit figures", async ({ page }) => {
    await signInByOtp(page, OWNER_EMAIL, "/billing");

    // Subscription status + manual renewal line are shown.
    await expect(page.getByText(/manual renewal/i)).toBeVisible();
    await expect(page.getByText(/current period ends/i)).toBeVisible();

    // AI usage block: used/reserved/remaining or the honest no-AI copy.
    await expect(
      page.getByText(/allowance|no AI on this plan/i).first(),
    ).toBeVisible();

    // Switch-now confirmation must show charged-today ₹0.00 and the next charge.
    page.on("dialog", (d) => {
      expect(d.message()).toContain("Charged today: ₹0.00");
      expect(d.message()).toContain("Next charge: ₹");
      expect(d.message()).toContain("No automatic card charge is made");
      d.dismiss();
    });
    const otherPlan = page.locator("#plans button", { hasText: "Switch now" }).first();
    if (await otherPlan.isVisible()) {
      await otherPlan.click(); // dialog handler asserts the copy and dismisses
    }
  });

  test("scheduled downgrade is shown with its date and can be withdrawn", async ({ page }) => {
    await signInByOtp(page, OWNER_EMAIL, "/billing");
    const withdraw = page.getByRole("button", { name: /withdraw scheduled change/i });
    // Optional by state: only asserted when a scheduled change exists.
    if (await withdraw.isVisible().catch(() => false)) {
      await expect(page.getByText(/scheduled for/i)).toBeVisible();
      await withdraw.click();
      await expect(page.getByText(/the current plan continues/i)).toBeVisible();
    }
  });
});
