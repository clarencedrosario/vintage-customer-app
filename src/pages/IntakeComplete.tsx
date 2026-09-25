import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
  INTAKE_MATTER_KINDS,
  INTAKE_STATE_LABELS,
  engagementIsAccepted,
  intakeMissingRequiredFields,
  kycChecklist,
  mayEditIntake,
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
  CheckCircle2,
  FileSignature,
  Loader2,
  Lock,
  ScrollText,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";

type IntakeRow = {
  _id: string;
  state: IntakeState;
  form: IntakeFormData;
  prospectiveName: string;
  clientMode: "new_client" | "existing_client";
  duplicateHits?: unknown;
  reviewNote?: string;
  invite?: { email: string; expiresAt: number; usedAt?: number; revokedAt?: number } | null;
  clientUserId?: string;
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

const CLIENT_STAGES: IntakeStage[] = [
  "identity",
  "party_details",
  "matter",
  "parties_involved",
  "conflict",
  "kyc",
  "referral",
  "fees",
  "engagement",
  "review",
];

const KINDS: { value: IntakeClientKind; label: string }[] = [
  { value: "individual", label: "Individual" },
  { value: "company", label: "Company" },
  { value: "trust", label: "Trust" },
  { value: "government", label: "Government" },
];

const MATTER_KIND_LABELS: Record<IntakeMatterKind, string> = {
  litigation: "Litigation",
  advisory: "Advisory",
  transaction: "Transaction",
  compliance: "Compliance",
};

const URGENCIES: { value: IntakeUrgency; label: string }[] = [
  { value: "routine", label: "Routine" },
  { value: "time_sensitive", label: "Time-sensitive" },
  { value: "court_deadline", label: "Court deadline" },
];

function ClientWizard({
  row,
  onSave,
  onSubmit,
  onAcceptEngagement,
  busy,
}: {
  row: IntakeRow;
  onSave: (form: IntakeFormData) => Promise<void>;
  onSubmit: () => Promise<void>;
  onAcceptEngagement: (template?: string) => Promise<void>;
  busy: boolean;
}) {
  const [stage, setStage] = useState<IntakeStage>("identity");
  const [form, setForm] = useState<IntakeFormData>(row.form ?? {});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm(row.form ?? {});
  }, [row._id, row.form]);

  const set = <K extends keyof IntakeFormData>(key: K, value: IntakeFormData[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const setArr = (key: "adverseParties" | "relatedParties" | "witnesses", value: string) =>
    setForm((f) => ({
      ...f,
      [key]: value.split(",").map((s) => s.trim()).filter(Boolean),
    }));

  const missingByStage = useMemo(() => {
    const map = new Map<IntakeStage, number>();
    for (const m of intakeMissingRequiredFields(form)) {
      map.set(m.stage, (map.get(m.stage) ?? 0) + 1);
    }
    return map;
  }, [form]);

  const missing = intakeMissingRequiredFields(form);
  const isOrg = form.clientKind && form.clientKind !== "individual";
  const checklist = kycChecklist(form.clientKind);
  const editable = mayEditIntake(row.state);

  const doSave = async () => {
    setSaving(true);
    try {
      await onSave(form);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {row.reviewNote && (
        <p className="rounded-md border border-amber-500/50 bg-amber-50/70 p-3 text-sm text-amber-900">
          <span className="font-medium">Returned for correction:</span> {row.reviewNote}
        </p>
      )}
      {!editable && (
        <p className="rounded-md border border-border bg-[#f6f1e6] p-3 text-sm text-[#8a6a33]">
          This intake is {INTAKE_STATE_LABELS[row.state].toLowerCase()} and can no longer be edited.
        </p>
      )}

      <div className="flex flex-wrap gap-1.5">
        {CLIENT_STAGES.map((s, i) => (
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
            <Select value={form.clientKind ?? "individual"} onValueChange={(v) => set("clientKind", v as IntakeClientKind)} disabled={!editable}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {KINDS.map((k) => (
                  <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="c-fullname">{isOrg ? "Contact person (full name)" : "Full name"}</Label>
            <Input id="c-fullname" value={form.fullName ?? ""} onChange={(e) => set("fullName", e.target.value)} disabled={!editable} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="c-email">Email</Label>
            <Input id="c-email" type="email" value={form.email ?? ""} onChange={(e) => set("email", e.target.value)} disabled={!editable} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="c-phone">Phone</Label>
            <Input id="c-phone" value={form.phone ?? ""} onChange={(e) => set("phone", e.target.value)} disabled={!editable} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="c-addr">Address</Label>
            <Input id="c-addr" value={form.addressLine1 ?? ""} onChange={(e) => set("addressLine1", e.target.value)} disabled={!editable} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="c-city">City</Label>
            <Input id="c-city" value={form.city ?? ""} onChange={(e) => set("city", e.target.value)} disabled={!editable} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="c-state">State</Label>
            <Input id="c-state" value={form.stateName ?? ""} onChange={(e) => set("stateName", e.target.value)} disabled={!editable} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="c-pin">PIN code</Label>
            <Input id="c-pin" value={form.pincode ?? ""} onChange={(e) => set("pincode", e.target.value)} maxLength={6} disabled={!editable} />
          </div>
        </div>
      )}

      {stage === "party_details" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="c-orgname">Name of the organisation</Label>
            <Input id="c-orgname" value={form.organisationName ?? ""} onChange={(e) => set("organisationName", e.target.value)} disabled={!editable || !isOrg} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="c-regno">Registration / incorporation no.</Label>
            <Input id="c-regno" value={form.organisationRegistrationNo ?? ""} onChange={(e) => set("organisationRegistrationNo", e.target.value)} disabled={!editable || !isOrg} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="c-rep">Authorised representative</Label>
            <Input id="c-rep" value={form.authorisedRepresentative ?? ""} onChange={(e) => set("authorisedRepresentative", e.target.value)} disabled={!editable || !isOrg} />
          </div>
        </div>
      )}

      {stage === "matter" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Matter type</Label>
            <Select value={form.matterKind ?? "litigation"} onValueChange={(v) => set("matterKind", v as IntakeMatterKind)} disabled={!editable}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {INTAKE_MATTER_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>{MATTER_KIND_LABELS[k]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="c-title">Matter title</Label>
            <Input id="c-title" value={form.matterTitle ?? ""} onChange={(e) => set("matterTitle", e.target.value)} disabled={!editable} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="c-pa">Practice area</Label>
            <Input id="c-pa" value={form.practiceArea ?? ""} onChange={(e) => set("practiceArea", e.target.value)} disabled={!editable} />
          </div>
          <div className="space-y-2">
            <Label>Urgency</Label>
            <Select value={form.urgency ?? "routine"} onValueChange={(v) => set("urgency", v as IntakeUrgency)} disabled={!editable}>
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
              <Label htmlFor="c-deadline">Deadline date</Label>
              <Input id="c-deadline" type="date" value={form.deadlineDate ?? ""} onChange={(e) => set("deadlineDate", e.target.value)} disabled={!editable} />
            </div>
          )}
          {form.matterKind === "litigation" && (
            <div className="space-y-2">
              <Label htmlFor="c-court">Court / forum</Label>
              <Input id="c-court" value={form.court ?? ""} onChange={(e) => set("court", e.target.value)} disabled={!editable} />
            </div>
          )}
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="c-desc">Describe the matter</Label>
            <Textarea id="c-desc" value={form.matterDescription ?? ""} onChange={(e) => set("matterDescription", e.target.value)} className="min-h-[90px]" disabled={!editable} />
          </div>
        </div>
      )}

      {stage === "parties_involved" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="c-adverse">Adverse parties <span className="ink-faded">(comma-separated)</span></Label>
            <Textarea id="c-adverse" value={(form.adverseParties ?? []).join(", ")} onChange={(e) => setArr("adverseParties", e.target.value)} disabled={!editable} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="c-related">Related parties <span className="ink-faded">(comma-separated)</span></Label>
            <Textarea id="c-related" value={(form.relatedParties ?? []).join(", ")} onChange={(e) => setArr("relatedParties", e.target.value)} disabled={!editable} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="c-witness">Witnesses <span className="ink-faded">(comma-separated)</span></Label>
            <Input id="c-witness" value={(form.witnesses ?? []).join(", ")} onChange={(e) => setArr("witnesses", e.target.value)} disabled={!editable} />
          </div>
        </div>
      )}

      {stage === "conflict" && (
        <div className="flex items-start gap-2">
          <Checkbox
            id="c-conflict-ok"
            checked={form.conflictPartiesDisclosed === true}
            onCheckedChange={(v) => set("conflictPartiesDisclosed", v === true)}
            disabled={!editable}
          />
          <Label htmlFor="c-conflict-ok" className="font-normal leading-snug">
            All adverse, related and connected parties have been disclosed above.
          </Label>
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
                disabled={!editable}
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
            <Label htmlFor="c-ref">Referred by</Label>
            <Input id="c-ref" value={form.referredBy ?? ""} onChange={(e) => set("referredBy", e.target.value)} disabled={!editable} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="c-rel">Relationship to the client</Label>
            <Input id="c-rel" value={form.referralRelationship ?? ""} onChange={(e) => set("referralRelationship", e.target.value)} disabled={!editable} />
          </div>
        </div>
      )}

      {stage === "fees" && (
        <div className="space-y-2">
          <Label>Fee arrangement preference</Label>
          <Select value={form.feeType ?? "hourly"} onValueChange={(v) => set("feeType", v as IntakeFormData["feeType"])} disabled={!editable}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="fixed_fee">Fixed fee</SelectItem>
              <SelectItem value="hourly">Hourly</SelectItem>
              <SelectItem value="retainer">Retainer</SelectItem>
              <SelectItem value="pro_bono">Pro bono</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            The chamber confirms the final fee arrangement before approval.
          </p>
        </div>
      )}

      {stage === "engagement" && (
        <div className="space-y-3">
          <div className="flex items-start gap-2">
            <Checkbox
              id="c-consent"
              checked={form.consentGiven === true}
              onCheckedChange={(v) => set("consentGiven", v === true)}
              disabled={!editable}
            />
            <Label htmlFor="c-consent" className="font-normal leading-snug">
              I consent to the chamber acting for me on this matter and confirm
              the information above is true.
            </Label>
          </div>
          <div className="rounded-lg border border-[#B68A45]/40 bg-[#f6f1e6] p-3">
            <p className="flex items-center gap-2 text-sm font-medium text-[#8a6a33]">
              <ScrollText className="size-4" aria-hidden="true" /> Engagement letter (chamber template)
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Signing below records your acceptance of the chamber's standard
              engagement letter. Unsigned is not accepted — approval is blocked
              until the letter is signed.
            </p>
            {engagementIsAccepted(form) ? (
              <p className="mt-2 flex items-center gap-2 text-sm text-emerald-800">
                <FileSignature className="size-4" aria-hidden="true" />
                Signed {form.engagementSignedAt ? formatDateTimeIN(form.engagementSignedAt) : ""}.
              </p>
            ) : (
              <Button
                size="sm"
                className="mt-2"
                disabled={!editable || busy}
                onClick={() => void onAcceptEngagement()}
              >
                Sign the engagement letter
              </Button>
            )}
          </div>
        </div>
      )}

      {stage === "review" && (
        <div className="space-y-3">
          {missing.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-emerald-800">
              <CheckCircle2 className="size-4" aria-hidden="true" />
              All required fields are complete.
            </p>
          ) : (
            <div className="rounded-lg border border-amber-500/50 bg-amber-50/70 p-3">
              <p className="flex items-center gap-1.5 text-sm font-medium text-amber-800">
                <AlertTriangle className="size-4" aria-hidden="true" />
                {missing.length} required field{missing.length === 1 ? "" : "s"} to complete
              </p>
              <ul className="mt-1 list-disc pl-5 text-sm text-muted-foreground">
                {missing.slice(0, 6).map((m) => (
                  <li key={`${m.stage}-${m.key}`}>{m.label}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={doSave} disabled={!editable || busy || saving}>
              {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
              Save draft
            </Button>
            <Button
              onClick={onSubmit}
              disabled={!editable || busy || missing.length > 0}
            >
              Submit to the chamber
            </Button>
          </div>
        </div>
      )}

      <div className="flex justify-between border-t border-border pt-4">
        <Button variant="ghost" onClick={() => setStage(CLIENT_STAGES[Math.max(0, CLIENT_STAGES.indexOf(stage) - 1)]!)} disabled={stage === CLIENT_STAGES[0]}>
          Back
        </Button>
        <Button variant="ghost" onClick={() => setStage(CLIENT_STAGES[Math.min(CLIENT_STAGES.length - 1, CLIENT_STAGES.indexOf(stage) + 1)]!)} disabled={stage === CLIENT_STAGES[CLIENT_STAGES.length - 1]}>
          Next
        </Button>
      </div>
    </div>
  );
}

export default function IntakeComplete() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const navigate = useNavigate();

  const info = useQuery(api.intake.inspectCompletionToken, token ? { token } : "skip");
  const row = useQuery(
    api.intake.getForClient,
    info?.clientMode === "existing_client" && info.intakeId ? { intakeId: info.intakeId as Id<"intakes"> } : "skip",
  );

  const tokenSave = useMutation(api.intake.clientTokenSaveDraft);
  const tokenSubmit = useMutation(api.intake.clientTokenSubmit);
  const tokenSign = useMutation(api.intake.clientTokenAcceptEngagement);
  const clientSave = useMutation(api.intake.clientSaveDraft);
  const clientSubmit = useMutation(api.intake.clientSubmit);
  const clientSign = useMutation(api.intake.acceptEngagement);

  const [busy, setBusy] = useState(false);

  const existingAuthNeeded =
    info !== undefined && info !== null && info.clientMode === "existing_client";

  if (!token) {
    return (
      <Centered>
        <p className="text-sm text-muted-foreground">
          This page needs a completion link. Ask your advocate to share one.
        </p>
      </Centered>
    );
  }

  if (info === undefined) {
    return (
      <Centered>
        <Loader2 className="size-5 animate-spin text-[#8a6a33]" />
      </Centered>
    );
  }

  if (info === null) {
    return (
      <Centered>
        <p className="font-serif text-lg font-semibold">Link not valid</p>
        <p className="mt-2 max-w-md text-center text-sm text-muted-foreground">
          This completion link is not valid, has expired (links last 7 days),
          has been revoked, or has already been used. Ask the chamber to issue
          a fresh one.
        </p>
      </Centered>
    );
  }

  if (existingAuthNeeded && row === undefined) {
    return (
      <Centered>
        <Loader2 className="size-5 animate-spin text-[#8a6a33]" />
      </Centered>
    );
  }

  // Existing client not signed in as the invited email → send to /login
  // with a return path that preserves the token.
  if (existingAuthNeeded && row === null) {
    return (
      <Centered>
        <p className="flex items-center gap-2 font-serif text-lg font-semibold">
          <Lock className="size-5 text-[#8a6a33]" aria-hidden="true" />
          Sign in to continue
        </p>
        <p className="mt-2 max-w-md text-center text-sm text-muted-foreground">
          This intake belongs to an existing client. Sign in with the invited
          email address to view and complete it.
        </p>
        <Button
          className="mt-4"
          onClick={() =>
            navigate(`/login?returnTo=${encodeURIComponent(`/intake/complete?token=${token}`)}`)
          }
        >
          Sign in
        </Button>
      </Centered>
    );
  }

  const intake = (existingAuthNeeded ? row : null) as IntakeRow | null;
  const viaToken = !existingAuthNeeded;

  const save = async (form: IntakeFormData) => {
    setBusy(true);
    try {
      if (viaToken) {
        await tokenSave({ token, form });
      } else {
        await clientSave({ intakeId: intake!._id as never, form });
      }
      toast.success("Draft saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the draft.");
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    setBusy(true);
    try {
      if (viaToken) {
        await tokenSubmit({ token });
      } else {
        await clientSubmit({ intakeId: intake!._id as never });
      }
      toast.success("Submitted to the chamber for review.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not submit.");
    } finally {
      setBusy(false);
    }
  };

  const acceptEngagement = async () => {
    setBusy(true);
    try {
      if (viaToken) {
        await tokenSign({ token });
      } else {
        await clientSign({ intakeId: intake!._id as never });
      }
      toast.success("Engagement letter signed.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not sign.");
    } finally {
      setBusy(false);
    }
  };

  const displayRow: IntakeRow = viaToken
    ? {
        _id: "token",
        state: "draft",
        form: {},
        prospectiveName: info!.prospectiveName,
        clientMode: "new_client",
        reviewNote: undefined,
        updatedAt: Date.now(),
      }
    : intake!;

  return (
    <Centered wide>
      <div className="w-full max-w-3xl space-y-4">
        <div className="text-center">
          <p className="type-label ink-faded">Client Intake — Advokate Digital Chamber</p>
          <h1 className="mt-1 font-serif text-2xl font-semibold">
            {displayRow.prospectiveName || "Your intake"}
          </h1>
          {existingAuthNeeded && (
            <Badge variant="outline" className="mt-2 border-[#B68A45]/50 text-[#8a6a33]">
              Signed in as {info!.email}
            </Badge>
          )}
        </div>
        <Card className="border-[#B68A45]/40">
          <CardContent className="pt-4">
            {viaToken ? (
              <ClientWizard
                row={displayRow}
                busy={busy}
                onSave={save}
                onSubmit={submit}
                onAcceptEngagement={acceptEngagement}
              />
            ) : (
              <ClientWizard
                row={displayRow}
                busy={busy}
                onSave={save}
                onSubmit={submit}
                onAcceptEngagement={acceptEngagement}
              />
            )}
          </CardContent>
        </Card>
        <p className="text-center text-xs text-muted-foreground">
          Your information is shared only with the chamber acting for you.{" "}
          <Link to="/" className="underline">Advokate Digital Chamber</Link>
        </p>
      </div>
    </Centered>
  );
}

function Centered({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`mx-auto flex min-h-screen w-full flex-col items-center justify-center bg-background px-4 ${wide ? "py-10" : ""}`}>
      {children}
    </div>
  );
}
