// Shared schema constants extracted so schema.ts can stay lean. This
// module must remain importable by schema.ts (pure values only).
export const DEADLINE_CATEGORIES_CONST = [
  "limitation",
  "filing",
  "compliance",
  "court_order",
  "custom",
] as const;

/** Limitation and compliance deadline categories (legally significant). */
export const DEADLINE_CATEGORIES = DEADLINE_CATEGORIES_CONST;
