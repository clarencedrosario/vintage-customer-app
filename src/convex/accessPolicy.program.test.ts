import { describe, expect, it } from "vitest";
import type { Doc, Id } from "./_generated/dataModel";
import type { OrgRole } from "./schema";
import {
  CAPABILITIES,
  DEFAULT_PERMISSIONS,
  canManageFinance,
  canManageHr,
  canViewSalaryRecord,
  isSubscriptionReadOnly,
  normalizePermissions,
  type Capability,
  type PolicyAccessContext,
} from "./accessPolicy";

// ---------------------------------------------------------------------
// Phase 1 foundation policy tests (HR / Payroll / Accounting capabilities).
//
// Pure-function coverage of the new 2026-expansion capability keys:
// normalization cannot escalate support staff, salary records are
// capability-gated with org isolation, and the new grants default to
// exactly the roles the program intends — no accidental widening.
// ---------------------------------------------------------------------

const ORG_A = "orgA0000000000000000000" as Id<"organizations">;
const ORG_B = "orgB0000000000000000000" as Id<"organizations">;
const USER_A = "userA000000000000000000" as Id<"users">;
const USER_B = "userB000000000000000000" as Id<"users">;

function ac(
  role: OrgRole,
  userId: Id<"users"> = USER_A,
  orgId: Id<"organizations"> = ORG_A,
  permissions?: Capability[],
): PolicyAccessContext {
  return {
    user: { _id: userId },
    org: { _id: orgId },
    membership: { orgRole: role, status: "active" },
    permissions: new Set<Capability>(permissions ?? DEFAULT_PERMISSIONS[role]),
  };
}

// Test that only the roles that should carry a grant carry it.
function expectGrant(
  cap: Capability,
  expectedRoles: OrgRole[],
  notRoles: OrgRole[] = [],
) {
  for (const role of expectedRoles) {
    expect(
      DEFAULT_PERMISSIONS[role].includes(cap),
      `${role} should default to ${cap}`,
    ).toBe(true);
  }
  for (const role of notRoles) {
    expect(
      DEFAULT_PERMISSIONS[role].includes(cap),
      `${role} should NOT default to ${cap}`,
    ).toBe(false);
  }
}

const PROGRAM_CAPS: Capability[] = [
  "hr.manage",
  "hr.view_own",
  "hr.view_salary",
  "hr.approve",
  "hr.recruit",
  "payroll.run",
  "payroll.approve",
  "finance.view",
  "finance.manage",
  "pm.manage",
  "pm.view_all",
];

describe("new capability keys are registered", () => {
  it("registers every program capability in CAPABILITIES", () => {
    for (const cap of PROGRAM_CAPS) {
      expect(CAPABILITIES).toContain(cap);
    }
  });

  it("includes every capability in the owner default set", () => {
    expect(new Set(DEFAULT_PERMISSIONS.owner).size).toBe(CAPABILITIES.length);
    for (const cap of CAPABILITIES) {
      expect(DEFAULT_PERMISSIONS.owner).toContain(cap);
    }
  });
});

describe("default grants for HR capabilities", () => {
  it("hr.manage is owner/partner/administrator only", () => {
    expectGrant(
      "hr.manage",
      ["owner", "partner", "administrator"],
      [
        "senior_associate",
        "associate",
        "junior",
        "paralegal",
        "accountant",
        "support_staff",
      ],
    );
  });

  it("hr.view_own covers every role (self-service everywhere)", () => {
    const allRoles: OrgRole[] = [
      "owner",
      "partner",
      "senior_associate",
      "associate",
      "junior",
      "paralegal",
      "accountant",
      "administrator",
      "support_staff",
    ];
    for (const role of allRoles) {
      expect(DEFAULT_PERMISSIONS[role]).toContain("hr.view_own");
    }
  });

  it("salary visibility defaults only to owner/partner/administrator", () => {
    expectGrant(
      "hr.view_salary",
      ["owner", "partner", "administrator"],
      [
        "senior_associate",
        "associate",
        "junior",
        "paralegal",
        "accountant",
        "support_staff",
      ],
    );
  });

  it("accountant gets finance and payroll-run, not HR or salary", () => {
    expectGrant("finance.view", ["owner", "partner", "accountant"]);
    expectGrant("finance.manage", ["owner", "partner", "accountant"]);
    expectGrant("payroll.run", ["owner", "partner", "accountant"]);
    expect(DEFAULT_PERMISSIONS.accountant).not.toContain("hr.view_salary");
    expect(DEFAULT_PERMISSIONS.accountant).not.toContain("hr.manage");
  });
});

describe("canViewSalaryRecord", () => {
  it("denies a foreign-org employee row even for an owner", () => {
    // Viewer in ORG_A (owner defaults), employee row in ORG_B.
    expect(
      canViewSalaryRecord(ac("owner"), ORG_B, USER_B),
    ).toBe(false);
  });

  it("allows a partner with hr.view_salary to read others", () => {
    expect(canViewSalaryRecord(ac("partner"), ORG_A, USER_B)).toBe(true);
  });

  it("denies an associate without hr.view_salary reading others", () => {
    expect(canViewSalaryRecord(ac("associate"), ORG_A, USER_B)).toBe(false);
  });

  it("grants grantee reads own row only with hr.view_own", () => {
    // Support staff: no hr.view_salary, but self-service via hr.view_own.
    const self = ac("support_staff", USER_A, ORG_A, ["hr.view_own"]);
    const withoutSelfService = ac("support_staff", USER_A, ORG_A, []);
    expect(canViewSalaryRecord(self, ORG_A, USER_A)).toBe(true);
    expect(canViewSalaryRecord(withoutSelfService, ORG_A, USER_A)).toBe(false);
    expect(canViewSalaryRecord(self, ORG_A, USER_B)).toBe(false);
  });

  it("same user id in a foreign org is still denied", () => {
    // Org isolation precedes self-service: USER_A's row in ORG_B is not
    // USER_A's row in ORG_A.
    expect(canViewSalaryRecord(ac("owner", USER_A, ORG_A), ORG_B, USER_A)).toBe(
      false,
    );
  });

  it("removing the grant removes the access even for owners", () => {
    // The grant is per-organization and editable; a role is not a bypass.
    const ownerWithout = ac("owner", USER_A, ORG_A, []);
    expect(canViewSalaryRecord(ownerWithout, ORG_A, USER_B)).toBe(false);
  });
});

describe("write-authority helpers", () => {
  it("canManageHr/canManageFinance follow the capability, not the role", () => {
    expect(canManageHr(ac("owner"))).toBe(true);
    expect(canManageHr(ac("associate"))).toBe(false);
    expect(canManageHr(ac("associate", USER_A, ORG_A, ["hr.manage"]))).toBe(
      true,
    );
    expect(canManageFinance(ac("accountant"))).toBe(true);
    expect(canManageFinance(ac("support_staff"))).toBe(false);
  });
});

describe("support_staff cannot be escalated into program capabilities", () => {
  it("normalizePermissions strips every sensitive program capability", () => {
    const requested: string[] = [
      ...PROGRAM_CAPS,
      "billing.invoice",
      "matter.view_all",
      "task.manage",
      "note.write",
    ];
    const cleaned = normalizePermissions("support_staff", requested);
    for (const cap of [
      "hr.manage",
      "hr.view_salary",
      "hr.approve",
      "hr.recruit",
      "payroll.run",
      "payroll.approve",
      "finance.view",
      "finance.manage",
      "pm.manage",
      "pm.view_all",
    ] as Capability[]) {
      expect(cleaned).not.toContain(cap);
    }
    // Self-service and task/note privileges survive.
    expect(cleaned).toContain("hr.view_own");
    expect(cleaned).toContain("task.manage");
  });

  it("keeps dropping unknown capability strings", () => {
    const cleaned = normalizePermissions("owner", [
      "hr.manage",
      "nonsense.capability",
    ]);
    expect(cleaned).toEqual(["hr.manage"]);
  });
});

describe("regression: existing policy invariants hold", () => {
  it("subscription read-only gate still denies writes past grace", () => {
    expect(
      isSubscriptionReadOnly(
        { status: "grace", graceUntil: 1000 } as never,
        2000,
      ),
    ).toBe(true);
    expect(
      isSubscriptionReadOnly({ status: "active" } as never, 2000),
    ).toBe(false);
  });

  it("support staff still cannot gain billing capabilities", () => {
    const cleaned = normalizePermissions("support_staff", ["billing.payment"]);
    expect(cleaned).not.toContain("billing.payment");
  });
});
