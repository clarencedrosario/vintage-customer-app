import { ChamberShell } from "@/components/ChamberShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { useAuth } from "@/hooks/use-auth";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "SGD"];
const TIMEZONES = [
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Europe/London",
  "America/New_York",
];

export default function Settings() {
  const { user } = useAuth();
  const chamber = useQuery(api.chamber.get);
  const upsert = useMutation(api.chamber.upsert);
  const updateProfile = useMutation(api.workspace.updateProfile);

  const [form, setForm] = useState<Record<string, string>>({});
  const [taxPercent, setTaxPercent] = useState("18");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (chamber) {
      setForm({
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
      });
      setTaxPercent(String(chamber.taxPercent));
    }
  }, [chamber]);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const handleSaveChamber = async () => {
    if (!form.chamberName?.trim() || !form.addressLine1?.trim() || !form.city?.trim()) {
      toast.error("Chamber name, address and city are required.");
      return;
    }
    if (form.pincode && !/^\d{6}$/.test(form.pincode)) {
      toast.error("PIN code must be exactly 6 digits.");
      return;
    }
    if (form.gstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]{3}$/.test(form.gstin)) {
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

  const handleSaveProfile = async () => {
    setBusy(true);
    try {
      await updateProfile({});
      toast.info("Profile details are managed from Team by the administrator.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ChamberShell subtitle="The Digital Chamber">
      <p className="type-label ink-faded">Chamber Particulars</p>
      <h1 className="mt-2 font-serif text-3xl font-semibold tracking-tight">
        Settings
      </h1>
      <p className="mt-2 max-w-2xl ink-faded">
        The chamber's address, tax and billing conventions. These particulars
        appear on invoices and govern numbering and financial years.
      </p>

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        {/* Chamber profile */}
        <Card className="rule-frame bg-card">
          <CardHeader>
            <CardTitle className="font-serif text-2xl">Chamber profile</CardTitle>
            <CardDescription>
              {user?.role === "admin"
                ? "Only the administrator may change these particulars."
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
                disabled={user?.role !== "admin"}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="st-addr1">Address line 1</Label>
              <Input
                id="st-addr1"
                value={form.addressLine1 ?? ""}
                onChange={(e) => set("addressLine1", e.target.value)}
                placeholder="Chamber No., blocks, street"
                disabled={user?.role !== "admin"}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="st-addr2">Address line 2</Label>
              <Input
                id="st-addr2"
                value={form.addressLine2 ?? ""}
                onChange={(e) => set("addressLine2", e.target.value)}
                disabled={user?.role !== "admin"}
              />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-2 space-y-2">
                <Label>State</Label>
                <Select
                  value={form.state ?? ""}
                  onValueChange={(v) => set("state", v)}
                  disabled={user?.role !== "admin"}
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
                  disabled={user?.role !== "admin"}
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
                  disabled={user?.role !== "admin"}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="st-gstin">GSTIN</Label>
                <Input
                  id="st-gstin"
                  value={form.gstin ?? ""}
                  onChange={(e) => set("gstin", e.target.value.toUpperCase())}
                  maxLength={15}
                  disabled={user?.role !== "admin"}
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
                  disabled={user?.role !== "admin"}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="st-email">Email</Label>
                <Input
                  id="st-email"
                  value={form.email ?? ""}
                  onChange={(e) => set("email", e.target.value)}
                  disabled={user?.role !== "admin"}
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
                  disabled={user?.role !== "admin"}
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
                  disabled={user?.role !== "admin"}
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
                  disabled={user?.role !== "admin"}
                />
                <p className="text-xs ink-faded">MM-DD, e.g. 04-01 for April</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="st-prefix">Invoice prefix</Label>
                <Input
                  id="st-prefix"
                  value={form.invoicePrefix ?? "ADV"}
                  onChange={(e) => set("invoicePrefix", e.target.value.toUpperCase())}
                  maxLength={6}
                  disabled={user?.role !== "admin"}
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
                  disabled={user?.role !== "admin"}
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
                  disabled={user?.role !== "admin"}
                />
              </div>
            </div>
            {user?.role === "admin" && (
              <Button className="w-full" onClick={handleSaveChamber} disabled={busy}>
                {busy ? "Saving…" : "Save chamber settings"}
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    </ChamberShell>
  );
}
