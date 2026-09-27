import { describe, expect, it } from "vitest";
import {
  DEFAULT_PERMISSIONS,
  canViewSalaryRecord,
  normalizePermissions,
} from "./accessPolicy";
import type { PolicyAccessContext } from "./accessPolicy";
import type { Id } from "./_generated/dataModel";

const ORG = "org_A" as Id<"organizations">;
const OTHER_ORG = "org_B" as Id<"organizations">;
const ME = "user_me" as Id<"users">;
const COLLEAGUE = "user_peer" as Id<"users">;

type Role = keyof typeof DEFAULT_PERMISSIONS;

function acFor(
  role: Role,
  userId: Id<"users">,
  orgId: Id<"organizations"> = ORG,
): PolicyAccessContext {
  return {
    user: { _id: userId } as PolicyAccessContext["user"],
    org: { _id: orgId } as PolicyAccessContext["org"],
    membership: { orgRole: role } as PolicyAccessContext["membership"],
    permissions: new Set(DEFAULT_PERMISSIONS[role]),
  };
}

describe("HR capability matrix (defaults per role)", () => {
  it("grants hr.view_own to every role including support_staff", () => {
    for (const role of Object.keys(DEFAULT_PERMISSIONS) as Role[]) {
      expect(DEFAULT_PERMISSIONS[role]).toContain("hr.view_own");
    }
  });

  it("restricts hr.view_salary to HR-authority roles", () => {
    const withSalary = (Object.keys(DEFAULT_PERMISSIONS) as Role[]).filter(
      (role) => DEFAULT_PERMISSIONS[role].includes("hr.view_salary"),
    );
    for (const role of ["owner", "partner", "administrator"]) {
      expect(withSalary).toContain(role);
    }
    expect(withSalary).not.toContain("accountant");
    expect(withSalary).not.toContain("support_staff");
  });

  it("keeps payroll authority on exactly the finance-payroll roles", () => {
    for (const role of ["paralegal", "support_staff"] as const) {
      expect(DEFAULT_PERMISSIONS[role]).not.toContain("payroll.run");
      expect(DEFAULT_PERMISSIONS[role]).not.toContain("payroll.approve");
    }
    expect(DEFAULT_PERMISSIONS.accountant).toContain("payroll.run");
  });

  it("strips sensitive capabilities from a support_staff override", () => {
    const normalized = new Set(
      normalizePermissions("support_staff", [
        "hr.manage",
        "hr.approve",
        "payroll.run",
        "hr.view_salary",
        "finance.manage",
        "hr.view_own",
      ]),
    );
    expect(normalized.has("hr.manage")).toBe(false);
    expect(normalized.has("hr.approve")).toBe(false);
    expect(normalized.has("payroll.run")).toBe(false);
    expect(normalized.has("hr.view_salary")).toBe(false);
    expect(normalized.has("finance.manage")).toBe(false);
    // Self-service stays available.
    expect(normalized.has("hr.view_own")).toBe(true);
  });
});

describe("canViewSalaryRecord (authorization boundary)", () => {
  it("denies a different org regardless of grants", () => {
    const ac = acFor("owner", ME);
    expect(canViewSalaryRecord(ac, OTHER_ORG, COLLEAGUE)).toBe(false);
  });

  it("allows self only via hr.view_own, not as a role bypass", () => {
    const ac = acFor("paralegal", ME);
    expect(canViewSalaryRecord(ac, ORG, ME)).toBe(true); // own row
    expect(canViewSalaryRecord(ac, ORG, COLLEAGUE)).toBe(false); // others
  });

  it("allows a colleague row only with an explicit hr.view_salary grant", () => {
    expect(canViewSalaryRecord(acFor("owner", ME), ORG, COLLEAGUE)).toBe(true);
    expect(
      canViewSalaryRecord(acFor("administrator", ME), ORG, COLLEAGUE),
    ).toBe(true);
    expect(canViewSalaryRecord(acFor("accountant", ME), ORG, COLLEAGUE)).toBe(
      false,
    );
    expect(
      canViewSalaryRecord(acFor("support_staff", ME), ORG, COLLEAGUE),
    ).toBe(false);
    expect(canViewSalaryRecord(acFor("paralegal", ME), ORG, COLLEAGUE)).toBe(
      false,
    );
  });

  it("cannot be restored by claiming a forbidden capability", () => {
    const ac = acFor("support_staff", ME);
    // Even a forged override is normalized back to safe defaults.
    expect(
      normalizePermissions("support_staff", ["hr.view_salary"]),
    ).not.toContain("hr.view_salary");
    expect(canViewSalaryRecord(ac, ORG, COLLEAGUE)).toBe(false);
  });
});
