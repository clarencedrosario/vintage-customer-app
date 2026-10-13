import { BrandMark } from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import {
  ArrowLeft,
  ArrowRight,
  Loader2,
  Mail,
  ScrollText,
  ShieldCheck,
} from "lucide-react";
import { postAuthDestination, portalHome } from "@/lib/postAuthDestination";
import { Suspense, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import { useMutation, useQuery } from "convex/react";
import { safeInternalPath as resolveRedirectAfterAuth } from "@/lib/appLinks";

/** OTP codes can also be 6-hex recovery codes typed into the same box. */
function Login() {
  const [searchParams] = useSearchParams();
  const { isLoading, isAuthenticated, user } = useAuth();
  const twoFactor = useQuery(api.twofactor.sessionSatisfied);

  const inviteToken = searchParams.get("invite");

  // Successful logout lands here with a confirmation toast.
  useEffect(() => {
    if (searchParams.get("reason") === "signedout") {
      toast.info("You have been signed out.");
    }
  }, [searchParams]);

  // Invitation links take priority: /login?invite=…
  if (inviteToken) {
    return <InviteFlow token={inviteToken} />;
  }

  // A session exists: offer continuation to the account's own workspace.
  if (!isLoading && isAuthenticated && user) {
    if (twoFactor === undefined) {
      return <LoadingScreen />;
    }
    return (
      <SessionGate
        twoFactorNeeded={twoFactor.needed && !twoFactor.satisfied}
      />
    );
  }

  return (
    <AuthLayout>
      <SignInCard inviteToken={inviteToken} />
    </AuthLayout>
  );
}

function LoadingScreen() {
  return (
    <AuthLayout>
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Checking your session…
      </div>
    </AuthLayout>
  );
}

// ---------------------------------------------------------------
// Invitation claim: signed-in users accept directly; others sign in
// with the invited email first. Identity + token must both match.
// ---------------------------------------------------------------

function InviteFlow({ token }: { token: string }) {
  const { isLoading, isAuthenticated } = useAuth();
  const info = useQuery(api.invitations.inspect, { token });
  const accept = useMutation(api.invitations.accept);
  const navigate = useNavigate();

  if (isLoading || info === undefined) {
    return (
      <AuthLayout subtitle="Invitation">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Checking your invitation…
        </div>
      </AuthLayout>
    );
  }

  if (!info) {
    return (
      <AuthLayout subtitle="Invitation">
        <Card className="rule-frame min-w-[350px] bg-card shadow-md">
          <CardHeader className="text-center">
            <CardTitle className="font-serif text-2xl">
              Invitation unavailable
            </CardTitle>
            <CardDescription>
              This invitation is invalid, expired, revoked, or already used.
              Ask the firm to issue a new one.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild className="w-full">
              <Link to="/login">Back to sign in</Link>
            </Button>
          </CardContent>
        </Card>
      </AuthLayout>
    );
  }

  if (!isAuthenticated) {
    // The identified sign-in renders right here; the token rides along and
    // is accepted immediately after the email code is verified.
    return (
      <AuthLayout subtitle="Accept your invitation">
        <p className="mb-4 max-w-sm text-center text-sm text-muted-foreground">
          {info.kind === "client"
            ? `You have been invited as a client${info.email ? ` (${info.email})` : ""}.`
            : `You have been invited to join as ${info.orgRole ? info.orgRole.replace(/_/g, " ") : "staff"}${info.email ? ` (${info.email})` : ""}.`}{" "}
          Sign in with the invited email to accept.
        </p>
        <SignInCard inviteToken={token} />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout subtitle="Accept your invitation">
      <Card className="rule-frame min-w-[350px] bg-card shadow-md">
        <CardHeader className="text-center">
          <CardTitle className="font-serif text-2xl">Confirm</CardTitle>
          <CardDescription>
            {info.kind === "client"
              ? "Accepting connects your account to the client record your lawyer prepared."
              : "Accepting grants you membership with the stated role."}{" "}
            You are signed in and ready to accept.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            className="w-full"
            onClick={async () => {
              try {
                await accept({ token });
                toast.success("Invitation accepted — welcome aboard.");
                navigate(info.kind === "client" ? "/portal" : "/staff", {
                  replace: true,
                });
              } catch (err) {
                toast.error(
                  err instanceof Error ? err.message : "Could not accept.",
                );
              }
            }}
          >
            Accept invitation
            <ArrowRight className="ml-2 size-4" />
          </Button>
        </CardContent>
      </Card>
    </AuthLayout>
  );
}

// ---------------------------------------------------------------
// Unified sign-in / registration. Roles, portals and permissions
// are resolved server-side after authentication — never from the
// page a visitor arrives on.
// ---------------------------------------------------------------

function SignInCard({ inviteToken }: { inviteToken?: string | null }) {
  const { signIn } = useAuth();
  const acceptInvite = useMutation(api.invitations.accept);
  const [mode, setMode] = useState<"signin" | "register">("signin");
  const [email, setEmail] = useState("");
  const [step, setStep] = useState<"email" | "code" | "twofactor">("email");
  const [otp, setOtp] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const handleEmailSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData(e.currentTarget);
      const email = String(fd.get("email") ?? "").trim();
      await signIn("email-otp", { email });
      setEmail(email);
      setStep("code");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the code.");
    } finally {
      setBusy(false);
    }
  };

  const handleVerify = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn("email-otp", { email, code: otp });
      if (inviteToken) {
        // Verified identity now binds the invitation: membership or
        // client grant, single-use, checked server-side.
        try {
          await acceptInvite({ token: inviteToken });
          toast.success("Invitation accepted — welcome aboard.");
          // RequireAuth resolves the new membership server-side and routes
          // staff to /staff, clients to /portal.
          navigate("/dashboard", { replace: true });
          return;
        } catch (err) {
          setError(err instanceof Error ? err.message : "Could not accept the invitation.");
          setBusy(false);
          return;
        }
      }
      // Login history (security feature): own rows only, best-effort.
      try {
        await recordLogin({ userAgent: navigator.userAgent });
      } catch {
        /* a dropped history row never blocks sign-in */
      }
      // Role and portal are resolved server-side after sign-in; RequireAuth
      // routes each account to its own workspace.
      navigate(
        resolveRedirectAfterAuth(searchParams.get("returnTo")),
        { replace: true },
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed.");
      setOtp("");
    } finally {
      setBusy(false);
    }
  };

  const twoFactorVerify = useMutation(api.twofactor.verifyForSession);
  const recordLogin = useMutation(api.sessions.recordLogin);

  const handleTwoFactor = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await twoFactorVerify({ code });
      try {
        // Login history (security feature): own rows only.
        await recordLogin({ userAgent: navigator.userAgent });
      } catch {
        /* history is best-effort; never blocks sign-in */
      }
      navigate(0); // reload picks up the satisfied session guard
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed.");
      setCode("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="rule-frame min-w-[350px] bg-card pb-0 shadow-md">
      {step === "email" && (
        <>
          <CardHeader className="text-center">
            <span className="mx-auto flex size-10 items-center justify-center rounded-md border border-border text-primary">
              <ScrollText className="size-5" aria-hidden="true" />
            </span>
            <CardTitle className="mt-3 font-serif text-2xl">
              Sign in to Advokate
            </CardTitle>
            <CardDescription>
              One entrance for advocates, firms, staff and clients — your
              workspace opens according to your account.
            </CardDescription>
            <div className="mt-3 flex justify-center gap-1 text-sm">
              <button
                type="button"
                onClick={() => setMode("signin")}
                className={mode === "signin" ? "font-semibold text-foreground" : "text-muted-foreground hover:text-foreground"}
              >
                Sign in
              </button>
              <span className="text-border">·</span>
              <button
                type="button"
                onClick={() => setMode("register")}
                className={mode === "register" ? "font-semibold text-foreground" : "text-muted-foreground hover:text-foreground"}
              >
                Register your practice
              </button>
              <span className="sr-only">Toggle between sign in and registration</span>
            </div>
          </CardHeader>
          <form onSubmit={handleEmailSubmit}>
            <CardContent>
              <div className="relative flex items-center gap-2">
                <div className="relative flex-1">
                  <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    name="email"
                    type="email"
                    required
                    placeholder={
                      mode === "register"
                        ? "your name@example.com"
                        : "name@example.com"
                    }
                    className="pl-9"
                    disabled={busy}
                  />
                </div>
                <Button type="submit" variant="outline" size="icon" disabled={busy}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                </Button>
              </div>
              {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
              <p className="mt-3 text-xs ink-faded">
                {mode === "register"
                  ? "Registering creates a new chamber. Staff and clients join by invitation — sign in with the invited email instead."
                  : "We email a six-digit code — no password to remember. Staff and clients: use the email your firm invited."}
              </p>
            </CardContent>
          </form>
        </>
      )}

      {step === "code" && (
        <>
          <CardHeader className="mt-4 text-center">
            <CardTitle className="font-serif text-2xl">
              Verify your email
            </CardTitle>
            <CardDescription>
              Six-digit code sent to {email}
            </CardDescription>
          </CardHeader>
          <form onSubmit={handleVerify}>
            <CardContent className="flex flex-col items-center gap-4">
              <InputOTP value={otp} onChange={setOtp} maxLength={6} disabled={busy}>
                <InputOTPGroup>
                  {Array.from({ length: 6 }).map((_, i) => (
                    <InputOTPSlot key={i} index={i} />
                  ))}
                </InputOTPGroup>
              </InputOTP>
              {error && <p className="text-sm text-destructive">{error}</p>}
            </CardContent>
            <CardFooter className="flex-col gap-2">
              <Button type="submit" className="w-full" disabled={busy || otp.length !== 6}>
                {busy ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Verifying…
                  </>
                ) : (
                  <>
                    Verify &amp; continue <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>
              <Button type="button" variant="ghost" className="w-full" onClick={() => setStep("email")} disabled={busy}>
                Use a different email
              </Button>
            </CardFooter>
          </form>
        </>
      )}

      {step === "twofactor" && (
        <TwoFactorStep
          code={code}
          setCode={setCode}
          onSubmit={handleTwoFactor}
          busy={busy}
          error={error}
          onBack={() => setStep("email")}
        />
      )}
    </Card>
  );
}

function TwoFactorStep({
  code,
  setCode,
  onSubmit,
  busy,
  error,
  onBack,
}: {
  code: string;
  setCode: (v: string) => void;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  busy: boolean;
  error: string | null;
  onBack: () => void;
}) {
  return (
    <>
      <CardHeader className="mt-4 text-center">
        <span className="mx-auto flex size-10 items-center justify-center rounded-md border border-border text-primary">
          <ShieldCheck className="size-5" aria-hidden="true" />
        </span>
        <CardTitle className="mt-3 font-serif text-2xl">Two-factor required</CardTitle>
        <CardDescription>
          Enter the 6-digit code from your authenticator, or a recovery code.
        </CardDescription>
      </CardHeader>
      <form onSubmit={onSubmit}>
        <CardContent className="flex flex-col items-center gap-3">
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="123456 or recovery code"
            className="text-center font-mono"
            maxLength={16}
            required
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
        <CardFooter className="flex-col gap-2">
          <Button type="submit" className="w-full" disabled={busy || !code}>
            {busy ? "Verifying…" : "Verify"}
          </Button>
          <Button type="button" variant="ghost" className="w-full" onClick={onBack} disabled={busy}>
            Back
          </Button>
        </CardFooter>
      </form>
    </>
  );
}

// ---------------------------------------------------------------
// Signed-in visitor at /login — continue to their workspace
// ---------------------------------------------------------------

// Exported for the signed-in-Continue regression tests (SessionGate.test.tsx).
export function SessionGate({ twoFactorNeeded }: { twoFactorNeeded: boolean }) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const searchParams = useSearchParams()[0];
  const returnTo = searchParams.get("returnTo");
  // Authorization resolved from memberships server-side; the legacy role
  // is only a fallback. Arriving on this page never grants privileges.
  //
  // HOOK ORDER: every hook below runs UNCONDITIONALLY on every render of
  // this component. Convex `useQuery` is itself a hook, so it must sit
  // above any conditional early returns — otherwise the render that
  // follows query resolution (or a twoFactorNeeded toggle) executes a
  // different number of hooks and React throws "Rendered more hooks than
  // during the previous render" (preview regression, fixed 13 Oct 2026;
  // reproduced by SessionGate.test.tsx hook-order stability tests).
  // reproduced by SessionGate.test.tsx hook-order stability tests).
  const resolved = useQuery(api.orgs.resolve);
  const isPlatformIdentity = useQuery(api.workforce.myPlatformIdentity);

  if (twoFactorNeeded) {
    return (
      <AuthLayout subtitle="Security check">
        <TwoFactorChallengeCard onDone={() => navigate(0)} />
      </AuthLayout>
    );
  }

  if (resolved === undefined) {
    return (
      <AuthLayout subtitle="Member & Client Access">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Checking your access…
        </div>
      </AuthLayout>
    );
  }

  // Where does this account's resolved portal lead? Shared policy with
  // RequireAuth: a returnTo that is a safe internal path wins; /login is
  // NEVER a destination (that was the signed-in self-loop regression);
  // platform identities without a memberships row resume at /owner; any
  // other account without a portal lands on the account hub (/settings),
  // which offers organisation creation instead of looping to /login.
  const mine = resolved.portal;
  const identityKnown = isPlatformIdentity !== undefined;
  const isIdentity =
    identityKnown &&
    isPlatformIdentity !== null &&
    (isPlatformIdentity.isPlatformAdmin ||
      isPlatformIdentity.platformRole !== null);
  const home = identityKnown
    ? portalHome(mine, !!isIdentity)
    : mine === "client"
      ? "/portal"
      : mine === "staff"
        ? "/staff"
        : mine === "firm"
          ? "/dashboard"
          : "/settings";

  return (
    <AuthLayout subtitle="Member & Client Access">
      <Card className="rule-frame min-w-[350px] bg-card shadow-md">
        <CardHeader className="text-center">
          <CardTitle className="font-serif text-2xl">
            You are already signed in
          </CardTitle>
          <CardDescription>
            {user?.email
              ? `Signed in as ${user.email}. Continue to your workspace.`
              : "Continue to your workspace."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Button asChild className="w-full">
            <Link
              to={
                identityKnown
                  ? postAuthDestination(returnTo, mine, !!isIdentity)
                  : home
              }
            >
              Continue
              <ArrowRight className="ml-2 size-4" />
            </Link>
          </Button>
          <Button
            variant="ghost"
            className="w-full"
            onClick={async () => {
              await signOut();
              navigate("/login?reason=signedout", { replace: true });
            }}
          >
            Sign out
          </Button>
        </CardContent>
      </Card>
    </AuthLayout>
  );
}

// ---------------------------------------------------------------
// Two-factor challenge for a signed-in but unverified session
// ---------------------------------------------------------------

function TwoFactorChallengeCard({ onDone }: { onDone: () => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const verify = useMutation(api.twofactor.verifyForSession);

  return (
    <TwoFactorStep
      code={code}
      setCode={setCode}
      busy={busy}
      error={error}
      onBack={() => undefined}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await verify({ code });
          onDone();
        } catch (err) {
          setError(err instanceof Error ? err.message : "Verification failed.");
          setCode("");
        } finally {
          setBusy(false);
        }
      }}
    />
  );
}

// ---------------------------------------------------------------
// Shared layout
// ---------------------------------------------------------------

function AuthLayout({
  children,
  subtitle,
  wide,
}: {
  children: React.ReactNode;
  subtitle?: string;
  wide?: boolean;
}) {
  return (
    <div className="paper-texture flex min-h-screen flex-col">
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <div className={`flex w-full flex-col items-center ${wide ? "max-w-2xl" : "max-w-md"}`}>
          <div className="mb-8">
            <BrandMark subtitle="The Digital Chamber" />
          </div>
          {subtitle && (
            <p className="type-label ink-faded mb-4">{subtitle}</p>
          )}
          {children}
          <div className="mt-6 w-full text-center">
            <Link
              to="/"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-4" />
              Back to Advokate home
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <Login />
    </Suspense>
  );
}
