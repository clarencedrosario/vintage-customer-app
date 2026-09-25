/**
 * Indian formatting helpers — currency, dates in Asia/Kolkata, financial-year
 * labels. All chamber UI renders through these so INR and IST are consistent.
 */

const inrFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

export function formatINR(amount: number): string {
  return inrFormatter.format(amount);
}

/** Compact rupees for dense stats, e.g. ₹1.2L / ₹3.4Cr. */
export function formatINRCompact(amount: number): string {
  const abs = Math.abs(amount);
  if (abs >= 1_00_00_000)
    return `₹${(amount / 1_00_00_000).toFixed(2).replace(/\.00$/, "")} Cr`;
  if (abs >= 1_00_000)
    return `₹${(amount / 1_00_000).toFixed(2).replace(/\.00$/, "")} L`;
  if (abs >= 1_000) return `₹${(amount / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return `₹${amount}`;
}

const tz = "Asia/Kolkata";

export function formatDateIN(value: number | string): string {
  const d =
    typeof value === "number" ? new Date(value) : new Date(`${value}T00:00:00`);
  return d.toLocaleDateString("en-IN", {
    timeZone: tz,
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatDateTimeIN(value: number | string): string {
  const d =
    typeof value === "number" ? new Date(value) : new Date(`${value}T00:00:00`);
  return d.toLocaleString("en-IN", {
    timeZone: tz,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/** Today in IST as YYYY-MM-DD (for date inputs and record-keeping). */
export function todayIN(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Current Indian financial-year label like "2026-27". */
export function financialYearLabel(fyStart = "04-01"): string {
  const [sm, sd] = fyStart.split("-").map(Number);
  const [y, m, d] = todayIN().split("-").map(Number);
  const startYear = m > sm || (m === sm && d >= sd) ? y : y - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

export const CLIENT_KINDS = [
  { value: "individual", label: "Individual" },
  { value: "company", label: "Company" },
  { value: "partnership", label: "Partnership" },
  { value: "llp", label: "LLP" },
  { value: "trust", label: "Trust" },
  { value: "society", label: "Society" },
  { value: "government", label: "Government Body" },
  { value: "other", label: "Other" },
] as const;

export const INDIAN_STATES = [
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chhattisgarh",
  "Delhi",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
  "Jammu & Kashmir",
  "Ladakh",
  "Puducherry",
  "Chandigarh",
  "Andaman & Nicobar Islands",
  "Dadra & Nagar Haveli and Daman & Diu",
];

export const PRACTICE_AREAS = [
  "Civil Litigation",
  "Criminal Defence",
  "Constitutional & Writs",
  "Corporate & Commercial",
  "Property & Real Estate",
  "Family Law",
  "Labour & Service",
  "Taxation",
  "Arbitration & ADR",
  "Intellectual Property",
  "Consumer Matters",
  "Other",
];
