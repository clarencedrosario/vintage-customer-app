import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { Banknote, FileDown, Landmark, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { formatINR } from "@/lib/format";

const STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  draft: "secondary",
  in_review: "secondary",
  approved: "default",
  finalized: "default",
  reversed: "destructive",
};

type ComponentDraft = {
  component: string;
  rupees: string;
  type: "earning" | "deduction";
};

function toPaise(rupees: string): number | null {
  const n = Number(rupees);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/** Create a salary structure: a new effective-dated row each save. */
function SaveStructureDialog({
  open,
  onOpenChange,
  employees,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  employees: {
    _id: string;
    employeeCode: string;
    firstName: string;
    lastName: string;
  }[];
}) {
  const save = useMutation(api.payroll.saveSalaryStructure);
  const [employeeId, setEmployeeId] = useState<string>("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [rows, setRows] = useState<ComponentDraft[]>([
    { component: "Basic", rupees: "", type: "earning" },
  ]);

  const addRow = () =>
    setRows((r) => [...r, { component: "", rupees: "", type: "earning" }]);
  const updateRow = (i: number, patch: Partial<ComponentDraft>) =>
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  const removeRow = (i: number) =>
    setRows((r) => (r.length > 1 ? r.filter((_, idx) => idx !== i) : r));

  const submit = async () => {
    if (!employeeId) {
      toast.error("Pick an employee.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) {
      toast.error("Pick an effective-from date.");
      return;
    }
    const monthlyPaise: {
      component: string;
      amountPaise: number;
      type: "earning" | "deduction";
    }[] = [];
    for (const row of rows) {
      const paise = toPaise(row.rupees);
      if (paise === null) {
        toast.error(
          `Amount for ${row.component || "component"} must be a valid rupee figure.`,
        );
        return;
      }
      if (!row.component.trim()) {
        toast.error("Every component needs a name.");
        return;
      }
      monthlyPaise.push({
        component: row.component.trim(),
        amountPaise: paise,
        type: row.type,
      });
    }
    try {
      await save({
        employeeId: employeeId as Id<"employees">,
        effectiveFrom,
        monthlyPaise,
      });
      toast.success("Salary structure saved as a new effective-dated row.");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Salary structure</DialogTitle>
          <DialogDescription>
            Saved as a new effective-dated row — history is never overwritten.
            Amounts are per month, in rupees (stored as exact paise).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Employee</Label>
              <Select value={employeeId} onValueChange={setEmployeeId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select employee" />
                </SelectTrigger>
                <SelectContent>
                  {employees.map((e) => (
                    <SelectItem key={e._id} value={e._id}>
                      {e.employeeCode} — {e.firstName} {e.lastName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Effective from</Label>
              <Input
                type="date"
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Components</Label>
            {rows.map((row, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  className="flex-1"
                  placeholder="Component name"
                  value={row.component}
                  onChange={(e) => updateRow(i, { component: e.target.value })}
                />
                <Input
                  className="w-28"
                  inputMode="decimal"
                  placeholder="₹ / month"
                  value={row.rupees}
                  onChange={(e) => updateRow(i, { rupees: e.target.value })}
                />
                <Select
                  value={row.type}
                  onValueChange={(v) =>
                    updateRow(i, { type: v as "earning" | "deduction" })
                  }
                >
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="earning">Earning</SelectItem>
                    <SelectItem value="deduction">Deduction</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Remove component"
                  onClick={() => removeRow(i)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button size="sm" variant="outline" onClick={addRow}>
              <Plus className="mr-1 h-3.5 w-3.5" /> Add component
            </Button>
          </div>
          <Button className="w-full" onClick={submit}>
            Save structure
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
type StatutoryKind = "pf" | "esi" | "pt" | "tds" | "lwf" | "gratuity";

const KIND_LABELS: Record<StatutoryKind, string> = {
  pf: "Provident Fund",
  esi: "ESIC",
  pt: "Professional Tax",
  tds: "TDS",
  lwf: "Labour Welfare Fund",
  gratuity: "Gratuity",
};

function rupeesToPaise(v: string): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

/** Percent input ("12", "12.5") → integer basis points. */
function pctToBps(v: string): number | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function NumField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

/**
 * Enter the org's own verified statutory values — versioned rows, no
 * defaults. Payroll refuses to run while any required kind is missing.
 */
function StatutoryDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const save = useMutation(api.hr.saveStatutorySetting);
  const [kind, setKind] = useState<StatutoryKind>("pf");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [ceiling, setCeiling] = useState("");
  const [pfEmp, setPfEmp] = useState("");
  const [pfEr, setPfEr] = useState("");
  const [edli, setEdli] = useState("");
  const [esiEmp, setEsiEmp] = useState("");
  const [esiEr, setEsiEr] = useState("");
  const [stateCode, setStateCode] = useState("");
  const [slabs, setSlabs] = useState<{ above: string; tax: string }[]>([
    { above: "0", tax: "" },
  ]);
  const [tdsSection, setTdsSection] = useState("");
  const [tdsRate, setTdsRate] = useState("");
  const [tdsThreshold, setTdsThreshold] = useState("");
  const [lwfEmp, setLwfEmp] = useState("");
  const [lwfEr, setLwfEr] = useState("");
  const [gratDays, setGratDays] = useState("");
  const [gratDiv, setGratDiv] = useState("");
  const [gratYears, setGratYears] = useState("");

  const submit = async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) {
      toast.error("Pick an effective-from date.");
      return;
    }
    let spec: Record<string, unknown> | null = null;
    if (kind === "pf" || kind === "esi") {
      const ceil = rupeesToPaise(ceiling);
      const emp = pctToBps(kind === "pf" ? pfEmp : esiEmp);
      const er = pctToBps(kind === "pf" ? pfEr : esiEr);
      if (ceil === null || emp === null || er === null) {
        toast.error("Wage ceiling and rates are required.");
        return;
      }
      spec =
        kind === "pf"
          ? {
              wageCeilingPaise: ceil,
              employeeRateBps: emp,
              employerRateBps: er,
              ...(edli !== ""
                ? { employerRateEdliBps: pctToBps(edli) ?? 0 }
                : {}),
            }
          : { wageCeilingPaise: ceil, employeeRateBps: emp, employerRateBps: er };
    } else if (kind === "pt") {
      if (!stateCode.trim() || slabs.length === 0) {
        toast.error("PT needs a registered state and at least one slab.");
        return;
      }
      const built: { incomeAbovePaise: number; taxPaise: number }[] = [];
      for (const s of slabs) {
        const above = rupeesToPaise(s.above);
        const tax = rupeesToPaise(s.tax);
        if (above === null || tax === null) {
          toast.error("Each PT slab needs a threshold and a tax amount.");
          return;
        }
        built.push({ incomeAbovePaise: above, taxPaise: tax });
      }
      spec = { stateCode: stateCode.trim().toUpperCase(), stateSlabs: built };
    } else if (kind === "tds") {
      const rate = pctToBps(tdsRate);
      if (!tdsSection.trim() || rate === null) {
        toast.error("TDS needs a section and a rate.");
        return;
      }
      spec = {
        section: tdsSection.trim(),
        rateBps: rate,
        ...(tdsThreshold !== ""
          ? { thresholdPaise: rupeesToPaise(tdsThreshold) ?? 0 }
          : {}),
      };
    } else if (kind === "lwf") {
      const emp = rupeesToPaise(lwfEmp);
      const er = rupeesToPaise(lwfEr);
      if (!stateCode.trim() || emp === null || er === null) {
        toast.error("LWF needs the registered state and both contributions.");
        return;
      }
      spec = {
        stateCode: stateCode.trim().toUpperCase(),
        employeeContributionPaise: emp,
        employerContributionPaise: er,
      };
    } else {
      const days = Number(gratDays);
      const div = Number(gratDiv);
      const years = Number(gratYears);
      if (
        !Number.isFinite(days) ||
        days < 15 ||
        !Number.isFinite(div) ||
        div < 20 ||
        !Number.isFinite(years) ||
        years < 0
      ) {
        toast.error(
          "Gratuity: daysPerYear ≥ 15, per-day divisor ≥ 20, eligibility years ≥ 0.",
        );
        return;
      }
      spec = {
        daysPerYear: days,
        perDayBasisDivisor: div,
        eligibilityYears: years,
      };
    }
    try {
      await save({ kind, spec, effectiveFrom });
      toast.success(
        `${KIND_LABELS[kind]} saved as a new versioned row. Payroll can now use it.`,
      );
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Statutory setting</DialogTitle>
          <DialogDescription>
            Enter values you have verified for this employer — nothing ships
            with the product. Saving creates a new versioned row effective from
            the chosen date; payroll freezes whatever it used.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Kind</Label>
              <Select
                value={kind}
                onValueChange={(v) => setKind(v as StatutoryKind)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(KIND_LABELS) as StatutoryKind[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {KIND_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Effective from</Label>
              <Input
                type="date"
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
              />
            </div>
          </div>

          {(kind === "pf" || kind === "esi") && (
            <div className="grid gap-3 sm:grid-cols-2">
              <NumField
                label="Wage ceiling (₹/month)"
                value={ceiling}
                onChange={setCeiling}
              />
              <NumField
                label="Employee rate %"
                value={kind === "pf" ? pfEmp : esiEmp}
                onChange={kind === "pf" ? setPfEmp : setEsiEmp}
              />
              <NumField
                label="Employer rate %"
                value={kind === "pf" ? pfEr : esiEr}
                onChange={kind === "pf" ? setPfEr : setEsiEr}
              />
              {kind === "pf" && (
                <NumField
                  label="EDLI % (optional)"
                  value={edli}
                  onChange={setEdli}
                />
              )}
            </div>
          )}

          {(kind === "pt" || kind === "lwf") && (
            <div className="space-y-1.5">
              <Label>Registered state code</Label>
              <Input
                value={stateCode}
                onChange={(e) => setStateCode(e.target.value)}
                placeholder="e.g. KA"
              />
            </div>
          )}

          {kind === "pt" && (
            <div className="space-y-2">
              <Label>State slabs (monthly gross above ₹ → tax ₹)</Label>
              {slabs.map((s, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    className="flex-1"
                    inputMode="decimal"
                    placeholder="above ₹"
                    value={s.above}
                    onChange={(e) =>
                      setSlabs((rows) =>
                        rows.map((r, idx) =>
                          idx === i ? { ...r, above: e.target.value } : r,
                        ),
                      )
                    }
                  />
                  <Input
                    className="flex-1"
                    inputMode="decimal"
                    placeholder="tax ₹"
                    value={s.tax}
                    onChange={(e) =>
                      setSlabs((rows) =>
                        rows.map((r, idx) =>
                          idx === i ? { ...r, tax: e.target.value } : r,
                        ),
                      )
                    }
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Remove slab"
                    onClick={() =>
                      setSlabs((rows) =>
                        rows.length > 1
                          ? rows.filter((_, idx) => idx !== i)
                          : rows,
                      )
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setSlabs((rows) => [...rows, { above: "", tax: "" }])
                }
              >
                <Plus className="mr-1 h-3.5 w-3.5" /> Add slab
              </Button>
            </div>
          )}

          {kind === "tds" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Section (e.g. 192)</Label>
                <Input
                  value={tdsSection}
                  onChange={(e) => setTdsSection(e.target.value)}
                />
              </div>
              <NumField label="Rate %" value={tdsRate} onChange={setTdsRate} />
              <NumField
                label="Threshold (₹, optional)"
                value={tdsThreshold}
                onChange={setTdsThreshold}
              />
            </div>
          )}

          {kind === "lwf" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <NumField
                label="Employee contribution (₹)"
                value={lwfEmp}
                onChange={setLwfEmp}
              />
              <NumField
                label="Employer contribution (₹)"
                value={lwfEr}
                onChange={setLwfEr}
              />
            </div>
          )}

          {kind === "gratuity" && (
            <div className="grid gap-3 sm:grid-cols-3">
              <NumField
                label="Days per year (≥15)"
                value={gratDays}
                onChange={setGratDays}
              />
              <NumField
                label="Per-day divisor (≥20)"
                value={gratDiv}
                onChange={setGratDiv}
              />
              <NumField
                label="Eligibility years (≥0)"
                value={gratYears}
                onChange={setGratYears}
              />
            </div>
          )}

          <Button className="w-full" onClick={submit}>
            Save statutory setting
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function PayrollPanel() {
  const runs = useQuery(api.payroll.listRuns);
  const employees = useQuery(api.hr.listEmployees);
  const prereqs = useQuery(api.hr.payrollPrerequisites);

  const [selectedRunId, setSelectedRunId] = useState<Id<"payrollRuns"> | null>(
    null,
  );
  const runData = useQuery(
    api.payroll.getRun,
    selectedRunId ? { runId: selectedRunId } : "skip",
  );

  const createRun = useMutation(api.payroll.createRun);
  const submitForReview = useMutation(api.payroll.submitForReview);
  const approveRun = useMutation(api.payroll.approveRun);
  const finalizeRun = useMutation(api.payroll.finalizeRun);
  const generateBankFile = useMutation(api.payroll.generateBankFile);
  const markPaymentsMade = useMutation(api.payroll.markPaymentsMade);
  const reverseRun = useMutation(api.payroll.reverseRunByOperator);

  const [period, setPeriod] = useState("");
  const [structureOpen, setStructureOpen] = useState(false);
  const [statutoryOpen, setStatutoryOpen] = useState(false);
  const [reversing, setReversing] = useState(false);
  const [reverseReason, setReverseReason] = useState("");

  const run = runData?.run;
  const payslips = runData?.payslips ?? [];

  const act = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      toast.success(done);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed.");
    }
  };

  const employeesForPicker = (employees ?? []).map((e) => ({
    _id: e._id,
    employeeCode: e.employeeCode,
    firstName: e.firstName,
    lastName: e.lastName,
  }));

  return (
    <div className="space-y-6">
      <Card className="rule-frame bg-card">
        <CardContent className="pt-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Payroll runs</p>
              <p className="type-label mt-1 ink-faded">
                draft → in_review → approved → finalized (+ reversed).
                Approvals need payroll.approve; finalization posts the balanced
                journal and needs finance.manage. Bank files and payment marking
                are separate on purpose — a produced file is never "money
                moved".
              </p>
            </div>
            <div className="flex items-end gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="payroll-period">Period</Label>
                <Input
                  id="payroll-period"
                  type="month"
                  className="w-40"
                  value={period}
                  onChange={(e) => setPeriod(e.target.value)}
                />
              </div>
              <Button
                disabled={!period}
                onClick={() =>
                  act(async () => {
                    const res = await createRun({ period });
                    setSelectedRunId(res.runId);
                    setPeriod("");
                  }, "Payroll run created (draft).")
                }
              >
                <Landmark className="mr-2 h-4 w-4" /> Create run
              </Button>
              <Button variant="outline" onClick={() => setStructureOpen(true)}>
                <Banknote className="mr-2 h-4 w-4" /> Salary structure
              </Button>
              <Button variant="outline" onClick={() => setStatutoryOpen(true)}>
                Statutory setting
              </Button>
            </div>
          </div>

          {prereqs && prereqs.employeesWithoutStructures !== null && (
            <p className="type-label mt-3 text-amber-700 dark:text-amber-400">
              {prereqs.employeesWithoutStructures} employee record(s) have no
              applicable salary structure and will be skipped with a reason.
            </p>
          )}

          {runs === undefined ? (
            <p className="mt-4 text-sm ink-faded">Loading…</p>
          ) : runs.length === 0 ? (
            <p className="mt-4 text-sm ink-faded">
              No runs yet. Creating a run freezes the current statutory
              configuration — later edits never alter a past run.
            </p>
          ) : (
            <div className="mt-4 space-y-1.5">
              {runs
                .slice()
                .sort((a, b) => b.period.localeCompare(a.period))
                .map((r) => (
                  <button
                    key={r._id}
                    type="button"
                    onClick={() => setSelectedRunId(r._id)}
                    className={`flex w-full flex-wrap items-center justify-between gap-2 rounded border px-3 py-2 text-left text-sm transition-colors ${
                      selectedRunId === r._id
                        ? "border-primary/60 bg-muted/60"
                        : "border-border hover:bg-muted/40"
                    }`}
                  >
                    <span className="font-medium">{r.period}</span>
                    <span className="tabular-nums ink-faded">
                      gross {formatINR(r.grossPaise / 100)} · net{" "}
                      {formatINR(r.netPaise / 100)}
                    </span>
                    <div className="flex items-center gap-2">
                      {r.paymentsMarkedAt && (
                        <Badge variant="outline">paid marked</Badge>
                      )}
                      {r.bankFileContent && (
                        <Badge variant="outline">bank file</Badge>
                      )}
                      {r.journalEntryId && (
                        <Badge variant="outline">posted</Badge>
                      )}
                      <Badge variant={STATUS_VARIANT[r.status] ?? "secondary"}>
                        {r.status}
                      </Badge>
                    </div>
                  </button>
                ))}
            </div>
          )}
        </CardContent>
      </Card>

      {run && (
        <Card className="rule-frame bg-card">
          <CardContent className="pt-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">
                Run {run.period} — {run.status}
              </p>
              <div className="flex flex-wrap gap-2">
                {run.status === "draft" && (
                  <Button
                    size="sm"
                    onClick={() =>
                      act(
                        () => submitForReview({ runId: run._id }),
                        "Submitted for review.",
                      )
                    }
                  >
                    Submit for review
                  </Button>
                )}
                {run.status === "in_review" && (
                  <Button
                    size="sm"
                    onClick={() =>
                      act(() => approveRun({ runId: run._id }), "Run approved.")
                    }
                  >
                    Approve
                  </Button>
                )}
                {run.status === "approved" && (
                  <Button
                    size="sm"
                    onClick={() =>
                      act(
                        () => finalizeRun({ runId: run._id }),
                        "Finalized — journal posted.",
                      )
                    }
                  >
                    Finalize &amp; post journal
                  </Button>
                )}
                {(run.status === "approved" || run.status === "finalized") &&
                  !run.bankFileContent && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        act(async () => {
                          const content = await generateBankFile({
                            runId: run._id,
                          });
                          downloadText(`payroll-${run.period}.txt`, content);
                        }, "Bank file generated.")
                      }
                    >
                      <FileDown className="mr-1 h-3.5 w-3.5" /> Bank file
                    </Button>
                  )}
                {run.status === "finalized" &&
                  run.bankFileContent &&
                  !run.paymentsMarkedAt && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        act(
                          () => markPaymentsMade({ runId: run._id }),
                          "Payments marked.",
                        )
                      }
                    >
                      Mark payments made
                    </Button>
                  )}
                {run.status === "finalized" && !reversing && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setReversing(true)}
                  >
                    Reverse
                  </Button>
                )}
                {run.bankFileContent && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      downloadText(
                        `payroll-${run.period}.txt`,
                        run.bankFileContent!,
                      )
                    }
                  >
                    <FileDown className="mr-1 h-3.5 w-3.5" /> Download file
                  </Button>
                )}
              </div>
            </div>

            {reversing && (
              <div className="mt-3 flex flex-wrap items-end gap-2 rounded border border-amber-500/40 bg-amber-500/10 p-3">
                <div className="flex-1 space-y-1.5">
                  <Label>Reversal reason (required)</Label>
                  <Input
                    value={reverseReason}
                    onChange={(e) => setReverseReason(e.target.value)}
                    placeholder="e.g. wrong LOP days included"
                  />
                </div>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() =>
                    act(async () => {
                      await reverseRun({
                        runId: run._id,
                        reason: reverseReason,
                      });
                      setReversing(false);
                      setReverseReason("");
                    }, "Run reversed — journal mirrored and marked reversed.")
                  }
                >
                  Confirm reversal
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setReversing(false)}
                >
                  Cancel
                </Button>
              </div>
            )}

            <div className="data-table mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="type-label border-b text-left ink-faded">
                    <th className="py-2">Line</th>
                    <th>Earnings</th>
                    <th>Deductions</th>
                    <th className="text-right">Gross</th>
                    <th className="text-right">Net</th>
                    <th className="text-right">LOP</th>
                  </tr>
                </thead>
                <tbody>
                  {payslips.map((s) => (
                    <tr key={s._id} className="border-b border-border/50">
                      <td className="py-2">
                        {s.salaryVisible
                          ? `${s.earningsPaise.length} earning(s) · ${s.deductionsPaise.length} deduction(s)`
                          : "restricted"}
                      </td>
                      <td className="type-label ink-faded">
                        {s.salaryVisible
                          ? s.earningsPaise
                              .map(
                                (e) =>
                                  `${e.component} ${formatINR(e.amountPaise / 100)}`,
                              )
                              .join(" · ") || "—"
                          : "—"}
                      </td>
                      <td className="type-label ink-faded">
                        {s.salaryVisible
                          ? s.deductionsPaise
                              .map(
                                (d) =>
                                  `${d.component} ${formatINR(d.amountPaise / 100)}`,
                              )
                              .join(" · ") || "—"
                          : "—"}
                      </td>
                      <td className="text-right tabular-nums">
                        {s.salaryVisible ? formatINR(s.grossPaise / 100) : "restricted"}
                      </td>
                      <td className="text-right tabular-nums">
                        {s.salaryVisible ? formatINR(s.netPaise / 100) : "restricted"}
                      </td>
                      <td className="text-right tabular-nums ink-faded">
                        {(s.lopDays ?? 0) + (s.unpaidLeaveDays ?? 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="type-label mt-3 ink-faded">
              Payslip amounts are hidden unless you hold hr.view_salary (or the
              row is your own). Finalized runs are immutable except for audited
              reversals.
            </p>
          </CardContent>
        </Card>
      )}

      <SaveStructureDialog
        open={structureOpen}
        onOpenChange={setStructureOpen}
        employees={employeesForPicker}
      />
      <StatutoryDialog open={statutoryOpen} onOpenChange={setStatutoryOpen} />
    </div>
  );
}
