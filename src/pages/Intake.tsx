import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ChamberShell } from "@/components/ChamberShell";
import {
  INTAKE_MATTER_KINDS,
  INTAKE_STATE_LABELS,
  KYC_ITEMS,
  engagementIsAccepted,
  intakeMissingRequiredFields,
  kycChecklist,
  mayEditIntake,
  type DuplicateHit,
  type IntakeClientKind,
  type IntakeFormData,
  type IntakeMatterKind,
  type IntakeStage,
  type IntakeState,
  type IntakeUrgency,
} from "@/lib/intakeFlow";
import { formatDateTimeIN } from "@/lib/format";
import { useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  CalendarClock,
  ClipboardList,
  Copy,
  FileSignature,
  Link2,
  Loader2,
  Plus,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

type IntakeRow = {
  _id: string;
  state: IntakeState;
  form: IntakeFormData;
  prospectiveName: string;
  clientMode: "new_client" | "existing_client";
  duplicateHits?: DuplicateHit[] | null;
  duplicatesAcknowledged?: boolean;
  invite?: {
    email: string;
    expiresAt: number;
    usedAt?: number;
    revokedAt?: number;
  } | null;
  conflictCheckId?: string;
  createdClientId?: string;
  createdMatterId?: string;
  reviewNote?: string;
  createdByName?: string;
  updatedAt: number;
};

const STAGE_TITLES: Record<IntakeStage, string> = {
  identity: "Identity & contact",
  party_details: "Client details",
  matter: "The matter",
  parties_involved: "Adverse & related parties",
  conflict: "Conflict disclosure",
  kyc: "KYC checklist",
  referral: "Referral source",
  fees: "Fee arrangement",
  engagement: "Consent & engagement",
  risk: "Risk assessment",
  team: "Responsible team",
  review: "Review & submit",
};

const FIRM_STAGES: IntakeStage[] = [
  "identity",
  "party_details",
  "matter",
  "parties_involved",
  "conflict",
  "kyc",
  "referral",
  "fees",
  "engagement",
  "risk",
  "team",
  "review",
];

const URGENCIES: { value: IntakeUrgency; label: string }[] = [
  { value: "routine", label: "Routine" },
  { value: "time_sensitive", label: "Time-sensitive" },
  { value: "court_deadline", label: "Court deadline" },
];

const KINDS: { value: IntakeClientKind; label: string }[] = [
  { value: "individual", label: "Individual" },
  { value: "company", label: "Company" },
  { value: "partnership", label: "Partnership" },
  { value: "llp", label: "LLP" },
  { value: "trust", label: "Trust" },
  { value: "society", label: "Society" },
  { value: "government", label: "Government Body" },
  { value: "other", label: "Other" },
];

const MATTER_KIND_LABELS: Record<IntakeMatterKind, string> = {
  litigation: "Litigation",
  advisory: "Advisory",
  transaction: "Transaction",
  compliance: "Compliance",
};

function stateBadgeClass(state: IntakeState): string {
  switch (state) {
    case "draft":
      return "border-[#B68A45]/50 text-[#8a6a33]";
    case "submitted":
      return "border-[#B68A45] bg-[#B68A45] text-white";
    case "returned_for_correction":
      return "border-amber-600/60 text-amber-700";
    case "rejected":
      return "border-red-700/60 text-red-700";
    case "approved":
      return "border-emerald-700/50 text-emerald-800";
    case "cancelled":
      return "border-muted-foreground/40 text-muted-foreground";
  }
}

function DuplicateWarnings({ hits }: { hits: DuplicateHit[] }) {
  if (hits.length === 0) return null;
  return (
    <div className="rounded-lg border border-amber-500/50 bg-amber-50/70 p-3">
      <p className="flex items-center gap-1.5 text-sm font-medium text-amber-800">
        <AlertTriangle className="size-4" aria-hidden="true" />
        Possible duplicate client{hits.length === 1 ? "" : "s"} — review before approving
      </p>
      <ul className="mt-2 space-y-1.5">
        {hits.map((h) => (
          <li key={h.candidate.key} className="text-sm">
            <span className="font-medium">{h.candidate.name}</span>{" "}
            <Badge variant={h.severity === "definite" ? "destructive" : "outline"} className="ml-1">
              {h.severity === "definite" ? "definite match" : "same name"}
            </Badge>
            <ul className="mt-0.5 space-y-0.5">
              {h.reasons.map((r) => (
                <li key={r} className="text-xs text-muted-foreground">· {r}</li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}

function NewIntakeDialog({ onChanged }: { onChanged: () => void }) {
  const startIntake = useMutation(api.intake.startIntake);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"new_client" | "existing_client">("new_client");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    try {
      await startIntake({ clientMode: mode });
      toast.success("Intake draft created.");
      onChanged();
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start the intake.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus className="size-4" aria-hidden="true" />
          New intake
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <p className="type-label ink-faded">Client Intake & Matter Opening</p>
          <DialogTitle className="font-serif text-2xl">Begin an intake</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Who is being onboarded?</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as "new_client" | "existing_client")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="new_client">A new client</SelectItem>
                <SelectItem value="existing_client">An existing client (portal)</SelectItem>
              </SelectContent>
            </Select>
            {mode === "existing_client" && (
              <p className="text-xs text-muted-foreground">
                The client completes the intake from their own verified account —
                the completion link works only when they are signed in as the
                invited email.
              </p>
            )}
          </div>
          <Button className="w-full" onClick={create} disabled={busy}>
            {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
            Create intake draft
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function InvitePanel({ row, onChanged }: { row: IntakeRow; onChanged: () => void }) {
  const createInvite = useMutation(api.intake.createCompletionInvite);
  const revokeInvite = useMutation(api.intake.revokeCompletionInvite);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);

  const live = row.invite && !row.invite.usedAt && !row.invite.revokedAt;

  const issue = async () => {
    setBusy(true);
    try {
      const res = await createInvite({ intakeId: row._id as never });
      const url = `${window.location.origin}/intake/complete?token=${encodeURIComponent(res.token)}`;
      setLink(url);
      toast.success("Completion link issued — it expires in 7 days.");
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not issue the link.");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    setBusy(true);
    try {
      await revokeInvite({ intakeId: row._id as never });
      toast.success("Completion link revoked.");
      setLink(null);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not revoke the link.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-[#B68A45]/40 bg-[#f6f1e6] p-4">
      <p className="type-label ink-faded flex items-center gap-2">
        <Link2 className="size-4" aria-hidden="true" /> Secure client completion
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        {row.clientMode === "existing_client"
          ? "This intake belongs to an existing client. The link works only when they are signed in with the invited email."
          : "An expiring link lets the client complete the intake themselves. The raw token is shown once and never stored."}
      </p>
      {row.invite && (
        <p className="mt-2 text-xs text-muted-foreground">
          {row.invite.usedAt
            ? `Redeemed ${formatDateTimeIN(row.invite.usedAt)}.`
            : row.invite.revokedAt
              ? `Revoked ${formatDateTimeIN(row.invite.revokedAt)}.`
              : `Expires ${formatDateTimeIN(row.invite.expiresAt)}.`}
        </p>
      )}
      {link && (
        <div className="mt-2 flex items-start gap-2 rounded-md border border-[#B68A45]/40 bg-white/70 p-2">
          <code className="min-w-0 flex-1 break-all text-xs">{link}</code>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              void navigator.clipboard?.writeText(link);
              toast.success("Link copied.");
            }}
          >
            <Copy className="size-3.5" aria-hidden="true" />
            Copy
          </Button>
        </div>
      )}
      <div className="mt-3 flex gap-2">
        <Button size="sm" variant="outline" onClick={issue} disabled={busy}>
          {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
          {live ? "Reissue link" : "Issue completion link"}
        </Button>
        {live && (
          <Button size="sm" variant="ghost" onClick={revoke} disabled={busy}>
            Revoke
          </Button>
        )}
      </div>
    </div>
  );
}

function ReviewActions({
  row,
  onChanged,
}: {
  row: IntakeRow;
  onChanged: () => void;
}) {
  const submit = useMutation(api.intake.submit);
  const returnIt = useMutation(api.intake.returnForCorrection);
  const rejectIt = useMutation(api.intake.reject);
  const approveIt = useMutation(api.intake.approve);
  const cancelIt = useMutation(api.intake.cancel);
  const ackDuplicates = useMutation(api.intake.acknowledgeDuplicates);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const run = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(message);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  };

  const definite = (row.duplicateHits ?? []).filter((h) => h.severity === "definite");
  const missing = intakeMissingRequiredFields(row.form ?? {});
  const canSubmitHere =
    mayEditIntake(row.state) && missing.length === 0;

  return (
    <div className="space-y-3">
      {row.reviewNote && (
        <p className="rounded-md border border-border bg-[#f6f1e6] p-2 text-sm text-[#8a6a33]">
          <span className="font-medium">Reviewer:</span> {row.reviewNote}
        </p>
      )}
      <DuplicateWarnings hits={row.duplicateHits ?? []} />

      {mayEditIntake(row.state) && (
        <div className="space-y-2">
          <Label htmlFor="intake-note">Note to reviewer / correction instructions</Label>
          <Textarea
            id="intake-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Anything the reviewer should know…"
            className="min-h-[60px]"
          />
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {mayEditIntake(row.state) && (
          <Button
            onClick={() =>
              run(() => submit({ intakeId: row._id as never }), "Intake submitted for review.")
            }
            disabled={busy || !canSubmitHere}
          >
            {row.state === "returned_for_correction" ? "Resubmit" : "Submit for review"}
          </Button>
        )}
        {row.state === "submitted" && (
          <>
            <Button
              variant="outline"
              disabled={busy || note.trim().length < 5}
              onClick={() =>
                run(() => returnIt({ intakeId: row._id as never, note }), "Returned for correction.")
              }
            >
              Return for correction
            </Button>
            <Button
              variant="outline"
              disabled={busy || note.trim().length < 5}
              onClick={() =>
                run(() => rejectIt({ intakeId: row._id as never, reason: note }), "Intake rejected.")
              }
            >
              Reject
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                run(() => approveIt({ intakeId: row._id as never }), "Approved — client and matter opened.")
              }
            >
              Approve & open matter
            </Button>
          </>
        )}
        {definite.length > 0 && !row.duplicatesAcknowledged && row.state === "submitted" && (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() =>
              run(
                () => ackDuplicates({ intakeId: row._id as never }),
                "Duplicate warning acknowledged — approval may proceed.",
              )
            }
          >
            <AlertTriangle className="mr-1.5 size-4" aria-hidden="true" />
            Acknowledge duplicate
          </Button>
        )}
        {mayEditIntake(row.state) && (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() =>
              run(() => cancelIt({ intakeId: row._id as never }), "Intake cancelled.")
            }
          >
            Cancel intake
          </Button>
        )}
      </div>
      {mayEditIntake(row.state) && missing.length > 0 && (
        <p className="text-xs text-[#8a6a33]">
          {missing.length} required field{missing.length === 1 ? "" : "s"} still open —{" "}
          {missing.slice(0, 3).map((m) => m.label).join(", ")}
          {missing.length > 3 ? ` and ${missing.length - 3} more` : ""}.
        </p>
      )}
    </div>
  );
}

const EMPTY_FORM: IntakeFormData = {};

function IntakeEditor({ row, onChanged }: { row: IntakeRow; onChanged: () => void }) {
  const saveDraft = useMutation(api.intake.saveDraft);
  const recordConsent = useMutation(api.intake.recordConsent);
  const [stage, setStage] = useState<IntakeStage>("identity");
  const [form, setForm] = useState<IntakeFormData>(row.form ?? EMPTY_FORM);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setForm(row.form ?? EMPTY_FORM);
  }, [row._id, row.form]);

  const set = <K extends keyof IntakeFormData>(key: K, value: IntakeFormData[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const setArr = (key: "adverseParties" | "relatedParties" | "witnesses", value: string) =>
    setForm((f) => ({
      ...f,
      [key]: value.split(",").map((s) => s.trim()).filter(Boolean),
    }));

  const save = async () => {
    setBusy(true);
    try {
      await saveDraft({
        intakeId: row._id as never,
        form,
      });
      toast.success("Draft saved.");
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the draft.");
    } finally {
      setBusy(false);
    }
  };

  const missingByStage = useMemo(() => {
    const map = new Map<IntakeStage, number>();
    for (const m of intakeMissingRequiredFields(form)) {
      map.set(m.stage, (map.get(m.stage) ?? 0) + 1);
    }
    return map;
  }, [form]);

  const isOrg = form.clientKind && form.clientKind !== "individual";
  const checklist = kycChecklist(form.clientKind);

  const field =
    "w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B68A45]";

  return (
    <div className="space-y-4">
      {/* Stage rail */}
      <div className="flex flex-wrap gap-1.5">
        {FIRM_STAGES.map((s, i) => (
          <button
            key={s}
            type="button"
            onClick={() => setStage(s)}
            className={`rounded-full border px-3 py-1 text-xs transition-colors ${
              stage === s
                ? "border-[#B68A45] bg-[#B68A45] text-white"
                : "border-[#B68A45]/40 text-[#8a6a33] hover:bg-[#f6f1e6]"
            }`}
            aria-current={stage === s ? "step" : undefined}
          >
            {i + 1}. {STAGE_TITLES[s]}
            {(missingByStage.get(s) ?? 0) > 0 && <span className="ml-1">·</span>}
          </button>
        ))}
      </div>

      {stage === "identity" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Client type</Label>
            <Select value={form.clientKind ?? "individual"} onValueChange={(v) => set("clientKind", v as IntakeClientKind)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {KINDS.map((k) => (
                  <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="i-fullname">{isOrg ? "Contact person (full name)" : "Full name"}</Label>
            <Input id="i-fullname" value={form.fullName ?? ""} onChange={(e) => set("fullName", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="i-email">Email</Label>
            <Input id="i-email" type="email" value={form.email ?? ""} onChange={(e) => set("email", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="i-phone">Phone</Label>
            <Input id="i-phone" value={form.phone ?? ""} onChange={(e) => set("phone", e.target.value)} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="i-addr">Address</Label>
            <Input id="i-addr" value={form.addressLine1 ?? ""} onChange={(e) => set("addressLine1", e.target.value)} placeholder="Flat / building / street" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="i-city">City</Label>
            <Input id="i-city" value={form.city ?? ""} onChange={(e) => set("city", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="i-state">State</Label>
            <Input id="i-state" value={form.stateName ?? ""} onChange={(e) => set("stateName", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="i-pin">PIN code</Label>
            <Input id="i-pin" value={form.pincode ?? ""} onChange={(e) => set("pincode", e.target.value)} maxLength={6} />
          </div>
        </div>
      )}

      {stage === "party_details" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="i-orgname">Name of the organisation</Label>
            <Input id="i-orgname" value={form.organisationName ?? ""} onChange={(e) => set("organisationName", e.target.value)} disabled={!isOrg} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="i-regno">Registration / incorporation no.</Label>
            <Input id="i-regno" value={form.organisationRegistrationNo ?? ""} onChange={(e) => set("organisationRegistrationNo", e.target.value)} disabled={!isOrg} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="i-rep">Authorised representative</Label>
            <Input id="i-rep" value={form.authorisedRepresentative ?? ""} onChange={(e) => set("authorisedRepresentative", e.target.value)} disabled={!isOrg} />
          </div>
          {!isOrg && (
            <p className="text-sm text-muted-foreground sm:col-span-2">
              Organisation details are required for companies, trusts and government bodies.
            </p>
          )}
        </div>
      )}

      {stage === "matter" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Matter type</Label>
            <Select value={form.matterKind ?? "litigation"} onValueChange={(v) => set("matterKind", v as IntakeMatterKind)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {INTAKE_MATTER_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>{MATTER_KIND_LABELS[k]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="i-title">Matter title</Label>
            <Input id="i-title" value={form.matterTitle ?? ""} onChange={(e) => set("matterTitle", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="i-pa">Practice area</Label>
            <Input id="i-pa" value={form.practiceArea ?? ""} onChange={(e) => set("practiceArea", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Urgency</Label>
            <Select value={form.urgency ?? "routine"} onValueChange={(v) => set("urgency", v as IntakeUrgency)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {URGENCIES.map((u) => (
                  <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {form.urgency === "court_deadline" && (
            <div className="space-y-2">
              <Label htmlFor="i-deadline">Deadline date</Label>
              <Input id="i-deadline" type="date" value={form.deadlineDate ?? ""} onChange={(e) => set("deadlineDate", e.target.value)} />
            </div>
          )}
          {form.matterKind === "litigation" && (
            <>
              <div className="space-y-2">
                <Label htmlFor="i-court">Court / forum</Label>
                <Input id="i-court" value={form.court ?? ""} onChange={(e) => set("court", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="i-case">Case number (if filed)</Label>
                <Input id="i-case" value={form.caseNumber ?? ""} onChange={(e) => set("caseNumber", e.target.value)} />
              </div>
            </>
          )}
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="i-desc">Description of the matter</Label>
            <Textarea id="i-desc" value={form.matterDescription ?? ""} onChange={(e) => set("matterDescription", e.target.value)} className="min-h-[90px]" />
          </div>
        </div>
      )}

      {stage === "parties_involved" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="i-adverse">Adverse parties <span className="ink-faded">(comma-separated)</span></Label>
            <Textarea id="i-adverse" value={(form.adverseParties ?? []).join(", ")} onChange={(e) => setArr("adverseParties", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="i-related">Related parties <span className="ink-faded">(comma-separated)</span></Label>
            <Textarea id="i-related" value={(form.relatedParties ?? []).join(", ")} onChange={(e) => setArr("relatedParties", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="i-oc">Opposing counsel</Label>
            <Input id="i-oc" value={form.opposingCounsel ?? ""} onChange={(e) => set("opposingCounsel", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="i-witness">Witnesses <span className="ink-faded">(comma-separated)</span></Label>
            <Input id="i-witness" value={(form.witnesses ?? []).join(", ")} onChange={(e) => setArr("witnesses", e.target.value)} />
          </div>
        </div>
      )}

      {stage === "conflict" && (
        <div className="space-y-3">
          <div className="flex items-start gap-2">
            <Checkbox
              id="i-conflict-ok"
              checked={form.conflictPartiesDisclosed === true}
              onCheckedChange={(v) => set("conflictPartiesDisclosed", v === true)}
            />
            <Label htmlFor="i-conflict-ok" className="font-normal leading-snug">
              All adverse, related and connected parties have been disclosed
              above. The chamber will run its own conflict-of-interest check
              before approval.
            </Label>
          </div>
          <p className="text-xs text-muted-foreground">
            Approval additionally requires a <Link to="/conflicts" className="underline">cleared conflict check</Link>{" "}
            for the proposed client.
          </p>
        </div>
      )}

      {stage === "kyc" && (
        <div className="space-y-2">
          {checklist.map((item) => (
            <label key={item.key} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={(form.kycReceived ?? []).includes(item.key)}
                onCheckedChange={(v) =>
                  set(
                    "kycReceived",
                    v === true
                      ? [...(form.kycReceived ?? []), item.key]
                      : (form.kycReceived ?? []).filter((k) => k !== item.key),
                  )
                }
              />
              {item.label}
              {item.required && <span className="text-xs text-[#8a6a33]">(required)</span>}
            </label>
          ))}
        </div>
      )}

      {stage === "referral" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="i-ref">Referred by</Label>
            <Input id="i-ref" value={form.referredBy ?? ""} onChange={(e) => set("referredBy", e.target.value)} placeholder="Name or source" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="i-rel">Relationship to the client</Label>
            <Input id="i-rel" value={form.referralRelationship ?? ""} onChange={(e) => set("referralRelationship", e.target.value)} />
          </div>
        </div>
      )}

      {stage === "fees" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Fee arrangement</Label>
            <Select value={form.feeType ?? "hourly"} onValueChange={(v) => set("feeType", v as IntakeFormData["feeType"])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="fixed_fee">Fixed fee</SelectItem>
                <SelectItem value="hourly">Hourly</SelectItem>
                <SelectItem value="retainer">Retainer</SelectItem>
                <SelectItem value="pro_bono">Pro bono</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="i-feenotes">Fee notes</Label>
            <Input id="i-feenotes" value={form.feeNotes ?? ""} onChange={(e) => set("feeNotes", e.target.value)} placeholder="e.g. ₹50,000 per hearing" />
          </div>
        </div>
      )}

      {stage === "engagement" && (
        <div className="space-y-3">
          <div className="flex items-start gap-2">
            <Checkbox
              id="i-consent"
              checked={form.consentGiven === true}
              onCheckedChange={(v) => set("consentGiven", v === true)}
            />
            <Label htmlFor="i-consent" className="font-normal leading-snug">
              The client has consented to the chamber acting on this matter.
            </Label>
          </div>
          <p className="text-xs text-muted-foreground">
            Engagement letters are issued from the chamber's approved template.
            Unsigned is not accepted: acceptance is recorded only when the
            client signs.
          </p>
          {engagementIsAccepted(form) ? (
            <p className="flex items-center gap-2 text-sm text-emerald-800">
              <FileSignature className="size-4" aria-hidden="true" />
              Engagement letter accepted (signed {form.engagementSignedAt ? formatDateTimeIN(form.engagementSignedAt) : ""}).
            </p>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                try {
                  await recordConsent({ intakeId: row._id as never, consentNote: "Recorded at the intake desk." });
                  toast.success("Consent recorded.");
                  onChanged();
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Could not record consent.");
                }
              }}
            >
              Record consent (staff)
            </Button>
          )}
        </div>
      )}

      {stage === "risk" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Risk level</Label>
            <Select value={form.riskLevel ?? "low"} onValueChange={(v) => set("riskLevel", v as IntakeFormData["riskLevel"])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="i-risknotes">Risk notes</Label>
            <Textarea id="i-risknotes" value={form.riskNotes ?? ""} onChange={(e) => set("riskNotes", e.target.value)} className="min-h-[70px]" />
          </div>
        </div>
      )}

      {stage === "team" && (
        <div className="space-y-2">
          <Label htmlFor="i-team">Team member user IDs <span className="ink-faded">(comma-separated — team picker comes with Team settings)</span></Label>
          <Input id="i-team" value={(form.teamIds ?? []).join(", ")} onChange={(e) => setArr2(e.target.value, setForm)} placeholder="User ids from Team settings" />
        </div>
      )}

      {stage === "review" && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Review the stages above, save, then submit. Missing required fields
            are marked with a dot in the stage rail.
          </p>
        </div>
      )}

      <div className="flex justify-between border-t border-border pt-4">
        <Button variant="ghost" onClick={() => setStage(FIRM_STAGES[Math.max(0, FIRM_STAGES.indexOf(stage) - 1)]!)} disabled={stage === FIRM_STAGES[0]}>
          Back
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={save} disabled={busy || !mayEditIntake(row.state)}>
            {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
            Save draft
          </Button>
          <Button variant="ghost" onClick={() => setStage(FIRM_STAGES[Math.min(FIRM_STAGES.length - 1, FIRM_STAGES.indexOf(stage) + 1)]!)} disabled={stage === FIRM_STAGES[FIRM_STAGES.length - 1]}>
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}

// Local helper kept outside the component to avoid re-creating per render.
function setArr2(value: string, setForm: React.Dispatch<React.SetStateAction<IntakeFormData>>) {
  setForm((f) => ({
    ...f,
    teamIds: value.split(",").map((s) => s.trim()).filter(Boolean) as string[],
  }));
}

function IntakeDetail({ row, onChanged }: { row: IntakeRow; onChanged: () => void }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className={stateBadgeClass(row.state)}>
          {INTAKE_STATE_LABELS[row.state]}
        </Badge>
        <Badge variant="outline">
          {row.clientMode === "existing_client" ? "Existing client" : "New client"}
        </Badge>
        {row.createdMatterId && (
          <Link to={`/matters/${row.createdMatterId}`} className="type-label flex items-center gap-1 text-primary hover:underline">
            Open the matter →
          </Link>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          Updated {formatDateTimeIN(row.updatedAt)}
          {row.createdByName ? ` · started by ${row.createdByName}` : ""}
        </span>
      </div>

      <IntakeEditor key={row._id} row={row} onChanged={onChanged} />
      <InvitePanel row={row} onChanged={onChanged} />
      <ReviewActions row={row} onChanged={onChanged} />
    </div>
  );
}

export default function Intake() {
  const intakes = useQuery(api.intake.register);
  const caps = useQuery(api.workspace.myCapabilities);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [stateFilter, setStateFilter] = useState("open");

  const canManage =
    (caps?.capabilities.includes("matter.create") ||
      caps?.capabilities.includes("client.edit")) ??
    false;

  // Refresh the selected row when the register subscription updates.
  const selected = useMemo(
    () => (intakes ?? []).find((r) => r._id === selectedId) ?? null,
    [intakes, selectedId],
  );

  const rows = useMemo(() => {
    const list = [...(intakes ?? [])];
    if (stateFilter === "open") {
      return list.filter((r) => ["draft", "submitted", "returned_for_correction"].includes(r.state));
    }
    if (stateFilter === "all") return list;
    return list.filter((r) => r.state === stateFilter);
  }, [intakes, stateFilter]);

  return (
    <ChamberShell subtitle="Client Intake & Matter Opening" title="Intake Desk">
      {!canManage && (
        <Card className="border-[#B68A45]/40">
          <CardContent className="py-6 text-sm text-muted-foreground">
            Your role is not permitted to run client intakes.
          </CardContent>
        </Card>
      )}
      {canManage && selected && (
        <Card className="border-[#B68A45]/40">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="font-serif text-xl">
                {selected.prospectiveName || "Unnamed prospective client"}
              </CardTitle>
              <Button variant="ghost" size="sm" onClick={() => setSelectedId(null)}>
                Back to register
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <IntakeDetail row={selected} onChanged={() => { /* subscription updates automatically */ }} />
          </CardContent>
        </Card>
      )}
      {canManage && !selected && (
        <>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="w-48">
              <p className="type-label ink-faded mb-1.5">Status</p>
              <Select value={stateFilter} onValueChange={setStateFilter}>
                <SelectTrigger aria-label="Filter intakes by status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Open (draft / review)</SelectItem>
                  <SelectItem value="draft">Drafts</SelectItem>
                  <SelectItem value="submitted">Awaiting review</SelectItem>
                  <SelectItem value="returned_for_correction">Returned</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                  <SelectItem value="all">All</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <NewIntakeDialog onChanged={() => { /* subscription updates automatically */ }} />
          </div>
          <div className="rule-frame mt-4 overflow-x-auto rounded-lg">
            {intakes === undefined ? (
              <p className="p-6 text-sm text-muted-foreground">Opening the intake desk…</p>
            ) : rows.length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground">
                No intakes yet. Start one with “New intake”, or share a completion link
                from an existing intake.
              </p>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Prospective client</th>
                    <th scope="col">Status</th>
                    <th scope="col">Mode</th>
                    <th scope="col">Conflicts</th>
                    <th scope="col">Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r._id}
                      className="cursor-pointer hover:bg-accent/40"
                      onClick={() => setSelectedId(r._id)}
                    >
                      <td className="font-medium">{r.prospectiveName || "—"}</td>
                      <td>
                        <Badge variant="outline" className={stateBadgeClass(r.state)}>
                          {INTAKE_STATE_LABELS[r.state]}
                        </Badge>
                      </td>
                      <td className="text-muted-foreground">
                        {r.clientMode === "existing_client" ? "Existing" : "New"}
                      </td>
                      <td>
                        {r.conflictCheckId ? (
                          <span className="flex items-center gap-1 text-[#8a6a33]">
                            <ShieldCheck className="size-3.5" aria-hidden="true" /> attached
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-muted-foreground">
                            <ShieldAlert className="size-3.5" aria-hidden="true" /> pending
                          </span>
                        )}
                      </td>
                      <td className="text-muted-foreground">
                        {r.createdMatterId ? (
                          <Link
                            to={`/matters/${r.createdMatterId}`}
                            className="type-label flex items-center gap-1 text-primary hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <CalendarClock className="size-3.5" aria-hidden="true" /> matter opened
                          </Link>
                        ) : r.state === "rejected" ? (
                          "declined"
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </ChamberShell>
  );
}
