import { describe, expect, it } from "vitest";
import type { Doc, Id } from "./_generated/dataModel";
import type { OrgRole } from "./schema";
import {
  DEFAULT_PERMISSIONS,
  canViewDocument,
  canViewMatter,
  isSubscriptionReadOnly,
  normalizePermissions,
  type Capability,
  type PolicyAccessContext,
} from "./accessPolicy";

// ---------------------------------------------------------------------
// Multi-tenant denial fixture (section 30 / ACCEPTANCE item 8)
//
// Two organizations, two matters, two documents. The pure policy rules
// exercised here are the exact functions access.ts delegates to on every
// query and mutation, so a denial at this layer is a denial on the
// server. What this fixture cannot cover — live authentication, the
// ctx-bound membership lookup in getAccessContext, and real network
// calls — is stated in docs/ACCEPTANCE.md rather than claimed here.
//
// Row shapes: the policy reads only `orgId`/`teamIds` (matters) and
// `visibility` (documents). The fixture supplies the schema-required
// identity fields and casts the rest; Convex validators enforce full
// row shapes at write time.
// ---------------------------------------------------------------------

const ORG_A = "orgA0000000000000000000" as Id<"organizations">;
const ORG_B = "orgB0000000000000000000" as Id<"organizations">;

const JUNIOR_A = "userJuniorA0000000000" as Id<"users">;
const PARTNER_A = "userPartnerA00000000" as Id<"users">;
const ACCOUNTANT_A = "userAcctA0000000000" as Id<"users">;
const PARALEGAL_A = "userParaA0000000000" as Id<"users">;
const TEAMMATE = "userTeammateA0000000" as Id<"users">;

function ac(
  role: OrgRole,
  userId: Id<"users">,
  orgId: Id<"organizations"> = ORG_A,
  status: "active" | "invited" | "suspended" = "active",
): PolicyAccessContext {
  return {
    user: { _id: userId },
    org: { _id: orgId },
    membership: { orgRole: role, status },
    permissions: new Set<Capability>(DEFAULT_PERMISSIONS[role]),
  };
}

function matter(
  orgId: Id<"organizations">,
  teamIds?: Id<"users">[],
): Doc<"matters"> {
  return {
    _id: `matter_${orgId}_${teamIds?.length ?? 0}` as unknown as Id<"matters">,
    _creationTime: 0,
    orgId,
    clientId: "clientFix" as unknown as Id<"clients">,
    reference: "ADV/FIXTURE/0001",
    title: "Fixture matter",
    practiceArea: "civil",
    status: "open",
    createdBy: JUNIOR_A,
    createdAt: 0,
    updatedAt: 0,
    teamIds,
  } as Doc<"matters">;
}

function document(
  matterId: Id<"matters">,
  visibility: "internal" | "shared_with_client",
): Doc<"matterDocuments"> {
  return {
    _id: `doc_${matterId}_${visibility}` as unknown as Id<"matterDocuments">,
    _creationTime: 0,
    matterId,
    uploaderId: PARTNER_A,
    name: "Fixture document.pdf",
    kind: "document",
    visibility,
    createdAt: 0,
  } as Doc<"matterDocuments">;
}

describe("cross-organization denial (two tenants)", () => {
  const matterB = matter(ORG_B);

  it("denies the strongest role (owner of org A) org B's matter", () => {
    expect(canViewMatter(ac("owner", PARTNER_A, ORG_A), matterB)).toBe(false);
  });

  it("denies org B's matter to every other org A role", () => {
    for (const role of [
      "partner",
      "senior_associate",
      "associate",
      "junior",
      "paralegal",
      "accountant",
      "administrator",
      "support_staff",
    ] as OrgRole[]) {
      expect(canViewMatter(ac(role, JUNIOR_A, ORG_A), matterB)).toBe(false);
    }
  });

  it("denies org B's documents even when the row is handed over directly", () => {
    const acOwner = ac("owner", PARTNER_A, ORG_A);
    expect(canViewDocument(acOwner, document(matterB._id, "shared_with_client"), matterB)).toBe(
      false,
    );
    expect(canViewDocument(acOwner, document(matterB._id, "internal"), matterB)).toBe(false);
  });

  it("still allows org A members their own org's matter", () => {
    const own = matter(ORG_A);
    expect(canViewMatter(ac("owner", PARTNER_A, ORG_A), own)).toBe(true);
    expect(canViewMatter(ac("junior", JUNIOR_A, ORG_A), own)).toBe(true);
  });
});

describe("matter-level team restriction (same org)", () => {
  const restricted = matter(ORG_A, [TEAMMATE, PARTNER_A]);

  it("denies a view_all role that is not on the team list", () => {
    expect(canViewMatter(ac("junior", JUNIOR_A), restricted)).toBe(false);
  });

  it("allows a view_all role listed on the team", () => {
    expect(canViewMatter(ac("junior", TEAMMATE), restricted)).toBe(true);
  });

  it("owner/partner/administrator see restricted matters without a listing", () => {
    expect(canViewMatter(ac("owner", PARTNER_A), restricted)).toBe(true);
    expect(canViewMatter(ac("administrator", JUNIOR_A), restricted)).toBe(true);
  });
});

describe("document visibility (same org)", () => {
  const own = matter(ORG_A);
  const internal = document(own._id, "internal");
  const shared = document(own._id, "shared_with_client");

  it("internal documents require document.view_internal (accountant lacks it)", () => {
    const acct = ac("accountant", ACCOUNTANT_A);
    expect(canViewMatter(acct, own)).toBe(true); // can open the matter…
    expect(canViewDocument(acct, internal, own)).toBe(false); // …not this document
  });

  it("paralegal holds document.view_internal and may read internal documents", () => {
    expect(canViewDocument(ac("paralegal", PARALEGAL_A), internal, own)).toBe(true);
  });

  it("shared documents are readable by anyone who can open the matter", () => {
    expect(canViewDocument(ac("accountant", ACCOUNTANT_A), shared, own)).toBe(true);
  });
});

describe("support-staff ceiling (editable permissions cannot escalate)", () => {
  it("strips broad matter/document/billing/admin capabilities from overrides", () => {
    const granted = normalizePermissions("support_staff", [
      "matter.view_all",
      "client.view_all",
      "document.view_internal",
      "document.upload",
      "billing.invoice",
      "billing.payment",
      "team.manage",
      "permissions.edit",
      "matter.create",
      "matter.close",
      // permitted narrow pair:
      "task.manage",
      "note.write",
    ]);
    expect(granted).toEqual(["task.manage", "note.write"]);
  });

  it("never grants integrations.manage or conflict.override to support staff", () => {
    const granted = normalizePermissions("support_staff", [
      "integrations.manage",
      "conflict.override",
      "task.manage",
    ]);
    expect(granted).toEqual(["task.manage"]);
  });

  it("drops unknown capability strings instead of throwing", () => {
    const granted = normalizePermissions("associate", [
      "task.manage",
      "not_a_real_capability",
    ]);
    expect(granted).toEqual(["task.manage"]);
  });

  it("keeps every requested capability for non-support roles", () => {
    const granted = normalizePermissions("associate", [
      "matter.view_all",
      "billing.invoice",
    ]);
    expect(granted).toEqual(["matter.view_all", "billing.invoice"]);
  });

  it("grants integrations.manage to owner/partner/administrator defaults only", () => {
    expect(DEFAULT_PERMISSIONS.owner).toContain("integrations.manage");
    expect(DEFAULT_PERMISSIONS.partner).toContain("integrations.manage");
    expect(DEFAULT_PERMISSIONS.administrator).toContain("integrations.manage");
    for (const role of [
      "senior_associate",
      "associate",
      "junior",
      "paralegal",
      "accountant",
      "support_staff",
    ] as OrgRole[]) {
      expect(DEFAULT_PERMISSIONS[role]).not.toContain("integrations.manage");
    }
  });

  it("lets a non-support role be granted integrations.manage by override", () => {
    const granted = normalizePermissions("senior_associate", [
      "matter.view_all",
      "integrations.manage",
    ]);
    expect(granted).toContain("integrations.manage");
  });
});

describe("subscription read-only gate (section 24)", () => {
  const now = 1_700_000_000_000;

  it("allows writes with no subscription or an active one", () => {
    expect(isSubscriptionReadOnly(undefined, now)).toBe(false);
    expect(isSubscriptionReadOnly({ status: "active" }, now)).toBe(false);
    expect(isSubscriptionReadOnly({ status: "trialing" }, now)).toBe(false);
  });

  it("blocks writes once grace expires, not during grace", () => {
    expect(
      isSubscriptionReadOnly({ status: "grace", graceUntil: now - 1 }, now),
    ).toBe(true);
    expect(
      isSubscriptionReadOnly({ status: "grace", graceUntil: now + 1 }, now),
    ).toBe(false);
  });

  it("blocks writes after a cancellation takes effect, not before", () => {
    expect(
      isSubscriptionReadOnly({ status: "cancelled", cancelAt: now - 1 }, now),
    ).toBe(true);
    expect(
      isSubscriptionReadOnly({ status: "cancelled", cancelAt: now + 1 }, now),
    ).toBe(false);
  });

  it("blocks writes for explicit read_only and closed states", () => {
    expect(isSubscriptionReadOnly({ status: "read_only" }, now)).toBe(true);
    expect(isSubscriptionReadOnly({ status: "closed" }, now)).toBe(true);
  });
});
