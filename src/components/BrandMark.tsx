import { Link } from "react-router";
import { ScrollText } from "lucide-react";

/**
 * Advokate.in wordmark + seal, used in headers across the app.
 */
export function BrandMark({ subtitle }: { subtitle: string }) {
  return (
    <Link to="/" className="flex items-center gap-3">
      <span className="flex size-10 items-center justify-center rounded-full border border-foreground/25 text-primary">
        <ScrollText className="size-5" />
      </span>
      <span className="flex flex-col leading-tight">
        <span className="font-serif text-lg font-semibold tracking-[0.08em] text-foreground">
          ADVOKATE.IN
        </span>
        <span className="type-label ink-faded">{subtitle}</span>
      </span>
    </Link>
  );
}
