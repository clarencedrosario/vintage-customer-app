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
import type { Doc } from "@/convex/_generated/dataModel";
import { INDIAN_STATES } from "@/lib/format";
import { useAuth } from "@/hooks/use-auth";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";

const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "SGD"];
const TIMEZONES = [
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Europe/London",
  "America/New_York",
];

function randomB64(n: number): string {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

/** Two-factor enrolment + session security, one card above Settings. */
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
        <CardContent className="py-6 text-sm ink-faded">
          Loading security settings…
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="rule-frame bg-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-serif text-2xl">
          <ShieldCheck className="size-5 text-primary" />
          Security
        </CardTitle>
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
              <p className="text-xs ink-faded">
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
              <p className="text-xs ink-faded">
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
                      const codes = Array.from({ length: 8 }, () =>
                        randomB64(5).replace(/[^a-zA-Z0-9]/g, "").slice(0, 10).toLowerCase(),
                      );
                      await storeCodes({ codes });
                      setRecovery(codes);
                      setUri(null);
                      setCode("");
                      toast.success("Two-factor enabled.");
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : "Failed.");
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
                    toast.error(err instanceof Error ? err.message : "Failed.");
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
            <p className="text-xs ink-faded">
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

/**
 * The settings form. Mounted only once the chamber document has loaded, with
 * initial state drawn from it (and remounted via `key` if the document
 * changes) — no effect needed to sync props into state.
 */
function ChamberSettingsForm({ chamber }: { chamber: Doc<"settings"> }) {
  const isAdmin = useAuth().user?.role === "admin";
  const upsert = useMutation(api.chamber.upsert);

  const [form, setForm] = useState<Record<string, string>>(() => ({
    chamberName: chamber.chamberName,
    addressLine1: chamber.addressLine1,
    addressLine2: chamber.addressLine2 ?? "",
    city: chamber.city,
    state: chamber.state,
    pincode: chamber.pincode,
    phone: chamber.phone ?? "",
    email: chamber.email ?? "",
    website: chamber.website ?? "",
    gstin: chamber.gstin ?? "",
    currency: chamber.currency,
    timezone: chamber.timezone,
    financialYearStart: chamber.financialYearStart,
    taxLabel: chamber.taxLabel,
    invoicePrefix: chamber.invoicePrefix,
  }));
  const [taxPercent, setTaxPercent] = useState(() =>
    String(chamber.taxPercent),
  );
  const [busy, setBusy] = useState(false);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const handleSaveChamber = async () => {
    if (
      !form.chamberName?.trim() ||
      !form.addressLine1?.trim() ||
      !form.city?.trim()
    ) {
      toast.error("Chamber name, address and city are required.");
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
      await upsert({
        chamberName: form.chamberName,
        addressLine1: form.addressLine1,
        addressLine2: form.addressLine2 || undefined,
        city: form.city,
        state: form.state ?? "Maharashtra",
        pincode: form.pincode ?? "",
        phone: form.phone || undefined,
        email: form.email || undefined,
        website: form.website || undefined,
        gstin: form.gstin || undefined,
        currency: form.currency ?? "INR",
        timezone: form.timezone ?? "Asia/Kolkata",
        financialYearStart: form.financialYearStart ?? "04-01",
        taxLabel: form.taxLabel ?? "GST",
        taxPercent: parseFloat(taxPercent) || 0,
        invoicePrefix: form.invoicePrefix ?? "ADV",
      });
      toast.success("Chamber settings saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      {/* Chamber profile */}
      <Card className="rule-frame bg-card">
        <CardHeader>
          <CardTitle className="font-serif text-2xl">Chamber profile</CardTitle>
          <CardDescription>
            {isAdmin
              ? "The chamber's registered particulars, shown on invoices."
              : "Shown for reference; the administrator manages these."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="st-name">Chamber / firm name</Label>
            <Input
              id="st-name"
              value={form.chamberName ?? ""}
              onChange={(e) => set("chamberName", e.target.value)}
              disabled={!isAdmin}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="st-addr1">Address line 1</Label>
            <Input
              id="st-addr1"
              value={form.addressLine1 ?? ""}
              onChange={(e) => set("addressLine1", e.target.value)}
              placeholder="Chamber No., blocks, street"
              disabled={!isAdmin}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="st-addr2">Address line 2</Label>
            <Input
              id="st-addr2"
              value={form.addressLine2 ?? ""}
              onChange={(e) => set("addressLine2", e.target.value)}
              disabled={!isAdmin}
            />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2 space-y-2">
              <Label>State</Label>
              <Select
                value={form.state ?? ""}
                onValueChange={(v) => set("state", v)}
                disabled={!isAdmin}
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
              <Label htmlFor="st-pin">PIN</Label>
              <Input
                id="st-pin"
                value={form.pincode ?? ""}
                onChange={(e) => set("pincode", e.target.value)}
                maxLength={6}
                disabled={!isAdmin}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="st-city">City</Label>
              <Input
                id="st-city"
                value={form.city ?? ""}
                onChange={(e) => set("city", e.target.value)}
                disabled={!isAdmin}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="st-gstin">GSTIN</Label>
              <Input
                id="st-gstin"
                value={form.gstin ?? ""}
                onChange={(e) => set("gstin", e.target.value.toUpperCase())}
                maxLength={15}
                disabled={!isAdmin}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="st-phone">Phone</Label>
              <Input
                id="st-phone"
                value={form.phone ?? ""}
                onChange={(e) => set("phone", e.target.value)}
                disabled={!isAdmin}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="st-email">Email</Label>
              <Input
                id="st-email"
                value={form.email ?? ""}
                onChange={(e) => set("email", e.target.value)}
                disabled={!isAdmin}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Billing & conventions */}
      <Card className="rule-frame h-fit bg-card">
        <CardHeader>
          <CardTitle className="font-serif text-2xl">
            Billing & conventions
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
                value={form.currency ?? "INR"}
                onValueChange={(v) => set("currency", v)}
                disabled={!isAdmin}
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
                value={form.timezone ?? "Asia/Kolkata"}
                onValueChange={(v) => set("timezone", v)}
                disabled={!isAdmin}
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
              <Label htmlFor="st-fy">Financial year starts</Label>
              <Input
                id="st-fy"
                value={form.financialYearStart ?? "04-01"}
                onChange={(e) => set("financialYearStart", e.target.value)}
                placeholder="04-01"
                disabled={!isAdmin}
              />
              <p className="text-xs ink-faded">MM-DD, e.g. 04-01 for April</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="st-prefix">Invoice prefix</Label>
              <Input
                id="st-prefix"
                value={form.invoicePrefix ?? "ADV"}
                onChange={(e) =>
                  set("invoicePrefix", e.target.value.toUpperCase())
                }
                maxLength={6}
                disabled={!isAdmin}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="st-taxlabel">Tax label</Label>
              <Input
                id="st-taxlabel"
                value={form.taxLabel ?? "GST"}
                onChange={(e) => set("taxLabel", e.target.value)}
                disabled={!isAdmin}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="st-taxpct">Tax percent</Label>
              <Input
                id="st-taxpct"
                type="number"
                min="0"
                max="50"
                value={taxPercent}
                onChange={(e) => setTaxPercent(e.target.value)}
                disabled={!isAdmin}
              />
            </div>
          </div>
          {isAdmin && (
            <Button
              className="w-full"
              onClick={handleSaveChamber}
              disabled={busy}
            >
              {busy ? "Saving…" : "Save chamber settings"}
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function Settings() {
  const chamber = useQuery(api.chamber.get);

  return (
    <ChamberShell subtitle="The Digital Chamber">
      <SecurityCard />

      <div className="mt-10">
        <p className="type-label ink-faded">Chamber Particulars</p>
        <h1 className="mt-2 font-serif text-3xl font-semibold tracking-tight">
          Settings
        </h1>
        <p className="mt-2 max-w-2xl ink-faded">
          The chamber's address, tax and billing conventions. These particulars
          appear on invoices and govern numbering and financial years.
        </p>
      </div>

      {chamber === undefined ? (
        <p className="mt-10 text-sm ink-faded">Retrieving particulars…</p>
      ) : chamber === null ? (
        <Card className="mt-10 border-dashed">
          <CardContent className="py-10 text-center text-sm ink-faded">
            No chamber particulars are on record yet. They are created
            automatically the first time the administrator saves this page.
          </CardContent>
        </Card>
      ) : (
        <div className="mt-8">
          <ChamberSettingsForm key={chamber._id} chamber={chamber} />
        </div>
      )}
    </ChamberShell>
  );
}
