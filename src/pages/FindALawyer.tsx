import { Link } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/convex/_generated/api";
import { formatDateTimeIN, formatINR } from "@/lib/format";
import { useMutation, useQuery } from "convex/react";
import {
  ArrowLeft,
  BadgeCheck,
  CalendarClock,
  GraduationCap,
  Landmark,
  Languages as LanguagesIcon,
  MapPin,
  Scale,
  Search,
  ShieldCheck,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

/**
 * Public directory of published advocate profiles, for visitors who are
 * not members of any chamber. Booking a consultation never grants access
 * to matters or the client portal.
 */

type DirectoryEntry = {
  profileId: string;
  userId: string;
  name: string;
  orgName: string;
  headline: string;
  qualifications: string;
  enrollmentNumber: string;
  enrollmentState: string;
  experienceYears: number | null;
  practiceAreas: string[];
  courts: string[];
  languages: string[];
  city: string;
  publicEmail: string;
  publicPhone: string;
  feeMinor: number;
  slots: { label: string; startsAt: number }[];
  availabilityNote: string;
  about: string;
  verificationStatus: string;
};

const STATUS_LABEL: Record<string, string> = {
  requested: "Awaiting the advocate's response",
  accepted: "Accepted — fee payment pending",
  scheduled: "Scheduled",
  reschedule_proposed: "New time proposed — awaiting your confirmation",
  paid: "Payment received — awaiting scheduling",
  pending: "Payment link issued",
  completed: "Completed",
  declined: "Declined",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

export default function FindALawyer() {
  const [q, setQ] = useState("");
  const [city, setCity] = useState("all");
  const [area, setArea] = useState("all");
  const [court, setCourt] = useState("all");
  const [language, setLanguage] = useState("all");
  const [sort, setSort] = useState("name");
  const [selected, setSelected] = useState<DirectoryEntry | null>(null);
  const [lookupOpen, setLookupOpen] = useState(false);

  const profiles = useQuery(api.directory.publicList) as DirectoryEntry[] | undefined;

  const entries = profiles ?? [];
  const cities = useMemo(
    () => Array.from(new Set(entries.map((e) => e.city).filter(Boolean))).sort(),
    [entries],
  );
  const areas = useMemo(
    () =>
      Array.from(new Set(entries.flatMap((e) => e.practiceAreas))).sort((a, b) =>
        a.localeCompare(b),
      ),
    [entries],
  );
  const courts = useMemo(
    () => Array.from(new Set(entries.flatMap((e) => e.courts))).sort((a, b) => a.localeCompare(b)),
    [entries],
  );
  const langs = useMemo(
    () => Array.from(new Set(entries.flatMap((e) => e.languages))).sort((a, b) => a.localeCompare(b)),
    [entries],
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let rows = entries.filter((e) => {
      if (city !== "all" && e.city !== city) return false;
      if (area !== "all" && !e.practiceAreas.includes(area)) return false;
      if (court !== "all" && !e.courts.includes(court)) return false;
      if (language !== "all" && !e.languages.includes(language)) return false;
      if (!needle) return true;
      return (
        e.name.toLowerCase().includes(needle) ||
        e.orgName.toLowerCase().includes(needle) ||
        e.headline.toLowerCase().includes(needle) ||
        e.practiceAreas.some((p) => p.toLowerCase().includes(needle)) ||
        e.courts.some((c) => c.toLowerCase().includes(needle)) ||
        e.city.toLowerCase().includes(needle)
      );
    });
    rows = [...rows].sort((a, b) => {
      if (sort === "experience")
        return (b.experienceYears ?? 0) - (a.experienceYears ?? 0);
      if (sort === "fee_low") return a.feeMinor - b.feeMinor;
      return a.name.localeCompare(b.name);
    });
    return rows;
  }, [entries, q, city, area, court, language, sort]);

  const activeFilters =
    (city !== "all" ? 1 : 0) +
    (area !== "all" ? 1 : 0) +
    (court !== "all" ? 1 : 0) +
    (language !== "all" ? 1 : 0);

  return (
    <div className="min-h-screen bg-sidebar">
      <header className="border-b border-sidebar-border">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
          <Link to="/" className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-md border border-sidebar-primary/40 text-sidebar-primary">
              <Scale className="size-4.5" aria-hidden="true" />
            </span>
            <span className="flex flex-col leading-tight">
              <span className="font-serif text-lg font-semibold tracking-[0.06em] text-white">
                ADVOKATE.IN
              </span>
              <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-sidebar-primary">
                The Digital Chamber
              </span>
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              className="text-slate-300 hover:bg-sidebar-accent hover:text-white"
              onClick={() => setLookupOpen(true)}
            >
              Track a booking
            </Button>
            <Button
              asChild
              variant="ghost"
              className="text-slate-300 hover:bg-sidebar-accent hover:text-white"
            >
              <Link to="/">Back to portal selection</Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="paper-texture min-h-screen flex-1 px-6 py-14">
        <div className="mx-auto w-full max-w-6xl">
          <p className="type-label ink-faded">For public visitors</p>
          <h1 className="mt-3 font-serif text-4xl font-semibold tracking-tight">
            Find a Lawyer
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Browse advocates and chambers who publish their practice on Advokate.
            Request a consultation directly — booking an appointment does not by
            itself create a client relationship or grant access to any case files.
          </p>

          {/* Search & filters */}
          <div className="mt-8 space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-3 size-4 text-muted-foreground" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search by name, chamber, practice area, court or city…"
                aria-label="Search advocates"
                className="w-full rounded-md border border-input bg-card py-2.5 pl-9 pr-3 text-sm outline-none focus:border-ring"
              />
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              <Select value={city} onValueChange={setCity}>
                <SelectTrigger size="sm" aria-label="Filter by city">
                  <SelectValue placeholder="City" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All cities</SelectItem>
                  {cities.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={area} onValueChange={setArea}>
                <SelectTrigger size="sm" aria-label="Filter by practice area">
                  <SelectValue placeholder="Practice area" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All practice areas</SelectItem>
                  {areas.map((a) => (
                    <SelectItem key={a} value={a}>
                      {a}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={court} onValueChange={setCourt}>
                <SelectTrigger size="sm" aria-label="Filter by court">
                  <SelectValue placeholder="Court" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All courts</SelectItem>
                  {courts.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={language} onValueChange={setLanguage}>
                <SelectTrigger size="sm" aria-label="Filter by language">
                  <SelectValue placeholder="Language" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All languages</SelectItem>
                  {langs.map((l) => (
                    <SelectItem key={l} value={l}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={sort} onValueChange={setSort}>
                <SelectTrigger size="sm" aria-label="Sort">
                  <SelectValue placeholder="Sort" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="name">Sort: Name</SelectItem>
                  <SelectItem value="experience">Sort: Experience</SelectItem>
                  <SelectItem value="fee_low">Sort: Consultation fee</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {activeFilters > 0 && (
              <button
                type="button"
                className="text-xs font-medium text-[#B68A45] hover:underline"
                onClick={() => {
                  setCity("all");
                  setArea("all");
                  setCourt("all");
                  setLanguage("all");
                }}
              >
                Clear {activeFilters} filter{activeFilters === 1 ? "" : "s"}
              </button>
            )}
          </div>

          {/* Results */}
          <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {profiles === undefined
              ? [0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-44 rounded-xl" />)
              : filtered.map((e) => (
                  <Card
                    key={e.profileId}
                    className="rule-frame cursor-pointer transition-shadow hover:shadow-md"
                    onClick={() => setSelected(e)}
                  >
                    <CardContent className="space-y-2 py-4">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-serif text-lg font-semibold leading-snug">
                          {e.name}
                        </p>
                        {e.verificationStatus === "verified" && (
                          <span
                            title="Identity and enrollment verified by their chamber"
                            className="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800"
                          >
                            <BadgeCheck className="size-3.5" aria-hidden="true" />
                            Verified
                          </span>
                        )}
                      </div>
                      {e.headline && (
                        <p className="text-xs text-muted-foreground">{e.headline}</p>
                      )}
                      <div className="flex flex-wrap gap-1">
                        {e.practiceAreas.slice(0, 3).map((p) => (
                          <Badge key={p} variant="outline" className="text-[11px]">
                            {p}
                          </Badge>
                        ))}
                        {e.practiceAreas.length > 3 && (
                          <Badge variant="outline" className="text-[11px]">
                            +{e.practiceAreas.length - 3}
                          </Badge>
                        )}
                      </div>
                      <div className="space-y-1 pt-1 text-xs text-muted-foreground">
                        {e.experienceYears !== null && (
                          <p className="flex items-center gap-1.5">
                            <GraduationCap className="size-3.5 text-[#B68A45]" aria-hidden="true" />
                            {e.experienceYears} year{e.experienceYears === 1 ? "" : "s"} of practice
                          </p>
                        )}
                        {e.city && (
                          <p className="flex items-center gap-1.5">
                            <MapPin className="size-3.5 text-[#B68A45]" aria-hidden="true" />
                            {e.city}
                          </p>
                        )}
                        {e.languages.length > 0 && (
                          <p className="flex items-center gap-1.5">
                            <LanguagesIcon className="size-3.5 text-[#B68A45]" aria-hidden="true" />
                            {e.languages.join(", ")}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center justify-between border-t border-[#E5E7EB] pt-2">
                        <span className="text-xs text-muted-foreground">
                          Consultation:{" "}
                          {e.feeMinor > 0 ? formatINR(e.feeMinor / 100) : "Free / on request"}
                        </span>
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-[#B68A45]">
                          View & book
                          <CalendarClock className="size-3.5" aria-hidden="true" />
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
          </div>

          {profiles !== undefined && filtered.length === 0 && (
            <Card className="mt-6">
              <CardContent className="py-12 text-center">
                <Landmark className="mx-auto size-8 text-[#B68A45]" aria-hidden="true" />
                <p className="mt-2 font-serif text-lg font-semibold">
                  {entries.length === 0 ? "No advocates listed yet" : "No matches"}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {entries.length === 0
                    ? "Advocates appear here once they publish their profile."
                    : "Try broadening your search or clearing a filter."}
                </p>
              </CardContent>
            </Card>
          )}

          <div className="mt-12 flex flex-col items-center gap-2 text-center">
            <Link
              to="/login"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-4" />
              Member? Choose your portal
            </Link>
            <p className="text-xs text-muted-foreground/70">
              “Verified” appears only where the advocate's chamber has recorded an
              actual verification decision.
            </p>
          </div>
        </div>
      </main>

      {selected && (
        <ProfileDialog entry={selected} onClose={() => setSelected(null)} />
      )}
      <BookingLookupDialog open={lookupOpen} onClose={() => setLookupOpen(false)} />
    </div>
  );
}

// -----------------------------------------------------------------
// Profile detail + booking dialog
// -----------------------------------------------------------------

function ProfileDialog({
  entry,
  onClose,
}: {
  entry: DirectoryEntry;
  onClose: () => void;
}) {
  const fresh = useQuery(api.directory.publicProfile, {
    profileId: entry.profileId as never,
  }) as DirectoryEntry | null | undefined;
  const e = fresh ?? entry;
  const nowMs = useState(() => Date.now())[0];
  const upcoming = (e.slots ?? []).filter((s) => s.startsAt > nowMs).slice(0, 8);
  const [slotId, setSlotId] = useState<string>("none");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ reference: string } | null>(null);

  const request = useMutation(api.consultRequests.requestBooking);

  const submit = async () => {
    setBusy(true);
    try {
      const res = await request({
        profileId: e.profileId as never,
        slotId: slotId !== "none" ? Number(slotId) : undefined,
        name,
        email,
        phone: phone || undefined,
        summary: summary || undefined,
      });
      setDone({ reference: res.reference });
      toast.success("Request sent to " + res.advocateName + ".");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send the request.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        {done ? (
          <div className="py-6 text-center">
            <ShieldCheck className="mx-auto size-10 text-[#B68A45]" aria-hidden="true" />
            <DialogHeader className="items-center">
              <DialogTitle className="font-serif">Request sent</DialogTitle>
              <DialogDescription>
                {e.name} has received your consultation request.
              </DialogDescription>
            </DialogHeader>
            <div className="mx-auto mt-4 rounded-md border border-[#E5E7EB] bg-[#F7F5EF] px-4 py-3">
              <p className="type-label ink-faded">Your reference code</p>
              <p className="mt-1 font-mono text-xl font-semibold tracking-widest">
                {done.reference}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                Keep it with the email address you gave — together they let you
                track, confirm a new time, or cancel the booking without an account.
              </p>
            </div>
            <Button className="mt-5" onClick={onClose}>
              Done
            </Button>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 font-serif">
                {e.name}
                {e.verificationStatus === "verified" && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800">
                    <BadgeCheck className="size-3.5" aria-hidden="true" />
                    Verified
                  </span>
                )}
              </DialogTitle>
              <DialogDescription>
                {[e.headline, e.orgName !== e.name ? e.orgName : ""].filter(Boolean).join(" · ")}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="grid gap-3 text-sm sm:grid-cols-2">
                {e.qualifications && (
                  <div>
                    <p className="type-label ink-faded">Qualifications</p>
                    <p className="mt-0.5 whitespace-pre-line">{e.qualifications}</p>
                  </div>
                )}
                {(e.enrollmentNumber || e.enrollmentState) && (
                  <div>
                    <p className="type-label ink-faded">Enrollment</p>
                    <p className="mt-0.5">
                      {[e.enrollmentNumber, e.enrollmentState].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                )}
                {e.experienceYears !== null && (
                  <div>
                    <p className="type-label ink-faded">Experience</p>
                    <p className="mt-0.5">
                      {e.experienceYears} year{e.experienceYears === 1 ? "" : "s"} in practice
                    </p>
                  </div>
                )}
                {e.courts.length > 0 && (
                  <div>
                    <p className="type-label ink-faded">Courts</p>
                    <p className="mt-0.5">{e.courts.join(", ")}</p>
                  </div>
                )}
                {e.city && (
                  <div>
                    <p className="type-label ink-faded">City</p>
                    <p className="mt-0.5">{e.city}</p>
                  </div>
                )}
                {e.languages.length > 0 && (
                  <div>
                    <p className="type-label ink-faded">Languages</p>
                    <p className="mt-0.5">{e.languages.join(", ")}</p>
                  </div>
                )}
                {(e.publicPhone || e.publicEmail) && (
                  <div>
                    <p className="type-label ink-faded">Contact</p>
                    <p className="mt-0.5">{[e.publicPhone, e.publicEmail].filter(Boolean).join(" · ")}</p>
                  </div>
                )}
                <div>
                  <p className="type-label ink-faded">Consultation fee</p>
                  <p className="mt-0.5">
                    {e.feeMinor > 0 ? formatINR(e.feeMinor / 100) : "Free / decided case-by-case"}
                  </p>
                </div>
              </div>

              {e.about && (
                <div>
                  <p className="type-label ink-faded">About</p>
                  <p className="mt-0.5 whitespace-pre-line text-sm text-muted-foreground">
                    {e.about}
                  </p>
                </div>
              )}

              {e.availabilityNote && (
                <p className="rounded-md border border-[#E5E7EB] bg-[#F7F5EF] px-3 py-2 text-xs text-muted-foreground">
                  {e.availabilityNote}
                </p>
              )}

              <div className="space-y-3 border-t border-[#E5E7EB] pt-4">
                <p className="font-serif text-sm font-semibold">Request a consultation</p>
                {upcoming.length > 0 && (
                  <div className="space-y-1.5">
                    <Label htmlFor="slot">Pick an offered time (optional)</Label>
                    <Select value={slotId} onValueChange={setSlotId}>
                      <SelectTrigger id="slot" size="sm">
                        <SelectValue placeholder="No preference" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No preference — propose times</SelectItem>
                        {upcoming.map((s) => (
                          <SelectItem key={s.startsAt} value={String(s.startsAt)}>
                            {s.label} · {formatDateTimeIN(s.startsAt)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="bk-name">Your full name *</Label>
                    <Input
                      id="bk-name"
                      value={name}
                      onChange={(ev) => setName(ev.target.value)}
                      placeholder="e.g. Asha Verma"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="bk-email">Email *</Label>
                    <Input
                      id="bk-email"
                      type="email"
                      value={email}
                      onChange={(ev) => setEmail(ev.target.value)}
                      placeholder="you@example.com"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="bk-phone">Phone (optional)</Label>
                    <Input
                      id="bk-phone"
                      value={phone}
                      onChange={(ev) => setPhone(ev.target.value)}
                      placeholder="+91…"
                    />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="bk-summary">What is this about? (optional)</Label>
                    <Textarea
                      id="bk-summary"
                      value={summary}
                      onChange={(ev) => setSummary(ev.target.value)}
                      rows={3}
                      placeholder="A short description of your matter. Do not include confidential details yet."
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Sending a request does not create a client relationship or grant
                  access to case files. The advocate decides whether to accept, and
                  engagement happens after a consultation.
                </p>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={onClose}>
                    Cancel
                  </Button>
                  <Button disabled={busy || name.trim().length < 2 || !email.trim()} onClick={submit}>
                    {busy ? "Sending…" : e.feeMinor > 0 ? `Request (fee ${formatINR(e.feeMinor / 100)})` : "Send request"}
                  </Button>
                </div>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// -----------------------------------------------------------------
// Booking tracker (reference + email, no account needed)
// -----------------------------------------------------------------

type BookingInfo = {
  reference: string;
  status: string;
  clientName: string;
  advocateName: string;
  chamberName: string;
  slotAt: number | null;
  proposedSlotAt: number | null;
  amountMinor: number;
  paymentLinkUrl: string | null;
  paymentStatus: string;
  history: { at: number; text: string }[];
  matterSummary: string;
};

function BookingLookupDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [reference, setReference] = useState("");
  const [email, setEmail] = useState("");
  const [queried, setQueried] = useState<{ reference: string; email: string } | null>(null);

  const booking = useQuery(
    api.directory.bookingByReference,
    queried ? { reference: queried.reference, email: queried.email } : "skip",
  ) as BookingInfo | null | undefined;

  const confirmReschedule = useMutation(api.consultRequests.requesterConfirmReschedule);
  const cancelBooking = useMutation(api.consultRequests.requesterCancel);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-serif">Track a booking</DialogTitle>
          <DialogDescription>
            Enter the reference code and the email you used when booking.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="lk-ref">Reference code</Label>
            <Input
              id="lk-ref"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="AX-XXXXXX"
              className="font-mono uppercase"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lk-email">Email</Label>
            <Input
              id="lk-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>
          <div className="sm:col-span-2">
            <Button
              size="sm"
              disabled={!reference.trim() || !email.trim()}
              onClick={() =>
                setQueried({ reference: reference.trim().toUpperCase(), email: email.trim() })
              }
            >
              Find booking
            </Button>
          </div>
        </div>

        {queried && booking === undefined && (
          <p className="text-sm text-muted-foreground">Searching…</p>
        )}
        {queried && booking === null && (
          <p className="rounded-md border border-[#E5E7EB] bg-[#F7F5EF] px-3 py-2 text-sm text-muted-foreground">
            No booking found for that reference and email combination.
          </p>
        )}
        {booking && (
          <div className="space-y-3">
            <div className="rounded-md border border-[#E5E7EB] px-3 py-2.5">
              <div className="flex items-center justify-between">
                <p className="font-serif font-semibold">{booking.advocateName}</p>
                <span className="font-mono text-sm">{booking.reference}</span>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {booking.chamberName} · {STATUS_LABEL[booking.status] ?? booking.status}
              </p>
              {booking.slotAt && (
                <p className="mt-1 flex items-center gap-1.5 text-sm">
                  <CalendarClock className="size-3.5 text-[#B68A45]" aria-hidden="true" />
                  {formatDateTimeIN(booking.slotAt)}
                </p>
              )}
              {booking.proposedSlotAt && (
                <p className="mt-1 text-sm">
                  Proposed new time: {formatDateTimeIN(booking.proposedSlotAt)}
                </p>
              )}
              {booking.amountMinor > 0 && booking.paymentStatus !== "paid" && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Fee {formatINR(booking.amountMinor / 100)} — payable when the
                  advocate confirms your booking.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <p className="type-label ink-faded">Status history</p>
              {booking.history.length === 0 ? (
                <p className="text-sm text-muted-foreground">No updates yet.</p>
              ) : (
                [...booking.history].reverse().map((h, i) => (
                  <p key={i} className="text-xs text-muted-foreground">
                    <span className="text-foreground">{formatDateTimeIN(h.at)}</span> — {h.text}
                  </p>
                ))
              )}
            </div>

            <div className="flex flex-wrap justify-end gap-2 border-t border-[#E5E7EB] pt-3">
              {booking.status === "reschedule_proposed" && booking.proposedSlotAt && (
                <Button
                  size="sm"
                  onClick={async () => {
                    try {
                      await confirmReschedule({
                        reference: booking.reference,
                        email: queried!.email,
                      });
                      toast.success("New time confirmed.");
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : "Could not confirm.");
                    }
                  }}
                >
                  Confirm new time
                </Button>
              )}
              {!["cancelled", "declined", "completed", "refunded"].includes(booking.status) && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    try {
                      await cancelBooking({ reference: booking.reference, email: queried!.email });
                      toast.success("Booking cancelled.");
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : "Could not cancel.");
                    }
                  }}
                >
                  Cancel booking
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
