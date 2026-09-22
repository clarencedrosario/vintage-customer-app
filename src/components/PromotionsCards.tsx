import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatDateIN } from "@/lib/format";
import { useMutation, useQuery } from "convex/react";
import { ShieldCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

// ===============================================================
// Paid placements & promotions (section 23).
//
// Owner card: compliance gate, packages, approvals desk, metrics,
// pop-up settings. Member card: purchase a sponsored placement for
// the public directory profile. Advertisements are rendered and
// stored separately from verification and organic results.
// ===============================================================

const PROMO_STATUS: Record<string, { label: string; tone: string }> = {
  pending: { label: "Awaiting approval", tone: "border-[#B68A45]/40 bg-[#B68A45]/10 text-[#8a6d3b]" },
  approved: { label: "Approved", tone: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  rejected: { label: "Rejected / withdrawn", tone: "border-red-200 bg-red-50 text-red-800" },
};
const PAY_STATUS: Record<string, { label: string; tone: string }> = {
  unpaid: { label: "Unpaid", tone: "border-[#E5E7EB] bg-white text-[#64748B]" },
  paid: { label: "Paid", tone: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  refunded: { label: "Refunded", tone: "border-[#E5E7EB] bg-white text-[#64748B]" },
};

export function PromotionsOwnerCard() {
  const caps = useQuery(api.workspace.myCapabilities);
  if (caps === undefined) return null;
  if (caps.orgRole !== "owner" && caps.orgRole !== "administrator") return null;
  return <PromotionsOwnerCardInner />;
}

function PromotionsOwnerCardInner() {
  const profile = useQuery(api.orgs.profile);
  const enabled = (profile?.promotionsEnabled ?? false) === true;
  const setEnabledMut = useMutation(api.promotions.setEnabled);
  const packages = useQuery(api.promotions.listPackages);
  const promos = useQuery(api.promotions.adminList);
  const decide = useMutation(api.promotions.decide);
  const cancelByOwner = useMutation(api.promotions.cancelByOwner);
  const [compliance, setCompliance] = useState("");
  const [jurisdiction, setJurisdiction] = useState("");
  const [editPkg, setEditPkg] = useState(false);
  const [editPopup, setEditPopup] = useState(false);
  const [busy, setBusy] = useState(false);

  const enable = async () => {
    setBusy(true);
    try {
      await setEnabledMut({
        enabled: true,
        complianceNote: `[${jurisdiction.trim() || "Jurisdiction not stated"}] ${compliance.trim()}`,
      });
      toast.success("Paid placements enabled.");
      setCompliance("");
      setJurisdiction("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-serif">Paid placements & promotions</CardTitle>
        <CardDescription>
          Sponsored listings, banners and the directory pop-up. Advertisements are
          separate from verification and from organic results, and every placement
          carries a clear sponsored label.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {profile === undefined ? null : !enabled ? (
          <div className="rounded-md border border-[#E5E7EB] bg-[#F7F5EF] px-4 py-3">
            <p className="text-sm font-medium">Paid placements are disabled</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Before activating paid legal-service advertisements, record a current
              review of the professional-advertising rules that apply in your
              operating jurisdiction (for advocates in India, the Bar Council of
              India rules on advertising are the principal constraint). Nothing can
              be sold or displayed until this review is recorded.
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Jurisdiction reviewed</Label>
                <Input
                  value={jurisdiction}
                  onChange={(e) => setJurisdiction(e.target.value)}
                  placeholder="e.g. India — BCI rules, reviewed Sep 2026"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Review note</Label>
                <Input
                  value={compliance}
                  onChange={(e) => setCompliance(e.target.value)}
                  placeholder="Rules considered, advice taken, date of review…"
                />
              </div>
            </div>
            <Button size="sm" className="mt-3" disabled={busy || compliance.trim().length < 20} onClick={enable}>
              Record review & enable
            </Button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="flex items-center gap-2 text-sm font-medium">
                  <ShieldCheck className="size-4 text-emerald-700" aria-hidden="true" />
                  Enabled — compliance review on record
                </p>
                <p className="mt-0.5 max-w-xl text-xs text-muted-foreground">
                  {profile?.promotionsComplianceNote}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => setEditPkg(true)}>
                  New package
                </Button>
                <Button size="sm" variant="outline" onClick={() => setEditPopup(true)}>
                  Pop-up settings
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    try {
                      await setEnabledMut({ enabled: false });
                      toast.success(
                        "Paid placements disabled — live placements stop rendering immediately.",
                      );
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Failed.");
                    }
                  }}
                >
                  Disable
                </Button>
              </div>
            </div>

            <div>
              <p className="type-label ink-faded">Packages (pricing · duration · placement)</p>
              {(packages ?? []).length === 0 ? (
                <p className="mt-1 text-xs text-muted-foreground">No packages defined yet.</p>
              ) : (
                <div className="mt-1 space-y-1">
                  {(packages ?? []).map((p) => (
                    <div
                      key={p._id}
                      className="flex items-center justify-between rounded border border-[#E5E7EB] px-3 py-1.5 text-xs"
                    >
                      <span>
                        {p.name} · ₹{(p.priceMinor / 100).toLocaleString("en-IN")} / {p.durationDays}d ·{" "}
                        {p.placement.replace("_", " ")} · {p.active ? "active" : "hidden"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <p className="type-label ink-faded">Submissions — approval, payment & metrics</p>
              {promos === undefined ? null : promos.length === 0 ? (
                <p className="mt-1 text-xs text-muted-foreground">No submissions yet.</p>
              ) : (
                <div className="mt-1 space-y-2">
                  {promos.map((p) => {
                    const ap =
                      PROMO_STATUS[p.approvalStatus] ?? { label: p.approvalStatus, tone: "" };
                    const pay = PAY_STATUS[p.paymentStatus] ?? { label: p.paymentStatus, tone: "" };
                    const nowTs = new Date().getTime();
                    const expired = p.endsAt !== null && p.endsAt <= nowTs;
                    return (
                      <div key={p._id} className="rounded-md border border-[#E5E7EB] px-3 py-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <p className="text-sm font-medium">{p.advocateName}</p>
                              <span className="type-label ink-faded">{p.packageName}</span>
                              <Badge variant="outline" className={`text-[11px] ${ap.tone}`}>
                                {ap.label}
                              </Badge>
                              <Badge variant="outline" className={`text-[11px] ${pay.tone}`}>
                                {pay.label}
                              </Badge>
                              {p.live && !expired && (
                                <Badge
                                  variant="outline"
                                  className="border-emerald-200 bg-emerald-50 text-[11px] text-emerald-800"
                                >
                                  Live · {p.impressions} impressions · {p.clicks} clicks
                                </Badge>
                              )}
                              {!p.live && expired && p.paymentStatus === "paid" && (
                                <Badge variant="outline" className="text-[11px]">Expired</Badge>
                              )}
                            </div>
                            {p.message && (
                              <p className="mt-0.5 text-xs text-muted-foreground">“{p.message}”</p>
                            )}
                            {p.startsAt && p.endsAt && (
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                {formatDateIN(p.startsAt)} – {formatDateIN(p.endsAt)}
                              </p>
                            )}
                            {p.rejectionReason && (
                              <p className="mt-0.5 text-xs text-red-700">{p.rejectionReason}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5">
                            {p.approvalStatus === "pending" && (
                              <>
                                <Button
                                  size="sm"
                                  className="h-7 text-xs"
                                  onClick={async () => {
                                    try {
                                      await decide({
                                        promotionId: p._id as never,
                                        decision: "approved",
                                      });
                                      toast.success("Approved.");
                                    } catch (e) {
                                      toast.error(e instanceof Error ? e.message : "Failed.");
                                    }
                                  }}
                                >
                                  Approve
                                </Button>
                                <RejectPromotionButton promotionId={p._id as never} />
                              </>
                            )}
                            {p.live && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-xs"
                                onClick={async () => {
                                  try {
                                    await cancelByOwner({ promotionId: p._id as never });
                                    toast.success("Withdrawn.");
                                  } catch (e) {
                                    toast.error(e instanceof Error ? e.message : "Failed.");
                                  }
                                }}
                              >
                                Withdraw
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>

      {editPkg && enabled && <PackageEditor onClose={() => setEditPkg(false)} />}
      {editPopup && enabled && <PopupEditor onClose={() => setEditPopup(false)} />}
    </Card>
  );
}

function RejectPromotionButton({ promotionId }: { promotionId: Id<"promotions"> }) {
  const decide = useMutation(api.promotions.decide);
  const [reason, setReason] = useState("");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setOpen(true)}>
        Reject
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif">Reject submission</DialogTitle>
            <DialogDescription>
              The member sees this reason. Paid amounts are refunded outside this
              dialog if payment already went through.
            </DialogDescription>
          </DialogHeader>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setOpen(false)}>
              Back
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={!reason.trim()}
              onClick={async () => {
                try {
                  await decide({ promotionId, decision: "rejected", reason });
                  toast.success("Rejected.");
                  setOpen(false);
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Failed.");
                }
              }}
            >
              Reject
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function PackageEditor({ onClose }: { onClose: () => void }) {
  const save = useMutation(api.promotions.savePackage);
  const [name, setName] = useState("");
  const [placement, setPlacement] = useState("sponsored_listing");
  const [price, setPrice] = useState("2000");
  const [days, setDays] = useState("30");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif">New promotion package</DialogTitle>
          <DialogDescription>
            Members see active packages on their “Promote my profile” card.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Sponsored listing — monthly"
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1.5">
              <Label>Placement</Label>
              <Select value={placement} onValueChange={setPlacement}>
                <SelectTrigger size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sponsored_listing">Sponsored listing</SelectItem>
                  <SelectItem value="banner">Banner</SelectItem>
                  <SelectItem value="popup">Pop-up</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Price (₹)</Label>
              <Input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="numeric" />
            </div>
            <div className="space-y-1.5">
              <Label>Days</Label>
              <Input value={days} onChange={(e) => setDays(e.target.value)} inputMode="numeric" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Description (optional)</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={busy || !name.trim()}
              onClick={async () => {
                const priceMinor = Math.round(Number(price) * 100);
                const durationDays = Math.round(Number(days));
                if (
                  !Number.isFinite(priceMinor) ||
                  priceMinor <= 0 ||
                  !Number.isFinite(durationDays) ||
                  durationDays < 1
                ) {
                  toast.error("Give a valid price and duration.");
                  return;
                }
                setBusy(true);
                try {
                  await save({
                    name,
                    placement: placement as "sponsored_listing" | "banner" | "popup",
                    priceMinor,
                    durationDays,
                    description: description || undefined,
                    active: true,
                  });
                  toast.success("Package created.");
                  onClose();
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Failed.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Create
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PopupEditor({ onClose }: { onClose: () => void }) {
  const profile = useQuery(api.orgs.profile);
  const setPopup = useMutation(api.promotions.setPopup);
  const [enabled, setEnabled] = useState((profile?.promoPopupEnabled ?? false) === true);
  const [headline, setHeadline] = useState(profile?.promoPopupHeadline ?? "");
  const [body, setBody] = useState(profile?.promoPopupBody ?? "");
  const [cta, setCta] = useState(profile?.promoPopupCta ?? "");
  const [busy, setBusy] = useState(false);

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif">Directory pop-up</DialogTitle>
          <DialogDescription>
            Shown to public visitors at most once per visitor per 24 hours,
            dismissible, only while paid placements are enabled.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Switch checked={enabled} onCheckedChange={setEnabled} />
            <span className="text-sm">Enabled</span>
          </div>
          <div className="space-y-1.5">
            <Label>Headline</Label>
            <Input value={headline} onChange={(e) => setHeadline(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Body</Label>
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} />
          </div>
          <div className="space-y-1.5">
            <Label>Button text</Label>
            <Input value={cta} onChange={(e) => setCta(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await setPopup({
                    enabled,
                    headline: headline || undefined,
                    body: body || undefined,
                    cta: cta || undefined,
                  });
                  toast.success("Pop-up saved.");
                  onClose();
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Failed.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function PromoteMyProfileCard() {
  const caps = useQuery(api.workspace.myCapabilities);
  if (caps === undefined) return null;
  if (caps.orgRole === "support_staff") return null;
  return <PromoteMyProfileCardInner />;
}

function PromoteMyProfileCardInner() {
  const packages = useQuery(api.promotions.availablePackages);
  const mine = useQuery(api.promotions.myPromotions);
  const submit = useMutation(api.promotions.submit);
  const [openPkg, setOpenPkg] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [targetUrl, setTargetUrl] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-serif">Promote my profile</CardTitle>
        <CardDescription>
          Purchase a sponsored placement for your public directory profile.
          Submissions require the chamber owner's approval before going live,
          always render with a sponsored label, and expire automatically.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {packages !== undefined && packages.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No promotion packages are offered right now.
          </p>
        )}
        {(packages ?? []).map((p) => (
          <div
            key={p._id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[#E5E7EB] px-3 py-2"
          >
            <div>
              <p className="text-sm font-medium">{p.name}</p>
              <p className="text-xs text-muted-foreground">
                {p.placement.replace("_", " ")} · {p.durationDays} days
                {p.description ? ` · ${p.description}` : ""}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">
                ₹{(p.priceMinor / 100).toLocaleString("en-IN")}
              </span>
              <Button size="sm" variant="outline" onClick={() => setOpenPkg(p._id)}>
                Purchase
              </Button>
            </div>
          </div>
        ))}

        {mine !== undefined && mine.length > 0 && (
          <div>
            <p className="type-label ink-faded">My submissions</p>
            <div className="mt-1 space-y-1">
              {mine.map((m) => {
                const nowTs = new Date().getTime();
                const live =
                  m.approvalStatus === "approved" &&
                  m.paymentStatus === "paid" &&
                  (m.startsAt ?? 0) <= nowTs &&
                  (m.endsAt ?? 0) > nowTs;
                return (
                  <div
                    key={m._id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded border border-[#E5E7EB] px-3 py-1.5 text-xs"
                  >
                    <span>
                      {live
                        ? "Live"
                        : m.approvalStatus === "pending"
                          ? "Awaiting approval"
                          : m.approvalStatus === "rejected"
                            ? "Not approved"
                            : m.paymentStatus === "paid"
                              ? "Approved — starting"
                              : "Awaiting payment"}
                      {m.startsAt && m.endsAt
                        ? ` · ${formatDateIN(m.startsAt)} – ${formatDateIN(m.endsAt)}`
                        : ""}
                    </span>
                    <span className="text-muted-foreground">
                      {m.impressions ?? 0} impressions · {m.clicks ?? 0} clicks
                      {m.paymentLinkUrl && m.paymentStatus === "unpaid" ? " · " : ""}
                      {m.paymentLinkUrl && m.paymentStatus === "unpaid" && (
                        <a
                          href={m.paymentLinkUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[#4f6b8f] underline"
                        >
                          complete payment
                        </a>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {openPkg && (
          <Dialog open onOpenChange={(v) => !v && setOpenPkg(null)}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle className="font-serif">Purchase promotion</DialogTitle>
                <DialogDescription>
                  Your submission goes to the chamber owner for approval. Payment is
                  collected via a secure link; the placement runs only after
                  approval, and only for the purchased duration.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Sponsored message (optional)</Label>
                  <Input
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="e.g. Corporate & tax disputes — 15 years"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Target link (optional)</Label>
                  <Input
                    value={targetUrl}
                    onChange={(e) => setTargetUrl(e.target.value)}
                    placeholder="https://…"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => setOpenPkg(null)}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        const res = await submit({
                          packageId: openPkg as never,
                          message: message || undefined,
                          targetUrl: targetUrl || undefined,
                        });
                        toast.success(
                          `Submitted — ₹${(res.priceMinor / 100).toLocaleString("en-IN")} payment link is being prepared; complete it from “My submissions”.`,
                        );
                        setOpenPkg(null);
                        setMessage("");
                        setTargetUrl("");
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : "Failed.");
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Submit & pay
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </CardContent>
    </Card>
  );
}
