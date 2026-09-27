import { ChamberShell } from "@/components/ChamberShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { CalendarDays, ScrollText, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { formatINR } from "@/lib/format";

const STATUTORY_LABELS: Record<string, string> = {
  pf: "Provident Fund",
  esi: "ESIC",
  pt: "Professional Tax",
  tds: "TDS",
  lwf: "Labour Welfare Fund",
  gratuity: "Gratuity",
};

function AddEmployeeDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const upsert = useMutation(api.hr.upsertEmployee);
  const [code, setCode] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [designation, setDesignation] = useState("");
  const [employmentType, setEmploymentType] = useState("permanent");
  const [status, setStatus] = useState("active");
  const [dateOfJoining, setDateOfJoining] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [monthlyGross, setMonthlyGross] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-serif">Add employee</DialogTitle>
          <DialogDescription>
            Salary amounts are whole rupees here (stored as paise) and are
            visible only to hr.view_salary holders — never by role alone.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>Employee code</Label>
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="ADV-014" />
          </div>
          <div className="space-y-1">
            <Label>Date of joining</Label>
            <Input type="date" value={dateOfJoining} onChange={(e) => setDateOfJoining(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>First name</Label>
            <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Last name</Label>
            <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Designation</Label>
            <Input value={designation} onChange={(e) => setDesignation(e.target.value)} placeholder="Junior Associate" />
          </div>
          <div className="space-y-1">
            <Label>Employment type</Label>
            <Select value={employmentType} onValueChange={setEmploymentType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["partner", "permanent", "contract", "intern", "consultant", "support"].map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["active", "probation", "notice_period"].map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Monthly gross (₹, optional)</Label>
            <Input
              type="number"
              min="0"
              value={monthlyGross}
              onChange={(e) => setMonthlyGross(e.target.value)}
              placeholder="e.g. 65000"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={busy || !code.trim() || !firstName.trim() || !designation.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                await upsert({
                  employeeCode: code,
                  firstName,
                  lastName,
                  designation,
                  employmentType: employmentType as "permanent",
                  status: status as "active",
                  dateOfJoining,
                  monthlyGrossPaise:
                    monthlyGross === "" ? undefined : Math.round(parseFloat(monthlyGross) * 100),
                });
                toast.success("Employee added.");
                onOpenChange(false);
                setCode("");
                setFirstName("");
                setLastName("");
                setDesignation("");
                setMonthlyGross("");
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Failed.");
              } finally {
                setBusy(false);
              }
            }}
          >
            Add employee
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ApplyLeaveDialog({
  open,
  onOpenChange,
  canFileForOthers,
  employees,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  canFileForOthers: boolean;
  employees: { _id: Id<"employees">; firstName: string; lastName: string; employeeCode: string }[];
}) {
  const apply = useMutation(api.hr.applyLeave);
  const [employeeId, setEmployeeId] = useState("");
  const [leaveType, setLeaveType] = useState("casual");
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(new Date().toISOString().slice(0, 10));
  const [days, setDays] = useState("1");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif">Apply for leave</DialogTitle>
          <DialogDescription>
            Balances never go negative — excess days are frozen as loss-of-pay
            on approval.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {canFileForOthers && (
            <div className="space-y-1">
              <Label>Employee</Label>
              <Select value={employeeId} onValueChange={setEmployeeId}>
                <SelectTrigger><SelectValue placeholder="Myself" /></SelectTrigger>
                <SelectContent>
                  {employees.map((e) => (
                    <SelectItem key={e._id} value={e._id}>
                      {e.employeeCode} — {e.firstName} {e.lastName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Leave type</Label>
              <Input value={leaveType} onChange={(e) => setLeaveType(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Days</Label>
              <Input type="number" step="0.5" min="0.5" value={days} onChange={(e) => setDays(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>From</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>To</Label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Reason (optional)</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await apply({
                  employeeId: employeeId ? (employeeId as Id<"employees">) : undefined,
                  leaveType,
                  startDate,
                  endDate,
                  days: parseFloat(days),
                  reason: reason || undefined,
                });
                toast.success("Leave application filed.");
                onOpenChange(false);
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Failed.");
              } finally {
                setBusy(false);
              }
            }}
          >
            File application
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function Hr() {
  const employees = useQuery(api.hr.listEmployees);
  const departments = useQuery(api.hr.listDepartments);
  const leave = useQuery(api.hr.listLeaveRequests, {});
  const prereqs = useQuery(api.hr.payrollPrerequisites);

  const decide = useMutation(api.hr.decideLeave);
  const markTaken = useMutation(api.hr.markLeaveTaken);

  const [addOpen, setAddOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);

  const pending = (leave ?? []).filter((r) => r.status === "pending");

  return (
    <ChamberShell subtitle="People, leave and statutory configuration" title="Human Resources">
      <div className="mb-4 flex flex-wrap gap-2">
        <Button onClick={() => setAddOpen(true)}>
          <Users className="mr-2 h-4 w-4" /> Add employee
        </Button>
        <Button variant="outline" onClick={() => setLeaveOpen(true)}>
          <CalendarDays className="mr-2 h-4 w-4" /> Apply for leave
        </Button>
      </div>

      {prereqs && (
        <Card className="rule-frame mb-6 bg-card">
          <CardContent className="py-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">Payroll prerequisites</p>
              <Badge variant={prereqs.missingKinds.length === 0 ? "default" : "secondary"}>
                {prereqs.missingKinds.length === 0
                  ? "Statutory configuration complete"
                  : `${prereqs.missingKinds.length} kind(s) not configured`}
              </Badge>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {prereqs.statutory.map((s) => (
                <Badge key={s.kind} variant={s.configured ? "default" : "outline"}>
                  {STATUTORY_LABELS[s.kind] ?? s.kind}
                  {s.configured && s.effectiveFrom ? ` · v${s.currentVersion} from ${s.effectiveFrom}` : " · not configured"}
                </Badge>
              ))}
            </div>
            <p className="type-label mt-3 ink-faded">
              {prereqs.employeeCount} employee record(s). No statutory rates
              ship with the product — each employer enters verified values, and
              payroll refuses to run while required kinds are missing.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="rule-frame bg-card">
          <CardContent className="pt-5">
            <p className="text-sm font-medium">Employees</p>
            {employees === undefined ? (
              <p className="mt-2 text-sm ink-faded">Loading…</p>
            ) : employees.length === 0 ? (
              <p className="mt-2 text-sm ink-faded">
                No employee records yet. Salary fields are stripped on read
                unless the viewer holds hr.view_salary (or it is their own
                record with hr.view_own).
              </p>
            ) : (
              <div className="data-table mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="type-label border-b text-left ink-faded">
                      <th className="py-2">Code</th>
                      <th>Name</th>
                      <th>Type</th>
                      <th>Status</th>
                      <th className="text-right">Monthly gross</th>
                    </tr>
                  </thead>
                  <tbody>
                    {employees.map((e) => (
                      <tr key={e._id} className="border-b border-border/50">
                        <td className="py-2">{e.employeeCode}</td>
                        <td>{e.firstName} {e.lastName}</td>
                        <td className="type-label ink-faded">{e.employmentType}</td>
                        <td className="type-label ink-faded">{e.status}</td>
                        <td className="text-right tabular-nums">
                          {e.salaryVisible && e.monthlyGrossPaise !== undefined
                            ? formatINR(e.monthlyGrossPaise / 100)
                            : e.salaryVisible
                              ? "—"
                              : "restricted"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {departments && departments.length > 0 && (
              <p className="type-label mt-3 ink-faded">
                Departments: {departments.map((d) => d.name).join(" · ")}
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="rule-frame bg-card">
          <CardContent className="pt-5">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Leave requests</p>
              {pending.length > 0 && (
                <Badge variant="secondary">{pending.length} pending</Badge>
              )}
            </div>
            {leave === undefined ? (
              <p className="mt-2 text-sm ink-faded">Loading…</p>
            ) : leave.length === 0 ? (
              <p className="mt-2 text-sm ink-faded">No leave applications yet.</p>
            ) : (
              <div className="mt-3 max-h-96 space-y-2 overflow-y-auto">
                {leave.slice(0, 30).map((r) => (
                  <div key={r._id} className="rounded border border-border bg-muted/30 p-2 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        {r.leaveType} · {r.startDate} → {r.endDate} · {r.days} day(s)
                        {(r.unpaidDays ?? 0) > 0 && (
                          <span className="ml-1 text-amber-700 dark:text-amber-400">
                            ({r.unpaidDays} LOP)
                          </span>
                        )}
                      </span>
                      <Badge
                        variant={
                          r.status === "taken" || r.status === "approved"
                            ? "default"
                            : r.status === "pending"
                              ? "secondary"
                              : "destructive"
                        }
                      >
                        {r.status}
                      </Badge>
                    </div>
                    {r.status === "pending" && (
                      <div className="mt-2 flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={async () => {
                            try {
                              const res = await decide({ leaveRequestId: r._id, approve: true });
                              toast.success(
                                `Approved — ${res.unpaidDays} day(s) marked as loss-of-pay.`,
                              );
                            } catch (err) {
                              toast.error(err instanceof Error ? err.message : "Failed.");
                            }
                          }}
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={async () => {
                            try {
                              await decide({ leaveRequestId: r._id, approve: false });
                              toast.success("Rejected.");
                            } catch (err) {
                              toast.error(err instanceof Error ? err.message : "Failed.");
                            }
                          }}
                        >
                          Reject
                        </Button>
                      </div>
                    )}
                    {r.status === "approved" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="mt-2"
                        onClick={async () => {
                          try {
                            const res = await markTaken({ leaveRequestId: r._id });
                            toast.success(
                              `Marked taken — ${res.paidDays} day(s) deducted from balance.`,
                            );
                          } catch (err) {
                            toast.error(err instanceof Error ? err.message : "Failed.");
                          }
                        }}
                      >
                        <ScrollText className="mr-1 h-3.5 w-3.5" /> Mark taken
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
            <p className="type-label mt-3 ink-faded">
              Approvals require hr.approve; balances decrement only when leave
              is marked taken.
            </p>
          </CardContent>
        </Card>
      </div>

      <AddEmployeeDialog open={addOpen} onOpenChange={setAddOpen} />
      <ApplyLeaveDialog
        open={leaveOpen}
        onOpenChange={setLeaveOpen}
        canFileForOthers={
          employees !== undefined &&
          employees.some((e) => e.salaryVisible) /* cheap hr.manage hint */
        }
        employees={(employees ?? []).map((e) => ({
          _id: e._id,
          firstName: e.firstName,
          lastName: e.lastName,
          employeeCode: e.employeeCode,
        }))}
      />
    </ChamberShell>
  );
}
