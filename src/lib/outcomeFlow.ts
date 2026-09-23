// ===============================================================
// Hearing outcome → next steps (section 31: the connected chamber).
// A recorded outcome suggests follow-up tasks and a client update
// draft, but NOTHING is created automatically — every task is an
// explicit checkbox the lawyer confirms, and the client update is
// created as a draft that must clear the review/approval desk.
// ===============================================================

export type OutcomeStatus = "held" | "adjourned";

export type SuggestedTask = {
  title: string;
  /** Days from today; undefined = no due date suggested. */
  dueInDays?: number;
  /** Matches the schema's TASK_KINDS. */
  kind: "general" | "filing" | "service" | "delivery" | "collection";
  priority: "normal" | "high" | "urgent";
};

function kindFor(title: string): SuggestedTask["kind"] {
  return /file|submit|affidavit|written submission/i.test(title)
    ? "filing"
    : "general";
}

export type OutcomeSuggestions = {
  tasks: SuggestedTask[];
  clientUpdate: string;
};

/**
 * Pure suggestion logic — given what happened at the hearing, propose
 * the follow-up work and a plain-language client update. All outputs
 * are suggestions only; the lawyer reviews and confirms each one.
 */
export function suggestFromOutcome(
  status: OutcomeStatus,
  outcomeText: string,
  nextAction: string | undefined,
  nextHearingTitle: string | undefined,
): OutcomeSuggestions {
  const tasks: SuggestedTask[] = [];

  if (status === "adjourned") {
    tasks.push({
      title: "Note adjournment grounds and next steps on the file",
      dueInDays: 1,
      kind: "general",
      priority: "high",
    });
    if (nextHearingTitle) {
      tasks.push({
        title: `Prepare for ${nextHearingTitle}`,
        dueInDays: 7,
        kind: "general",
        priority: "normal",
      });
    }
  } else {
    tasks.push({
      title: "Record detailed order/decision reference in the chronology",
      dueInDays: 1,
      kind: "general",
      priority: "high",
    });
  }

  if (nextAction?.trim()) {
    const title = nextAction.trim().slice(0, 200);
    tasks.unshift({
      title,
      dueInDays: 3,
      kind: kindFor(title),
      priority: "high",
    });
  }

  // A client-facing draft in plain language — no internal strategy,
  // no outcome promises. "Draft — professional review required."
  const when = new Date().toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const hearingWord = status === "adjourned" ? "adjourned" : "held";
  const clientUpdate = [
    `Update on your matter — ${when}.`,
    "",
    `The hearing was ${hearingWord}.`,
    outcomeText.trim(),
    nextHearingTitle
      ? `The next hearing (${nextHearingTitle.trim()}) will be scheduled and you will be informed of the date.`
      : "",
    "",
    "If you have any questions, please reach out to our office.",
  ]
    .filter((line) => line !== "")
    .join("\n")
    .slice(0, 4000);

  return { tasks, clientUpdate };
}
