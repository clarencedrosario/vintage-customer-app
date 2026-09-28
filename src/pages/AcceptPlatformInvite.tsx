import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Headset, ShieldCheck } from "lucide-react";

// =====================================================================
// CJ GLOBAL — platform invitation acceptance.
//
// The invite link carries a one-time token (?token=…). Acceptance is
// bound to the SIGNED-IN account: the account's verified email must
// match the invitation — the server enforces all of it (workforce.ts).
// No password is set here; identity is the authenticated OTP account.
// =====================================================================

const ROLE_LABELS: Record<string, string> = {
  support_agent: "Support Agent",
  support_supervisor: "Support Supervisor",
  developer: "Developer",
};

export default function AcceptPlatformInvite() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const navigate = useNavigate();

  const identity = useQuery(api.workforce.myPlatformIdentity);
  const accept = useMutation(api.workforce.acceptEmployeeInvite);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const acceptIt = async () => {
    setBusy(true);
    try {
      await accept({ token });
      toast.success("Welcome to the CJ GLOBAL platform team.");
      setDone(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not accept the invitation.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-lg">
        <CardContent className="space-y-4 pt-6">
          <div className="flex items-center gap-2">
            <span className="flex size-9 items-center justify-center rounded-md border border-border">
              <Headset className="size-4" aria-hidden="true" />
            </span>
            <div>
              <h1 className="font-serif text-lg font-semibold">CJ GLOBAL invitation</h1>
              <p className="type-label ink-faded">Platform operations team</p>
            </div>
          </div>

          {!token && (
            <p className="text-sm text-muted-foreground">
              This page needs an invitation link with a token. Ask the platform
              owner to send you the full link.
            </p>
          )}

          {token && identity === undefined && (
            <p className="text-sm text-muted-foreground">Checking your session…</p>
          )}

          {token && identity === null && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Sign in with the account that owns the invited email address —
                you'll be emailed a 6-digit code. Acceptance is bound to that
                verified account.
              </p>
              <Button asChild size="sm">
                <Link
                  to={`/login?returnTo=${encodeURIComponent(
                    `/accept-platform-invite?token=${token}`,
                  )}`}
                >
                  Sign in to accept
                </Link>
              </Button>
            </div>
          )}

          {token && identity && !identity.isPlatformAdmin && identity.platformRole === null && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                You're signed in as{" "}
                <span className="font-medium text-foreground">an authenticated account</span>.
                Accepting binds this account to the platform team with the role
                encoded in your invitation link.
              </p>
              <Button size="sm" disabled={busy || done} onClick={acceptIt}>
                {done ? "Accepted" : busy ? "Accepting…" : "Accept invitation"}
              </Button>
            </div>
          )}

          {(done || (identity?.platformRole ?? null) !== null) && (
            <div className="space-y-3 rounded-md border border-[#B68A45]/40 bg-[#B68A45]/[0.06] p-4">
              <p className="flex items-center gap-2 text-sm font-medium">
                <ShieldCheck className="size-4 text-[#8a6a33]" aria-hidden="true" />
                You're on the platform team
                {identity?.platformRole && (
                  <Badge variant="outline">{ROLE_LABELS[identity.platformRole]}</Badge>
                )}
              </p>
              <Button size="sm" variant="outline" onClick={() => navigate("/owner")}>
                Open the support console
              </Button>
            </div>
          )}

          {identity?.platformRole === null && !done && (
            <p className="text-xs text-muted-foreground">
              Not the right account? Sign out and sign in with the invited
              email before accepting.
            </p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
