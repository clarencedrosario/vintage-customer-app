import { ChamberShell } from "@/components/ChamberShell";
import { BackupCard, DataImportCard } from "@/components/DataAndBackupCards";
import { GitHubCard } from "@/components/GitHubCard";
import { PromoteMyProfileCard, PromotionsOwnerCard } from "@/components/PromotionsCards";
import { SubscriptionCard } from "@/components/SubscriptionCard";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { INDIAN_STATES } from "@/lib/format";
import { useMutation, useQuery } from "convex/react";
import { Check, Minus, Upload } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";

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
          <SubscriptionCard />
          <PublicProfileCard />
          <VerificationDeskCard />
          <PromotionsOwnerCard />
          <PromoteMyProfileCard />
          <AutomationCard />
          <NotificationPrefsCard />
          <DataImportCard />
          <BackupCard />
          <GitHubCard />
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

// ---------------------------------------------------------------
// Automation rules — trigger / conditions / action, owner,
// enabled state, run-now, execution history, task review
// ---------------------------------------------------------------

const TRIGGER_LABELS: Record<string, string> = {
  deadline_reminder: "When a deadline reminder falls due (or the deadline day arrives)",
  hearing_tomorrow: "When a hearing is within the next 24 hours",
  invoice_overdue: "When an invoice passes its due date unpaid",
};
const ACTION_LABELS: Record<string, string> = {
  notify_user: "Notify the responsible owner",
  create_task: "Create a task for the owner (reviewable)",
  whatsapp_template: "Send an approved WhatsApp template to the client",
};
const RUN_STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  succeeded: "secondary",
  failed: "destructive",
  skipped: "outline",
};

type RuleForm = {
  name: string;
  trigger: "deadline_reminder" | "hearing_tomorrow" | "invoice_overdue";
  action: "notify_user" | "create_task" | "whatsapp_template";
  practiceArea: string;
  minDaysOverdue: string;
  ownerUserId: string;
  taskTitle: string;
  taskDueInDays: string;
  templateName: string;
  whatsappAuthorized: boolean;
  enabled: boolean;
};

const EMPTY_RULE: RuleForm = {
  name: "",
  trigger: "deadline_reminder",
  action: "notify_user",
  practiceArea: "",
  minDaysOverdue: "1",
  ownerUserId: "",
  taskTitle: "",
  taskDueInDays: "1",
  templateName: "",
  whatsappAuthorized: false,
  enabled: true,
};

function AutomationCard() {
  const rules = useQuery(api.reminders.listRules);
  const runs = useQuery(api.reminders.runHistory, { limit: 30 });
  const team = useQuery(api.workspace.team);
  const caps = useQuery(api.workspace.myCapabilities);
  const members = (team ?? []).filter((m) => m.status === "active");
  const canManage = caps?.capabilities.includes("team.manage") ?? false;

  return (
    <Card className="rule-frame bg-card">
      <CardHeader>
        <CardTitle className="font-serif text-2xl">Automation</CardTitle>
        <CardDescription>
          Rules run on the platform scheduler every few minutes — reminders
          and automation do not depend on anyone opening the dashboard.
          {canManage
            ? ""
            : " Only owners and administrators can change these rules."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <RulesEditor canManage={canManage} members={members} rules={rules} />
        <RuleRunHistory runs={runs} />
      </CardContent>
    </Card>
  );
}

function RulesEditor({
  canManage,
  members,
  rules,
}: {
  canManage: boolean;
  members: { userId: string; name: string | null; email: string | null }[];
  rules:
    | {
        _id: string;
        name: string;
        enabled: boolean;
        trigger: string;
        action: string;
        practiceArea?: string;
        minDaysOverdue?: number;
        ownerUserId?: string;
        taskTitle?: string;
        taskDueInDays?: number;
        templateName?: string;
      }[]
    | undefined;
}) {
  const save = useMutation(api.reminders.saveRule);
  const setEnabled = useMutation(api.reminders.setRuleEnabled);
  const remove = useMutation(api.reminders.deleteRule);
  const runNow = useMutation(api.reminders.runRuleNow);
  const [editing, setEditing] = useState<RuleForm | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const startEdit = (rule: NonNullable<typeof rules>[number] | null) => {
    if (rule) {
      setEditId(rule._id);
      setEditing({
        name: rule.name,
        trigger: rule.trigger as RuleForm["trigger"],
        action: rule.action as RuleForm["action"],
        practiceArea: rule.practiceArea ?? "",
        minDaysOverdue: String(rule.minDaysOverdue ?? 1),
        ownerUserId: rule.ownerUserId ?? "",
        taskTitle: rule.taskTitle ?? "",
        taskDueInDays: String(rule.taskDueInDays ?? 1),
        templateName: rule.templateName ?? "",
        whatsappAuthorized: false, // never displayed; re-confirmed per save
        enabled: rule.enabled,
      });
    } else {
      setEditId(null);
      setEditing({ ...EMPTY_RULE });
    }
  };

  const submit = async () => {
    if (!editing) return;
    if (editing.name.trim().length < 3) {
      toast.error("Give the rule a clear name.");
      return;
    }
    setBusy(true);
    try {
      await save({
        ruleId: editId ? (editId as Id<"automationRules">) : undefined,
        name: editing.name.trim(),
        trigger: editing.trigger,
        action: editing.action,
        practiceArea: editing.practiceArea.trim() || undefined,
        minDaysOverdue: editing.trigger === "invoice_overdue" ? Math.max(1, parseInt(editing.minDaysOverdue, 10) || 1) : undefined,
        ownerUserId:
          editing.action === "whatsapp_template" || editing.ownerUserId
            ? (editing.ownerUserId as Id<"users"> | undefined)
            : undefined,
        taskTitle: editing.action === "create_task" && editing.taskTitle.trim() ? editing.taskTitle.trim() : undefined,
        taskDueInDays:
          editing.action === "create_task" ? Math.max(0, parseInt(editing.taskDueInDays, 10) || 1) : undefined,
        templateName: editing.action === "whatsapp_template" && editing.templateName.trim() ? editing.templateName.trim() : undefined,
        whatsappAuthorized: editing.action === "whatsapp_template" ? editing.whatsappAuthorized : undefined,
        enabled: editing.enabled,
      });
      toast.success(editId ? "Rule updated." : "Rule created.");
      setEditing(null);
      setEditId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the rule.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {rules === undefined && (
          <p className="text-sm text-muted-foreground">Retrieving rules…</p>
        )}
        {rules?.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No rules yet. Create one to automate reminders, task creation or
            client WhatsApp notices.
          </p>
        )}
        {rules?.map((rule) => (
          <div
            key={rule._id}
            className="flex flex-col gap-3 rounded-md border border-border bg-background/50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{rule.name}</span>
                <Badge variant={rule.enabled ? "secondary" : "outline"}>
                  {rule.enabled ? "Enabled" : "Disabled"}
                </Badge>
                <Badge variant="outline">{rule.action.replace("_", " ")}</Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {TRIGGER_LABELS[rule.trigger] ?? rule.trigger}
                {rule.practiceArea ? ` · ${rule.practiceArea} only` : ""}
                {rule.action === "create_task" && rule.taskTitle
                  ? ` · task: ${rule.taskTitle}`
                  : ""}
              </p>
            </div>
            {canManage && (
              <div className="flex flex-wrap items-center gap-2">
                <Switch
                  checked={rule.enabled}
                  onCheckedChange={(v) => {
                    void setEnabled({ ruleId: rule._id as Id<"automationRules">, enabled: v }).catch(
                      (err) => toast.error(err instanceof Error ? err.message : "Failed."),
                    );
                  }}
                  aria-label={`${rule.enabled ? "Disable" : "Enable"} ${rule.name}`}
                />
                <Button variant="outline" size="sm" onClick={() => startEdit(rule)}>
                  Edit
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    try {
                      const res = await runNow({ ruleId: rule._id as Id<"automationRules"> });
                      toast.success(
                        res.executed > 0
                          ? `Rule executed — ${res.executed} occurrence(s).`
                          : "No matching occurrences right now.",
                      );
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : "Run failed.");
                    }
                  }}
                >
                  Run now
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  onClick={async () => {
                    try {
                      await remove({ ruleId: rule._id as Id<"automationRules"> });
                      toast.success("Rule deleted.");
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : "Failed.");
                    }
                  }}
                >
                  Delete
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>

      {canManage && !editing && (
        <Button variant="outline" size="sm" onClick={() => startEdit(null)}>
          New rule
        </Button>
      )}

      {editing && (
        <div className="space-y-4 rounded-md border border-[#B68A45]/40 bg-[#B68A45]/[0.04] p-4">
          <p className="font-serif text-sm font-semibold">{editId ? "Edit rule" : "New rule"}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="rule-name">Rule name</Label>
              <Input
                id="rule-name"
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                placeholder="e.g. File Vakalatnama before hearing"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rule-owner">Responsible owner</Label>
              <Select
                value={editing.ownerUserId}
                onValueChange={(v) => setEditing({ ...editing, ownerUserId: v })}
              >
                <SelectTrigger id="rule-owner">
                  <SelectValue placeholder="Choose a member" />
                </SelectTrigger>
                <SelectContent>
                  {members.map((m) => (
                    <SelectItem key={m.userId} value={m.userId}>
                      {m.name ?? m.email ?? m.userId}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="rule-trigger">Trigger</Label>
              <Select
                value={editing.trigger}
                onValueChange={(v) =>
                  setEditing({ ...editing, trigger: v as RuleForm["trigger"] })
                }
              >
                <SelectTrigger id="rule-trigger">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TRIGGER_LABELS).map(([k, label]) => (
                    <SelectItem key={k} value={k}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="rule-action">Action</Label>
              <Select
                value={editing.action}
                onValueChange={(v) =>
                  setEditing({ ...editing, action: v as RuleForm["action"] })
                }
              >
                <SelectTrigger id="rule-action">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(ACTION_LABELS).map(([k, label]) => (
                    <SelectItem key={k} value={k}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="rule-area">Condition — practice area (optional)</Label>
              <Input
                id="rule-area"
                value={editing.practiceArea}
                onChange={(e) => setEditing({ ...editing, practiceArea: e.target.value })}
                placeholder="e.g. Civil — leave blank for all matters"
              />
            </div>
            {editing.trigger === "invoice_overdue" && (
              <div className="space-y-2">
                <Label htmlFor="rule-days">Condition — days overdue (minimum)</Label>
                <Input
                  id="rule-days"
                  type="number"
                  min={1}
                  value={editing.minDaysOverdue}
                  onChange={(e) => setEditing({ ...editing, minDaysOverdue: e.target.value })}
                />
              </div>
            )}
            {editing.action === "create_task" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="rule-task">Task title</Label>
                  <Input
                    id="rule-task"
                    value={editing.taskTitle}
                    onChange={(e) => setEditing({ ...editing, taskTitle: e.target.value })}
                    placeholder="e.g. Prepare and file Vakalatnama"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="rule-due">Task due in (days)</Label>
                  <Input
                    id="rule-due"
                    type="number"
                    min={0}
                    value={editing.taskDueInDays}
                    onChange={(e) => setEditing({ ...editing, taskDueInDays: e.target.value })}
                  />
                </div>
              </>
            )}
            {editing.action === "whatsapp_template" && (
              <div className="space-y-2">
                <Label htmlFor="rule-template">Approved WhatsApp template</Label>
                <Input
                  id="rule-template"
                  value={editing.templateName}
                  onChange={(e) => setEditing({ ...editing, templateName: e.target.value })}
                  placeholder="hearing_reminder, invoice_reminder or case_update"
                />
              </div>
            )}
          </div>
          {editing.action === "whatsapp_template" && (
            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                checked={editing.whatsappAuthorized}
                onCheckedChange={(v) =>
                  setEditing({ ...editing, whatsappAuthorized: v === true })
                }
              />
              <span>
                I authorise sending the approved template to opted-in clients
                when this rule fires. External messages always honour the
                recipient's WhatsApp preferences.
              </span>
            </label>
          )}
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={editing.enabled}
              onCheckedChange={(v) => setEditing({ ...editing, enabled: v })}
              aria-label="Rule enabled"
            />
            Enabled
          </label>
          <div className="flex gap-2">
            <Button size="sm" disabled={busy} onClick={() => void submit()}>
              {busy ? "Saving…" : editId ? "Save changes" : "Create rule"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setEditing(null);
                setEditId(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function RuleRunHistory({
  runs,
}: {
  runs:
    | {
        _id: string;
        ruleName: string;
        status: string;
        detail?: string;
        failureReason?: string;
        createdTaskId?: string;
        reviewState?: "pending" | "confirmed" | "rejected";
        ranAt: number;
      }[]
    | undefined;
}) {
  const review = useMutation(api.reminders.reviewRun);
  const [busyId, setBusyId] = useState<string | null>(null);

  const decide = async (runId: string, decision: "confirmed" | "rejected") => {
    setBusyId(runId);
    try {
      await review({
        runId: runId as Id<"automationRuns">,
        decision,
      });
      toast.success(decision === "confirmed" ? "Task confirmed." : "Task rejected.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-3">
      <p className="type-label ink-faded">Execution history</p>
      {runs === undefined && (
        <p className="text-sm text-muted-foreground">Retrieving history…</p>
      )}
      {runs?.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No executions yet. Runs appear here with their outcome — automated
          tasks wait here for review before counting as confirmed.
        </p>
      )}
      {runs?.map((run) => (
        <div
          key={run._id}
          className="flex flex-col gap-2 rounded-md border border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{run.ruleName}</span>
              <Badge variant={RUN_STATUS_VARIANT[run.status] ?? "outline"}>
                {run.status}
              </Badge>
              {run.createdTaskId && (
                <Badge
                  variant={
                    run.reviewState === "confirmed"
                      ? "secondary"
                      : run.reviewState === "rejected"
                        ? "outline"
                        : "default"
                  }
                >
                  {run.reviewState === "confirmed"
                    ? "Task confirmed"
                    : run.reviewState === "rejected"
                      ? "Task rejected"
                      : "Task needs review"}
                </Badge>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {new Date(run.ranAt).toLocaleString("en-IN", {
                timeZone: "Asia/Kolkata",
                day: "numeric",
                month: "short",
                hour: "numeric",
                minute: "2-digit",
              })}
              {run.failureReason ? ` — ${run.failureReason}` : run.detail ? ` — ${run.detail}` : ""}
            </p>
          </div>
          {run.createdTaskId && run.reviewState === "pending" && (
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={busyId === run._id}
                onClick={() => void decide(run._id, "confirmed")}
              >
                Confirm
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={busyId === run._id}
                onClick={() => void decide(run._id, "rejected")}
              >
                Reject
              </Button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------
// Notification preferences — what reaches this user
// ---------------------------------------------------------------

const MUTABLE_KINDS = [
  "hearing_reminder",
  "deadline_reminder",
  "task_assigned",
  "doc_request",
  "message",
  "draft_approval",
  "invoice_followup",
  "automation",
] as const;

const MUTABLE_LABELS: Record<string, string> = {
  hearing_reminder: "Hearing reminders",
  deadline_reminder: "Deadline reminders",
  task_assigned: "Task assignments",
  doc_request: "Document requests",
  message: "New messages",
  draft_approval: "Draft approvals",
  invoice_followup: "Invoice follow-ups",
  automation: "Automation notices",
};

function NotificationPrefsCard() {
  const prefs = useQuery(api.reminders.getMyPreferences);
  const save = useMutation(api.reminders.saveMyPreferences);
  const [emailUpdates, setEmailUpdates] = useState<boolean | null>(null);
  const [muted, setMuted] = useState<Set<string> | null>(null);
  const [busy, setBusy] = useState(false);

  const email = emailUpdates ?? prefs?.emailUpdates ?? false;
  const mutedSet = muted ?? new Set(prefs?.mutedKinds ?? []);

  return (
    <Card className="rule-frame bg-card">
      <CardHeader>
        <CardTitle className="font-serif text-2xl">Notification preferences</CardTitle>
        <CardDescription>
          The in-app centre is always on. Choose whether non-urgent notices
          also reach you by email, and mute categories you do not need.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="flex items-center justify-between gap-4 rounded-md border border-border px-4 py-3">
          <span>
            <span className="block text-sm font-medium">Email me non-urgent updates</span>
            <span className="block text-xs text-muted-foreground">
              Messages, approvals and document requests in addition to the in-app centre. Critical hearing and deadline reminders are never muted.
            </span>
          </span>
          <Switch
            checked={email}
            onCheckedChange={setEmailUpdates}
            aria-label="Email non-urgent updates"
          />
        </label>
        <div className="space-y-2">
          <p className="type-label ink-faded">Mute in the notification centre</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {MUTABLE_KINDS.map((k) => (
              <label
                key={k}
                className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"
              >
                <Checkbox
                  checked={!mutedSet.has(k)}
                  onCheckedChange={(v) => {
                    const next = new Set(mutedSet);
                    if (v === true) {
                      next.delete(k);
                    } else {
                      next.add(k);
                    }
                    setMuted(next);
                  }}
                />
                {MUTABLE_LABELS[k] ?? k}
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Ticked categories appear in your centre; unticked ones are muted.
          </p>
        </div>
        <Button
          size="sm"
          disabled={busy || prefs === undefined}
          onClick={async () => {
            setBusy(true);
            try {
              await save({ emailUpdates: email, mutedKinds: [...mutedSet] });
              toast.success("Preferences saved.");
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Could not save.");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Saving…" : "Save preferences"}
        </Button>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------
// Public directory profile editor (section 22)
// ---------------------------------------------------------------

function PublicProfileCard() {
  const profile = useQuery(api.directory.myProfile);
  const [open, setOpen] = useState(false);

  if (profile === undefined || profile === null) return null;
  if ("canPublish" in profile && profile.canPublish === false) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-serif">Public directory profile</CardTitle>
        <CardDescription>
          Publish your practice to the public “Find a Lawyer” directory.
          Nothing appears publicly until you switch publication on.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <Switch checked={profile.published} onCheckedChange={() => setOpen(true)} />
          <span className="text-sm text-muted-foreground">
            {profile.published ? "Published publicly" : "Not published"}
          </span>
          {profile.verificationStatus === "verified" && (
            <Badge className="border-emerald-200 bg-emerald-50 text-emerald-800" variant="outline">
              Verified by your chamber
            </Badge>
          )}
          {profile.verificationStatus === "rejected" && (
            <Badge variant="outline" className="border-red-200 bg-red-50 text-red-800">
              Verification not granted
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          “Verified” is only shown after your chamber's owner or administrator
          records an actual verification decision. Publishing shows: name,
          qualifications, enrollment details, experience, practice areas, court
          specialization, city, languages, chosen contact details, consultation
          fee and offered availability.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            {profile.exists ? "Edit profile" : "Create profile"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            asChild
          >
            <a href="/find-a-lawyer" target="_blank" rel="noreferrer">
              View public directory
            </a>
          </Button>
        </div>
      </CardContent>
      {open && (
        <ProfileEditor
          initial={profile}
          onClose={() => setOpen(false)}
        />
      )}
    </Card>
  );
}

type MyProfileData = {
  exists: boolean;
  published?: boolean | null;
  headline?: string | null;
  qualifications?: string | null;
  enrollmentNumber?: string | null;
  enrollmentState?: string | null;
  experienceYears?: number | null;
  practiceAreas?: string[] | null;
  courts?: string[] | null;
  languages?: string[] | null;
  city?: string | null;
  publicEmail?: string | null;
  publicPhone?: string | null;
  feeMinor?: number | null;
  slots?: { label: string; startsAt: number }[] | null;
  availabilityNote?: string | null;
  about?: string | null;
  verificationStatus?: string | null;
  decisionNote?: string | null;
};

function ProfileEditor({
  initial,
  onClose,
}: {
  initial: MyProfileData;
  onClose: () => void;
}) {
  const save = useMutation(api.directory.saveProfile);
  const nowRef = useState(() => Date.now())[0];
  const [published, setPublished] = useState(initial.published ?? false);
  const [headline, setHeadline] = useState(initial.headline ?? "");
  const [qualifications, setQualifications] = useState(initial.qualifications ?? "");
  const [enrollmentNumber, setEnrollmentNumber] = useState(initial.enrollmentNumber ?? "");
  const [enrollmentState, setEnrollmentState] = useState(initial.enrollmentState ?? "");
  const [experienceYears, setExperienceYears] = useState(
    initial.experienceYears == null ? "" : String(initial.experienceYears),
  );
  const [practiceAreas, setPracticeAreas] = useState((initial.practiceAreas ?? []).join(", "));
  const [courts, setCourts] = useState((initial.courts ?? []).join(", "));
  const [languages, setLanguages] = useState((initial.languages ?? []).join(", "));
  const [city, setCity] = useState(initial.city ?? "");
  const [publicEmail, setPublicEmail] = useState(initial.publicEmail ?? "");
  const [publicPhone, setPublicPhone] = useState(initial.publicPhone ?? "");
  const [fee, setFee] = useState(
    (initial.feeMinor ?? 0) > 0 ? String((initial.feeMinor ?? 0) / 100) : "",
  );
  const [slots, setSlots] = useState(
    [...(initial.slots ?? [])]
      .filter((s) => s.startsAt > nowRef)
      .sort((a, b) => a.startsAt - b.startsAt),
  );
  const [slotDay, setSlotDay] = useState("");
  const [slotTime, setSlotTime] = useState("");
  const [slotLabel, setSlotLabel] = useState("");
  const [availabilityNote, setAvailabilityNote] = useState(initial.availabilityNote ?? "");
  const [about, setAbout] = useState(initial.about ?? "");
  const [busy, setBusy] = useState(false);

  const addSlot = () => {
    if (!slotDay || !slotTime) return;
    const startsAt = new Date(`${slotDay}T${slotTime}`).getTime();
    if (Number.isNaN(startsAt)) return;
    setSlots(
      [...slots, { label: slotLabel.trim() || "Consultation", startsAt }].sort(
        (a, b) => a.startsAt - b.startsAt,
      ),
    );
    setSlotDay("");
    setSlotTime("");
    setSlotLabel("");
  };

  const submit = async () => {
    setBusy(true);
    try {
      await save({
        published,
        headline: headline || undefined,
        qualifications: qualifications || undefined,
        enrollmentNumber: enrollmentNumber || undefined,
        enrollmentState: enrollmentState || undefined,
        experienceYears: experienceYears === "" ? undefined : Number(experienceYears),
        practiceAreas: practiceAreas.split(",").map((s) => s.trim()).filter(Boolean),
        courts: courts.split(",").map((s) => s.trim()).filter(Boolean),
        languages: languages.split(",").map((s) => s.trim()).filter(Boolean),
        city: city || undefined,
        publicEmail: publicEmail || undefined,
        publicPhone: publicPhone || undefined,
        feeMinor: fee === "" ? 0 : Math.round(Number(fee) * 100),
        slots,
        availabilityNote: availabilityNote || undefined,
        about: about || undefined,
      });
      toast.success(
        published ? "Profile saved and published." : "Profile saved (not published).",
      );
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the profile.");
    } finally {
      setBusy(false);
    }
  };

  const split = (v: string, set: (s: string) => void) => (
    <Input value={v} onChange={(e) => set(e.target.value)} />
  );
  void split;

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-serif">Public profile</DialogTitle>
          <DialogDescription>
            Only these details appear publicly, and only when publication is on.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <Switch checked={published} onCheckedChange={setPublished} />
            <span className="text-sm">Published publicly</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Headline">
              <Input value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="e.g. Criminal & constitutional litigation" />
            </Field>
            <Field label="City">
              <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="e.g. New Delhi" />
            </Field>
            <Field label="Qualifications" full>
              <Textarea value={qualifications} onChange={(e) => setQualifications(e.target.value)} rows={2} placeholder="B.A. LL.B. (Hons.); LL.M. …" />
            </Field>
            <Field label="Enrollment number">
              <Input value={enrollmentNumber} onChange={(e) => setEnrollmentNumber(e.target.value)} />
            </Field>
            <Field label="Enrollment state">
              <Input value={enrollmentState} onChange={(e) => setEnrollmentState(e.target.value)} placeholder="e.g. Bar Council of Delhi" />
            </Field>
            <Field label="Years of experience">
              <Input type="number" min={0} max={70} value={experienceYears} onChange={(e) => setExperienceYears(e.target.value)} />
            </Field>
            <Field label="Consultation fee (₹, blank = free/on request)">
              <Input type="number" min={0} value={fee} onChange={(e) => setFee(e.target.value)} />
            </Field>
            <Field label="Practice areas (comma-separated)" full>
              {split(practiceAreas, setPracticeAreas)}
            </Field>
            <Field label="Courts (comma-separated)" full>
              {split(courts, setCourts)}
            </Field>
            <Field label="Languages (comma-separated)" full>
              {split(languages, setLanguages)}
            </Field>
            <Field label="Public contact email">
              <Input value={publicEmail} onChange={(e) => setPublicEmail(e.target.value)} />
            </Field>
            <Field label="Public contact phone">
              <Input value={publicPhone} onChange={(e) => setPublicPhone(e.target.value)} />
            </Field>
            <Field label="About" full>
              <Textarea value={about} onChange={(e) => setAbout(e.target.value)} rows={3} />
            </Field>
            <Field label="Availability note" full>
              <Input value={availabilityNote} onChange={(e) => setAvailabilityNote(e.target.value)} placeholder="e.g. Consultations Mon–Fri, 5–7 pm" />
            </Field>
          </div>

          <div className="rounded-md border border-[#E5E7EB] p-3">
            <p className="type-label ink-faded">Offered consultation slots</p>
            {slots.length > 0 && (
              <ul className="mt-2 space-y-1">
                {slots.map((s, i) => (
                  <li key={s.startsAt} className="flex items-center justify-between text-xs">
                    <span>
                      {s.label} · {new Date(s.startsAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
                    </span>
                    <button
                      type="button"
                      className="text-[#B68A45] hover:underline"
                      onClick={() => setSlots(slots.filter((_, j) => j !== i))}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Input type="date" value={slotDay} onChange={(e) => setSlotDay(e.target.value)} aria-label="Slot date" />
              <Input type="time" value={slotTime} onChange={(e) => setSlotTime(e.target.value)} aria-label="Slot time" />
              <Input value={slotLabel} onChange={(e) => setSlotLabel(e.target.value)} placeholder="Label (optional)" aria-label="Slot label" />
              <Button size="sm" variant="outline" onClick={addSlot} disabled={!slotDay || !slotTime}>
                Add slot
              </Button>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={submit} disabled={busy}>{busy ? "Saving…" : "Save profile"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={`space-y-1.5 ${full ? "sm:col-span-2" : ""}`}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------
// Verification desk — owner/administrator decisions (section 22)
// ---------------------------------------------------------------

function VerificationDeskCard() {
  const caps = useQuery(api.workspace.myCapabilities);
  const queue = useQuery(api.directory.verificationQueue);
  const decide = useMutation(api.directory.decideVerification);
  const isOwnerAdmin =
    caps?.orgRole === "owner" || caps?.orgRole === "administrator";

  if (caps === undefined) return null;
  if (!isOwnerAdmin) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-serif">Directory verification</CardTitle>
        <CardDescription>
          Review member profiles before granting the public “Verified” badge.
          The badge appears only after a decision is recorded here.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {queue === undefined ? null : queue.length === 0 ? (
          <p className="text-sm text-muted-foreground">No member profiles yet.</p>
        ) : (
          <div className="space-y-2">
            {queue.map((p) => (
              <div
                key={p.profileId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[#E5E7EB] px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">{p.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {p.enrollmentNumber || "No enrollment number given"}
                    {p.practiceAreas.length > 0 ? ` · ${p.practiceAreas.join(", ")}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className={
                      p.verificationStatus === "verified"
                        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                        : p.verificationStatus === "rejected"
                          ? "border-red-200 bg-red-50 text-red-800"
                          : ""
                    }
                  >
                    {p.verificationStatus === "unverified" ? "Not verified" : p.verificationStatus}
                  </Badge>
                  {p.verificationStatus !== "verified" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={async () => {
                        try {
                          await decide({ profileId: p.profileId as never, decision: "verified" });
                          toast.success(`${p.name} marked verified.`);
                        } catch (err) {
                          toast.error(err instanceof Error ? err.message : "Could not verify.");
                        }
                      }}
                    >
                      Verify
                    </Button>
                  )}
                  {p.verificationStatus === "verified" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      onClick={async () => {
                        try {
                          await decide({ profileId: p.profileId as never, decision: "unverified" });
                          toast.success("Verification withdrawn.");
                        } catch (err) {
                          toast.error(err instanceof Error ? err.message : "Could not update.");
                        }
                      }}
                    >
                      Withdraw
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
