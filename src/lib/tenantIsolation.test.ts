import { describe, expect, it } from "vitest";
import {
  TENANT_IDENTITY_FIELDS,
  resolveTenant,
  rowBelongsToTenant,
} from "./tenantIsolation";

// Layer 1 — tenant isolation decision rules (the exact functions
// convex/middleware/security.ts runs before any data access).

describe("resolveTenant", () => {
  it("refuses anonymous callers before anything else", () => {
    const v = resolveTenant(null, { documentId: "d1" });
    expect(v.allowed).toBe(false);
    if (!v.allowed) expect(v.reason).toMatch(/sign in/i);
  });

  it("refuses signed-in users with no active organization", () => {
    const v = resolveTenant({ userId: "u1", organizationId: null }, {});
    expect(v.allowed).toBe(false);
    if (!v.allowed) expect(v.reason).toMatch(/organization/i);
  });

  it("resolves the tenant from the verified session only", () => {
    const v = resolveTenant({ userId: "u1", organizationId: "orgA" }, {});
    expect(v.allowed).toBe(true);
    if (v.allowed) {
      expect(v.tenant).toEqual({ userId: "u1", organizationId: "orgA" });
    }
  });

  it("strips every client-supplied identity field from the payload", () => {
    const v = resolveTenant(
      { userId: "u1", organizationId: "orgA" },
      {
        tenantId: "forged",
        organization_id: "forged",
        orgId: "forged",
        documentId: "real-id",
        limit: 5,
      },
    );
    expect(v.allowed).toBe(true);
    if (v.allowed) {
      expect(v.sanitizedArgs).toEqual({ documentId: "real-id", limit: 5 });
      for (const field of TENANT_IDENTITY_FIELDS) {
        expect(Object.keys(v.sanitizedArgs)).not.toContain(field);
      }
    }
  });

  it("leaves ordinary args untouched", () => {
    const v = resolveTenant(
      { userId: "u1", organizationId: "orgA" },
      { search: "agreement", kind: "document" },
    );
    expect(v.allowed).toBe(true);
    if (v.allowed) {
      expect(v.sanitizedArgs).toEqual({ search: "agreement", kind: "document" });
    }
  });
});

describe("rowBelongsToTenant (defense-in-depth)", () => {
  const tenant = { userId: "u1", organizationId: "orgA" };

  it("accepts rows owned by the resolved tenant", () => {
    expect(rowBelongsToTenant({ orgId: "orgA" }, tenant)).toBe(true);
  });

  it("denies cross-tenant rows and missing rows", () => {
    expect(rowBelongsToTenant({ orgId: "orgB" }, tenant)).toBe(false);
    expect(rowBelongsToTenant(null, tenant)).toBe(false);
    expect(rowBelongsToTenant(undefined, tenant)).toBe(false);
    expect(rowBelongsToTenant({}, tenant)).toBe(false);
  });
});
