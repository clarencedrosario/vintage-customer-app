import { ChamberShell } from "@/components/ChamberShell";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/convex/_generated/api";
import { INDIAN_STATES } from "@/lib/format";
import { useMutation, useQuery } from "convex/react";
import { Check, Minus, Upload } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "SGD"];
const TIMEZONES = [
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Europe/London",
  "America/New_York",
];

const CAPABILITY_LABELS: Record<string, string> = {
  "matter.view_all": "View all matters",
  "matter.create": "Open matters",
  "matter.edit": "Edit matters",
  "matter.close": "Close matters",
  "matter.team_restrict": "Restrict matter teams",
  "client.view_all": "View all clients",
  "client.create": "Add clients",
  "client.edit": "Edit clients",
  "hearing.manage": "Manage hearings",
  "order.record": "Record orders",
  "task.manage": "Manage tasks",
  "note.write": "Write notes",
  "document.upload": "Upload documents",
  "document.view_internal": "View internal documents",
  "time.log": "Log time",
  "expense.log": "Log expenses",
  "billing.invoice": "Draft invoices",
  "billing.payment": "Record payments",
  "team.invite": "Invite team & clients",
  "team.manage": "Manage members",
  "permissions.edit": "Edit role permissions",
  "org.edit_profile": "Edit firm profile",
};

export default function Settings() {
  const profile = useQuery(api.orgs.profile);

  return (
    <ChamberShell subtitle="The Digital Chamber" title="Settings">
      {profile === undefined ? (
        <p className="mt-10 text-sm text-muted-foreground">
          Retrieving particulars…
        </p>
      ) : profile === null ? (
        <NoOrganisation />
      ) : (
        <div className="space-y-10">
          <OrgProfileCard key={profile._id} profile={profile} />
          <PermissionsMatrixCard />
          <SecurityCard />
        </div>
      )}
    </ChamberShell>
  );
}

// ---------------------------------------------------------------
// No organisation yet: create one, or wait for an invitation
// ---------------------------------------------------------------

function NoOrganisation() {
  const create = useMutation(api.orgs.createOrganization);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"chamber" | "firm">("chamber");
  const [busy, setBusy] = useState(false);

  return (
    <div className="space-y-8">
      <p className="max-w-2xl text-sm text-muted-foreground">
        You are not an active member of an organisation. Create your own
        chamber or firm — you become its Owner — or accept an invitation from
        an existing organisation.
      </p>
      <Card className="rule-frame max-w-xl bg-card">
        <CardHeader>
          <CardTitle className="font-serif text-2xl">
            Establish your organisation
          </CardTitle>
          <CardDescription>
            An independent chamber or a multi-lawyer firm.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 space-y-2">
              <Label htmlFor="org-name">Name</Label>
              <Input
                id="org-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Rao & Associates"
              />
            </div>
            <div className="space-y-2">
              <Label>Kind</Label>
              <Select
                value={kind}
                onValueChange={(v) => setKind(v as "chamber" | "firm")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="chamber">Independent chamber</SelectItem>
                  <SelectItem value="firm">Law firm</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button
            className="w-full"
            disabled={busy || name.trim().length < 2}
            onClick={async () => {
              setBusy(true);
              try {
                await create({ name: name.trim(), kind });
                toast.success("Organisation created.");
              } catch (err) {
                toast.error(
                  err instanceof Error ? err.message : "Could not create.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Creating…" : "Create organisation"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------
// Organisation profile — identity, address, billing conventions
// ---------------------------------------------------------------

function OrgProfileCard({
  profile,
}: {
  profile: {
    _id: string;
    name: string;
    kind: string;
    logoStorageId?: string | null;
    addressLine1?: string | null;
    addressLine2?: string | null;
    city?: string | null;
    state?: string | null;
    pincode?: string | null;
    gstin?: string | null;
    phone?: string | null;
    email?: string | null;
    website?: string | null;
    currency: string;
    timezone: string;
    financialYearStart: string;
    taxLabel: string;
    taxPercent: number;
    invoicePrefix: string;
    myRole: string;
    canEditProfile: boolean;
  };
}) {
  const logoUrl = useQuery(api.orgs.logoUrl);
  const updateOrg = useMutation(api.orgs.updateOrg);
  const getUploadUrl = useMutation(api.orgs.generateLogoUploadUrl);
  const attachLogo = useMutation(api.orgs.attachLogo);

  const [form, setForm] = useState<Record<string, string>>(() => ({
    name: profile.name,
    addressLine1: profile.addressLine1 ?? "",
    addressLine2: profile.addressLine2 ?? "",
    city: profile.city ?? "",
    state: profile.state ?? "Maharashtra",
    pincode: profile.pincode ?? "",
    gstin: profile.gstin ?? "",
    phone: profile.phone ?? "",
    email: profile.email ?? "",
    website: profile.website ?? "",
    currency: profile.currency,
    timezone: profile.timezone,
    financialYearStart: profile.financialYearStart,
    taxLabel: profile.taxLabel,
    invoicePrefix: profile.invoicePrefix,
  }));
  const [taxPercent, setTaxPercent] = useState(() =>
    String(profile.taxPercent),
  );
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  const canEdit = profile.canEditProfile;
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.name.trim() || form.name.trim().length < 2) {
      toast.error("The organisation name is required.");
      return;
    }
    if (form.pincode && !/^\d{6}$/.test(form.pincode)) {
      toast.error("PIN code must be exactly 6 digits.");
      return;
    }
    if (
      form.gstin &&
      !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]{3}$/.test(form.gstin)
    ) {
      toast.error("That GSTIN does not look valid.");
      return;
    }
    setBusy(true);
    try {
      await updateOrg({
        name: form.name,
        addressLine1: form.addressLine1 || undefined,
        addressLine2: form.addressLine2 || undefined,
        city: form.city || undefined,
        state: form.state || undefined,
        pincode: form.pincode || undefined,
        gstin: form.gstin || undefined,
        phone: form.phone || undefined,
        email: form.email || undefined,
        website: form.website || undefined,
        currency: form.currency,
        timezone: form.timezone,
        financialYearStart: form.financialYearStart,
        taxLabel: form.taxLabel,
        taxPercent: parseFloat(taxPercent) || 0,
        invoicePrefix: form.invoicePrefix,
      });
      toast.success("Organisation profile saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  const handleLogoUpload = async (file: File) => {
    setUploading(true);
    try {
      const url = await getUploadUrl();
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      const { storageId } = (await res.json()) as { storageId: string };
      await attachLogo({ storageId: storageId as never });
      toast.success("Logo updated.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      {/* Identity */}
      <Card className="rule-frame bg-card">
        <CardHeader>
          <CardTitle className="font-serif text-2xl">
            Firm profile &amp; billing identity
          </CardTitle>
          <CardDescription>
            {canEdit
              ? "Particulars shown on invoices and correspondence."
              : `Shown for reference — your role (${profile.myRole}) cannot edit these.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Logo */}
          <div className="flex items-center gap-4">
            <span className="flex size-16 items-center justify-center overflow-hidden rounded-md border border-border bg-muted">
              {logoUrl ? (
                <img
                  src={logoUrl}
                  alt="Firm logo"
                  className="size-full object-contain"
                />
              ) : (
                <span className="font-serif text-xl text-muted-foreground">
                  {(profile.name || "A").slice(0, 1)}
                </span>
              )}
            </span>
            {canEdit && (
              <Label
                htmlFor="org-logo"
                className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted"
              >
                <Upload className="size-4" aria-hidden="true" />
                {uploading ? "Uploading…" : "Upload logo"}
              </Label>
            )}
            <input
              id="org-logo"
              type="file"
              accept="image/*"
              className="sr-only"
              disabled={!canEdit || uploading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleLogoUpload(f);
                e.target.value = "";
              }}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="org-name">Firm / chamber name</Label>
            <Input
              id="org-name"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              disabled={!canEdit}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="org-addr1">Address line 1</Label>
            <Input
              id="org-addr1"
              value={form.addressLine1}
              onChange={(e) => set("addressLine1", e.target.value)}
              placeholder="Chamber No., blocks, street"
              disabled={!canEdit}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="org-addr2">Address line 2</Label>
            <Input
              id="org-addr2"
              value={form.addressLine2}
              onChange={(e) => set("addressLine2", e.target.value)}
              disabled={!canEdit}
            />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2 space-y-2">
              <Label>State</Label>
              <Select
                value={form.state}
                onValueChange={(v) => set("state", v)}
                disabled={!canEdit}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select state" />
                </SelectTrigger>
                <SelectContent>
                  {INDIAN_STATES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="org-pin">PIN</Label>
              <Input
                id="org-pin"
                value={form.pincode}
                onChange={(e) => set("pincode", e.target.value)}
                maxLength={6}
                disabled={!canEdit}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="org-city">City</Label>
              <Input
                id="org-city"
                value={form.city}
                onChange={(e) => set("city", e.target.value)}
                disabled={!canEdit}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="org-gstin">GSTIN</Label>
              <Input
                id="org-gstin"
                value={form.gstin}
                onChange={(e) => set("gstin", e.target.value.toUpperCase())}
                maxLength={15}
                disabled={!canEdit}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="org-phone">Phone</Label>
              <Input
                id="org-phone"
                value={form.phone}
                onChange={(e) => set("phone", e.target.value)}
                disabled={!canEdit}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="org-email">Email</Label>
              <Input
                id="org-email"
                type="email"
                value={form.email}
                onChange={(e) => set("email", e.target.value)}
                disabled={!canEdit}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="org-web">Website</Label>
            <Input
              id="org-web"
              value={form.website}
              onChange={(e) => set("website", e.target.value)}
              placeholder="https://"
              disabled={!canEdit}
            />
          </div>
        </CardContent>
      </Card>

      {/* Billing conventions */}
      <Card className="rule-frame h-fit bg-card">
        <CardHeader>
          <CardTitle className="font-serif text-2xl">
            Billing &amp; conventions
          </CardTitle>
          <CardDescription>
            Currency, timezone, financial year and tax.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Currency</Label>
              <Select
                value={form.currency}
                onValueChange={(v) => set("currency", v)}
                disabled={!canEdit}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Timezone</Label>
              <Select
                value={form.timezone}
                onValueChange={(v) => set("timezone", v)}
                disabled={!canEdit}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIMEZONES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="org-fy">Financial year starts</Label>
              <Input
                id="org-fy"
                value={form.financialYearStart}
                onChange={(e) => set("financialYearStart", e.target.value)}
                placeholder="04-01"
                disabled={!canEdit}
              />
              <p className="text-xs text-muted-foreground">
                MM-DD — 04-01 for the Indian April–March year.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="org-prefix">Invoice prefix</Label>
              <Input
                id="org-prefix"
                value={form.invoicePrefix}
                onChange={(e) =>
                  set("invoicePrefix", e.target.value.toUpperCase())
                }
                maxLength={6}
                disabled={!canEdit}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="org-taxlabel">Tax label</Label>
              <Input
                id="org-taxlabel"
                value={form.taxLabel}
                onChange={(e) => set("taxLabel", e.target.value)}
                disabled={!canEdit}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="org-taxpct">Tax percent</Label>
              <Input
                id="org-taxpct"
                type="number"
                min="0"
                max="50"
                value={taxPercent}
                onChange={(e) => setTaxPercent(e.target.value)}
                disabled={!canEdit}
              />
            </div>
          </div>
          {canEdit && (
            <Button className="w-full" onClick={handleSave} disabled={busy}>
              {busy ? "Saving…" : "Save organisation profile"}
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------
// Permission matrix — documented for everyone, editable per role
// ---------------------------------------------------------------

type MatrixData = {
  canEdit: boolean;
  capabilities: readonly string[];
  roles: {
    role: string;
    label: string;
    defaults: readonly string[];
    effective: readonly string[];
  }[];
};

function PermissionsMatrixCard() {
  const matrix = useQuery(api.workspace.permissionMatrix);
  const setRolePermissions = useMutation(api.workspace.setRolePermissions);
  const [saving, setSaving] = useState<string | null>(null);

  if (matrix === undefined) {
    return (
      <section aria-label="Role permissions">
        <p className="type-label ink-faded">Role Permissions</p>
        <p className="mt-3 text-sm text-muted-foreground">
          Loading the permission matrix…
        </p>
      </section>
    );
  }
  if (matrix === null) return null;

  const m = matrix as MatrixData;

  const toggle = async (role: string, cap: string, enabled: boolean) => {
    const target = m.roles.find((r) => r.role === role);
    if (!target) return;
    const next = enabled
      ? target.effective.filter((c) => c !== cap)
      : [...target.effective, cap];
    setSaving(`${role}:${cap}`);
    try {
      await setRolePermissions({ orgRole: role as never, permissions: next });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(null);
    }
  };

  return (
    <section aria-label="Role permissions">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="type-label ink-faded">Role Permissions</p>
          <h2 className="mt-2 font-serif text-2xl font-semibold tracking-tight">
            Permission matrix
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            What each role may do across this organisation. Every function
            re-checks these server-side. Support staff can never be granted
            lawyers' broad privileges.
          </p>
        </div>
        <span className="stamp text-muted-foreground">
          {m.canEdit ? "Editable" : "Read only"}
        </span>
      </div>

      <div className="mt-5 overflow-x-auto rounded-lg border border-border bg-card">
        <table className="data-table min-w-[820px]">
          <thead>
            <tr>
              <th className="sticky left-0 bg-card">Capability</th>
              {m.roles.map((r) => (
                <th key={r.role} className="text-center">
                  {r.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {m.capabilities.map((cap) => (
              <tr key={cap}>
                <td className="sticky left-0 bg-card text-sm">
                  {CAPABILITY_LABELS[cap] ?? cap}
                </td>
                {m.roles.map((r) => {
                  const has = r.effective.includes(cap);
                  const differs = !r.defaults.includes(cap);
                  const key = `${r.role}:${cap}`;
                  return (
                    <td key={r.role} className="text-center">
                      {m.canEdit ? (
                        <button
                          type="button"
                          disabled={saving === key}
                          aria-label={`${has ? "Revoke" : "Grant"} ${
                            CAPABILITY_LABELS[cap] ?? cap
                          } for ${r.label}`}
                          onClick={() => toggle(r.role, cap, has)}
                          className="inline-flex size-7 items-center justify-center rounded hover:bg-muted"
                        >
                          {has ? (
                            <Check
                              className={`size-4 ${differs ? "text-[#8a6a33]" : "text-emerald-700"}`}
                            />
                          ) : (
                            <Minus className="size-4 text-muted-foreground/40" />
                          )}
                        </button>
                      ) : has ? (
                        <Check
                          className={`mx-auto size-4 ${differs ? "text-[#8a6a33]" : "text-emerald-700"}`}
                        />
                      ) : (
                        <Minus className="mx-auto size-4 text-muted-foreground/40" />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {m.canEdit && (
        <p className="mt-2 text-xs text-muted-foreground">
          Click any cell to grant or revoke. Gold ticks are overrides from this
          organisation's defaults; green ticks are the defaults themselves.
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------
// Security — 2FA enrolment and session control
// ---------------------------------------------------------------

function randomB64(n: number): string {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

function SecurityCard() {
  const status = useQuery(api.twofactor.status);
  const sessions = useQuery(api.sessions.activeSessions);
  const start = useMutation(api.twofactor.startEnrollment);
  const confirm = useMutation(api.twofactor.confirmEnrollment);
  const storeCodes = useMutation(api.twofactor.storeRecoveryCodes);
  const disable2fa = useMutation(api.twofactor.disable);
  const signOutAll = useMutation(api.sessions.signOutAllDevices);

  const [uri, setUri] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  if (status === undefined) {
    return (
      <Card className="rule-frame bg-card">
        <CardContent className="py-6 text-sm text-muted-foreground">
          Loading security settings…
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="rule-frame bg-card">
      <CardHeader>
        <CardTitle className="font-serif text-2xl">Security</CardTitle>
        <CardDescription>
          Two-factor authentication and session control for your account.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* 2FA */}
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Authenticator app (TOTP)</p>
              <p className="text-xs text-muted-foreground">
                {status.enabled
                  ? "Enabled — codes required on sign-in from new sessions."
                  : "Add a second factor with Google Authenticator, Authy or 1Password."}
              </p>
            </div>
            <span
              className={`stamp ${status.enabled ? "text-emerald-700" : "text-muted-foreground"}`}
            >
              {status.enabled ? "On" : "Off"}
            </span>
          </div>

          {!status.enabled && !uri && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const r = await start({ entropy: randomB64(20) });
                  setUri(r.otpauthUri);
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Failed.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Set up two-factor
            </Button>
          )}

          {uri && (
            <div className="space-y-3 rounded-md border border-border bg-muted p-4">
              <p className="text-xs text-muted-foreground">
                Scan this secret into your authenticator app, then confirm
                with a code.
              </p>
              <code className="block break-all rounded bg-card p-2 text-xs">
                {uri}
              </code>
              <div className="flex gap-2">
                <Input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="6-digit code"
                  maxLength={6}
                  className="max-w-[140px] font-mono"
                />
                <Button
                  size="sm"
                  disabled={busy || code.length !== 6}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await confirm({ code });
                      const codes = Array.from(
                        { length: 8 },
                        () =>
                          randomB64(8)
                            .replace(/[^a-zA-Z0-9]/g, "")
                            .slice(0, 10)
                            .toLowerCase(),
                      );
                      await storeCodes({ codes });
                      setRecovery(codes);
                      setUri(null);
                      setCode("");
                      toast.success("Two-factor enabled.");
                    } catch (err) {
                      toast.error(
                        err instanceof Error ? err.message : "Failed.",
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Confirm
                </Button>
              </div>
            </div>
          )}

          {recovery && (
            <div className="rounded-md border border-border bg-muted p-4">
              <p className="text-xs font-medium">
                Recovery codes — shown once. Store them safely.
              </p>
              <div className="mt-2 grid grid-cols-2 gap-1 font-mono text-xs sm:grid-cols-4">
                {recovery.map((c) => (
                  <span key={c} className="rounded bg-card px-2 py-1">
                    {c}
                  </span>
                ))}
              </div>
            </div>
          )}

          {status.enabled && (
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <Label htmlFor="sec-disable">Disable with a current code</Label>
                <Input
                  id="sec-disable"
                  value={disableCode}
                  onChange={(e) => setDisableCode(e.target.value)}
                  placeholder="123456"
                  maxLength={6}
                  className="max-w-[140px] font-mono"
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={busy || disableCode.length !== 6}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await disable2fa({ code: disableCode });
                    toast.success("Two-factor disabled.");
                    setDisableCode("");
                  } catch (err) {
                    toast.error(
                      err instanceof Error ? err.message : "Failed.",
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Disable 2FA
              </Button>
            </div>
          )}
        </div>

        <hr className="engraving-rule" />

        {/* Sessions */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">Active sessions</p>
            <p className="text-xs text-muted-foreground">
              {sessions === undefined
                ? "—"
                : `${sessions.count} device${sessions.count === 1 ? "" : "s"} signed in. Sessions expire after 30 days.`}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={busy || !sessions?.count}
            onClick={async () => {
              setBusy(true);
              try {
                await signOutAll({});
                toast.success("Signed out everywhere.");
                window.location.href = "/login?reason=signedout";
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Failed.");
              } finally {
                setBusy(false);
              }
            }}
          >
            Sign out all devices
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
