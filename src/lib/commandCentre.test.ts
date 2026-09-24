import { describe, expect, it } from "vitest";
import {
  classifyUrgency,
  urgencyClass,
  urgencyStamp,
  isTaskOpen,
  isTaskBlocked,
  isUpdateDue,
  isInvoiceOutstanding,
  invoiceOutstandingMinor,
  isInvoiceOverdue,
  invoiceUrgency,
  canSeeSection,
  COMMAND_CENTRE_SECTIONS,
  emptyStateFor,
  URGENT_WINDOW_MS,
} from "./commandCentre";

const NOW = new Date("2026-09-24T10:00:00+05:30").getTime();

describe("classifyUrgency", () => {
  it("marks past dates as overdue", () => {
    expect(classifyUrgency(NOW - 1000, NOW)).toBe("overdue");
    expect(classifyUrgency(NOW - 40 * 24 * 60 * 60 * 1000, NOW)).toBe("overdue");
  });

  it("marks anything due within 48h as urgent but not overdue", () => {
    expect(classifyUrgency(NOW + URGENT_WINDOW_MS, NOW)).toBe("urgent");
    expect(classifyUrgency(NOW + 60 * 60 * 1000, NOW)).toBe("urgent");
    expect(classifyUrgency(NOW + 47.9 * 60 * 60 * 1000, NOW)).toBe("urgent");
  });

  it("marks dates beyond 48h as ordinary", () => {
    expect(classifyUrgency(NOW + 49 * 60 * 60 * 1000, NOW)).toBe("ordinary");
    expect(classifyUrgency(NOW + 30 * 24 * 60 * 60 * 1000, NOW)).toBe("ordinary");
  });

  it("treats undated rows as ordinary and honours the overdue-like flag", () => {
    expect(classifyUrgency(undefined, NOW)).toBe("ordinary");
    // A future scheduled hearing is never "overdue" even though it is dated.
    expect(classifyUrgency(NOW - 1000, NOW, false)).not.toBe("overdue");
  });

  it("classifies a future hearing as urgent only when it is within 48h", () => {
    expect(classifyUrgency(NOW + 2 * 60 * 60 * 1000, NOW, false)).toBe("urgent");
    expect(classifyUrgency(NOW + 3 * 24 * 60 * 60 * 1000, NOW, false)).toBe("ordinary");
  });
});

describe("urgencyClass and urgencyStamp", () => {
  it("maps urgency to the vintage palette (red overdue, sepia urgent)", () => {
    expect(urgencyClass("overdue")).toBe("text-red-700 font-medium");
    expect(urgencyClass("urgent")).toBe("text-[#8a6a33] font-medium");
    expect(urgencyClass("ordinary")).toBe("");
  });

  it("renders readable overdue stamps", () => {
    expect(urgencyStamp("overdue", NOW - 3 * 24 * 60 * 60 * 1000, NOW)).toBe("3d overdue");
    expect(urgencyStamp("overdue", NOW - 5 * 60 * 60 * 1000, NOW)).toBe("5h overdue");
  });

  it("renders readable due-in stamps", () => {
    expect(urgencyStamp("urgent", NOW + 2 * 60 * 60 * 1000, NOW)).toBe("due in 2h");
    expect(urgencyStamp("urgent", NOW + 36 * 60 * 60 * 1000, NOW)).toBe("due in 2d");
  });

  it("never stamps ordinary rows", () => {
    expect(urgencyStamp("ordinary", NOW + 1000, NOW)).toBe("");
    expect(urgencyStamp("urgent", undefined, NOW)).toBe("");
  });
});

describe("task buckets", () => {
  it("counts pending and in_progress as open", () => {
    expect(isTaskOpen("pending")).toBe(true);
    expect(isTaskOpen("in_progress")).toBe(true);
    expect(isTaskOpen("done")).toBe(false);
  });

  it("treats an open task past its due date as blocked", () => {
    expect(isTaskBlocked("pending", NOW - 1, NOW)).toBe(true);
    expect(isTaskBlocked("in_progress", NOW - 1, NOW)).toBe(true);
  });

  it("never blocks done tasks or tasks without a due date", () => {
    expect(isTaskBlocked("done", NOW - 1, NOW)).toBe(false);
    expect(isTaskBlocked("pending", undefined, NOW)).toBe(false);
    expect(isTaskBlocked("pending", NOW + 1, NOW)).toBe(false);
  });
});

describe("update-due flag", () => {
  it("is due when there is activity but the client has never been contacted", () => {
    expect(isUpdateDue(NOW, null, NOW)).toBe(true);
  });

  it("is not due when the client was contacted after the latest activity", () => {
    expect(isUpdateDue(NOW - 1000, NOW - 500, NOW)).toBe(false);
  });

  it("is due when activity happened after the last contact (beyond grace)", () => {
    const activity = NOW;
    const contact = NOW - 3 * 60 * 60 * 1000;
    expect(isUpdateDue(activity, contact, NOW)).toBe(true);
  });

  it("allows the 30-minute post-hearing proposal grace", () => {
    const activity = NOW;
    const contact = NOW - 10 * 60 * 1000;
    expect(isUpdateDue(activity, contact, NOW)).toBe(false);
  });

  it("is never due with no activity", () => {
    expect(isUpdateDue(undefined, null, NOW)).toBe(false);
  });
});

describe("invoice money math (minor units)", () => {
  const paid: Parameters<typeof isInvoiceOutstanding>[0] = {
    status: "paid",
    totalMinor: 100_000,
    amountPaidMinor: 100_000,
  };

  it("excludes paid / cancelled / credited invoices", () => {
    expect(isInvoiceOutstanding(paid)).toBe(false);
    expect(isInvoiceOutstanding({ status: "cancelled", totalMinor: 5, amountPaidMinor: 0 })).toBe(false);
    expect(
      isInvoiceOutstanding({ status: "sent", totalMinor: 100, amountPaidMinor: 100, amountCreditedMinor: 0 }),
    ).toBe(false);
  });

  it("counts fully credited sent invoices as settled", () => {
    expect(
      isInvoiceOutstanding({ status: "sent", totalMinor: 100, amountPaidMinor: 0, amountCreditedMinor: 100 }),
    ).toBe(false);
  });

  it("counts partially paid and unpaid sent invoices as outstanding", () => {
    expect(
      isInvoiceOutstanding({ status: "partially_paid", totalMinor: 100, amountPaidMinor: 40 }),
    ).toBe(true);
    expect(isInvoiceOutstanding({ status: "sent", totalMinor: 100, amountPaidMinor: 0 })).toBe(true);
  });

  it("computes outstanding paise, never negative", () => {
    expect(invoiceOutstandingMinor({ status: "sent", totalMinor: 100, amountPaidMinor: 40 })).toBe(60);
    expect(invoiceOutstandingMinor({ status: "paid", totalMinor: 100, amountPaidMinor: 150 })).toBe(0);
    expect(invoiceOutstandingMinor({ status: "draft", totalMinor: 100, amountPaidMinor: 0 })).toBe(100);
  });

  it("marks outstanding invoices overdue only after the IST end of the due date", () => {
    const inv = { status: "sent" as const, totalMinor: 100, amountPaidMinor: 0, dueOn: "2026-09-24" };
    // 23:59 IST on the due date: not yet overdue.
    expect(isInvoiceOverdue(inv, new Date("2026-09-24T23:00:00+05:30").getTime())).toBe(false);
    // Next morning IST: overdue.
    expect(isInvoiceOverdue(inv, new Date("2026-09-25T09:00:00+05:30").getTime())).toBe(true);
  });

  it("never marks paid invoices overdue regardless of dates", () => {
    const inv = { status: "paid" as const, totalMinor: 100, amountPaidMinor: 100, dueOn: "2026-09-01" };
    expect(isInvoiceOverdue(inv, new Date("2026-09-30T09:00:00+05:30").getTime())).toBe(false);
  });

  it("tiers invoice urgency: overdue, urgent within 7 days, otherwise ordinary", () => {
    const overdue = { status: "sent" as const, totalMinor: 100, amountPaidMinor: 0, dueOn: "2026-09-20" };
    const soon = { status: "sent" as const, totalMinor: 100, amountPaidMinor: 0, dueOn: "2026-09-28" };
    const later = { status: "sent" as const, totalMinor: 100, amountPaidMinor: 0, dueOn: "2026-10-20" };
    expect(invoiceUrgency(overdue, NOW)).toBe("overdue");
    expect(invoiceUrgency(soon, NOW)).toBe("urgent");
    expect(invoiceUrgency(later, NOW)).toBe("ordinary");
    expect(invoiceUrgency({ status: "draft", totalMinor: 100, amountPaidMinor: 0 }, NOW)).toBe("ordinary");
  });
});

describe("permission-gated sections", () => {
  it("hides financial sections from roles without billing capabilities", () => {
    const paralegal = new Set(["task.manage", "note.write", "document.view_internal"]);
    expect(canSeeSection(COMMAND_CENTRE_SECTIONS.invoices, paralegal)).toBe(false);
    expect(canSeeSection(COMMAND_CENTRE_SECTIONS.payments, paralegal)).toBe(false);
  });

  it("shows invoices to billing holders and payments only to payment holders", () => {
    const accountant = new Set(["billing.invoice", "billing.payment", "matter.view_all"]);
    expect(canSeeSection(COMMAND_CENTRE_SECTIONS.invoices, accountant)).toBe(true);
    expect(canSeeSection(COMMAND_CENTRE_SECTIONS.payments, accountant)).toBe(true);
    const invoiceOnly = new Set(["billing.invoice"]);
    expect(canSeeSection(COMMAND_CENTRE_SECTIONS.invoices, invoiceOnly)).toBe(true);
    expect(canSeeSection(COMMAND_CENTRE_SECTIONS.payments, invoiceOnly)).toBe(false);
  });

  it("accepts the capability arrays the workspace query returns", () => {
    expect(canSeeSection(COMMAND_CENTRE_SECTIONS.internalDocuments, ["document.view_internal"])).toBe(true);
    expect(canSeeSection(COMMAND_CENTRE_SECTIONS.internalDocuments, [])).toBe(false);
    expect(canSeeSection(COMMAND_CENTRE_SECTIONS.audit, ["matter.edit"])).toBe(true);
    expect(canSeeSection(COMMAND_CENTRE_SECTIONS.audit, ["note.write"])).toBe(false);
  });

  it("gates everything off while capabilities are still loading", () => {
    expect(canSeeSection(COMMAND_CENTRE_SECTIONS.invoices, undefined)).toBe(false);
    expect(canSeeSection(COMMAND_CENTRE_SECTIONS.invoices, [])).toBe(false);
  });
});

describe("empty states", () => {
  it("has copy for every rendered section", () => {
    for (const id of [
      "deadlines", "tasks", "chronology", "documents", "requests",
      "communication", "invoices", "payments", "undertakings", "pack", "risks", "audit",
    ]) {
      const state = emptyStateFor(id);
      expect(state.message.length).toBeGreaterThan(5);
    }
  });

  it("falls back to a generic message for unknown sections", () => {
    expect(emptyStateFor("nonsense").message).toBeTruthy();
  });
});
