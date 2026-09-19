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
  Briefcase,
  Landmark,
  Loader2,
  Mail,
  ShieldCheck,
  UserRound,
  CalendarClock,
} from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { toast } from "sonner";
import { useMutation, useQuery } from "convex/react";

const PORTALS = {
  lawyer: {
    icon: Briefcase,
    title: "Lawyer Login",
    blurb: "Manage your matters, clients and court schedule.",
    registerable: true,
  },
  firm: {
    icon: Landmark,
    title: "Law Firm Login",
    blurb: "Manage your firm, legal team and practice.",
    registerable: true,
  },
  staff: {
    icon: CalendarClock,
    title: "Peon / Support Staff Login",
    blurb: "Staff join by invitation from the firm — sign in with the email you were invited on.",
    registerable: false,
  },
  client: {
    icon: UserRound,
    title: "Client Login",
    blurb: "Clients are connected by their lawyer. Sign in with the email your lawyer invited.",
    registerable: false,
  },
} as const;

type PortalId = keyof typeof PORTALS;

function resolveRedirectAfterAuth(returnTo: string | null): string {
  if (returnTo?.startsWith("/") && !returnTo.startsWith("//")) return returnTo;
  return "/dashboard";
}

/** OTP codes can also be 6-hex recovery codes typed into the same box. */
function Login() {
  const { portal } = useParams<{ portal: string }>();
  const [searchParams] = useSearchParams();
  const { isLoading, isAuthenticated, user } = useAuth();
  const twoFactor = useQuery(api.twofactor.sessionSatisfied);

  const validPortal = (portal && portal in PORTALS ? portal : null) as PortalId | null;
  const inviteToken = searchParams.get("invite");

  // Successful logout lands on the selector; preserve existing sessions.
  useEffect(() => {
    if (searchParams.get("reason") === "signedout") {
      toast.info("You have been signed out.");
    }
  }, [searchParams]);

  // Invitation links take priority: /login?invite=…
  if (inviteToken) {
    return <InviteFlow token={inviteToken} />;
  }

  if (!validPortal) {
    return <PortalSelector />;
  }

  const P = PORTALS[validPortal];

  // A session exists: offer continuation into an authorized portal.
  if (!isLoading && isAuthenticated && user) {
    if (twoFactor === undefined) {
      return <LoadingScreen />;
    }
    return (
      <PortalGate
        portal={validPortal}
        twoFactorNeeded={twoFactor.needed && !twoFactor.satisfied}
      />
    );
  }

  return (
    <AuthLayout subtitle={P.title}>
      <SignInCard portal={validPortal} inviteToken={inviteToken} />
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
// Selector shown at /login (and for invalid portal values)
// ---------------------------------------------------------------

function PortalSelector() {
  const entries = Object.entries(PORTALS) as [PortalId, (typeof PORTALS)[PortalId]][];
  return (
    <AuthLayout wide>
      <p className="type-label ink-faded">Member &amp; Client Access</p>
      <h1 className="mt-2 font-serif text-3xl font-semibold tracking-tight">
        Choose your portal
      </h1>
      <p className="mt-2 max-w-md text-sm ink-faded">
        Four ways in, one chamber. Each opens its own sign-in.
      </p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {entries.map(([id, P]) => (
          <Link
            key={id}
            to={`/login/${id}`}
            className="group rounded-xl border border-border bg-card p-5 shadow-sm transition-shadow hover:shadow-md"
          >
            <span className="flex size-9 items-center justify-center rounded-md border border-border text-primary">
              <P.icon className="size-4.5" aria-hidden="true" />
            </span>
            <h2 className="mt-3 font-serif text-lg font-semibold">{P.title}</h2>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              {P.blurb}
            </p>
            <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-[#8a6a33]">
              Login Now
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </span>
          </Link>
        ))}
      </div>
      <div className="mt-8 text-center">
        <Link
          to="/find-a-lawyer"
          className="text-sm font-medium text-[#8a6a33] underline-offset-4 hover:underline"
        >
          Find a Lawyer — for public visitors
        </Link>
      </div>
    </AuthLayout>
  );
}

// ---------------------------------------------------------------
// Identified sign-in / registration for a selected portal
// ---------------------------------------------------------------

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
    // Route through the identified sign-in; the token rides along and is
    // accepted immediately after the email code is verified.
    const portal: PortalId = info.kind === "client" ? "client" : "staff";
    return (
      <AuthLayout subtitle="Accept your invitation">
        <Card className="rule-frame min-w-[350px] bg-card shadow-md">
          <CardHeader className="text-center">
            <CardTitle className="font-serif text-2xl">
              You are invited
            </CardTitle>
            <CardDescription>
              {info.kind === "client"
                ? `You have been invited as a client${info.email ? ` (${info.email})` : ""}.`
                : `You have been invited to join as ${info.orgRole ? info.orgRole.replace(/_/g, " ") : "staff"}${info.email ? ` (${info.email})` : ""}.`}{' '}
              Sign in with the invited email to accept.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild className="w-full">
              <Link to={`/login/${portal}?invite=${encodeURIComponent(token)}`}>
                Sign in to accept
                <ArrowRight className="ml-2 size-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
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

function SignInCard({ portal, inviteToken }: { portal: PortalId; inviteToken?: string | null }) {
  const P = PORTALS[portal];
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

  const registerable = P.registerable;

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
          navigate(portal === "client" ? "/portal" : "/staff", { replace: true });
          return;
        } catch (err) {
          setError(err instanceof Error ? err.message : "Could not accept the invitation.");
          setBusy(false);
          return;
        }
      }
      // Role and portal are resolved server-side after sign-in.
      navigate(resolveRedirectAfterAuth(new URLSearchParams(window.location.search).get("returnTo")), { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed.");
      setOtp("");
    } finally {
      setBusy(false);
    }
  };

  const handleTwoFactor = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await twoFactorVerify({ code });
      navigate(0); // reload: reload picks up the satisfied session guard
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed.");
      setCode("");
    } finally {
      setBusy(false);
    }
  };

  const twoFactorVerify = useMutation(api.twofactor.verifyForSession);

  return (
    <Card className="rule-frame min-w-[350px] bg-card pb-0 shadow-md">
      {step === "email" && (
        <>
          <CardHeader className="text-center">
            <span className="mx-auto flex size-10 items-center justify-center rounded-md border border-border text-primary">
              <P.icon className="size-5" aria-hidden="true" />
            </span>
            <CardTitle className="mt-3 font-serif text-2xl">{P.title}</CardTitle>
            <CardDescription>{P.blurb}</CardDescription>
            {registerable && (
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
                  Register
                </button>
                <span className="sr-only">Toggle between sign in and registration</span>
              </div>
            )}
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
                    placeholder={portal === "client" ? "email your lawyer invited" : "name@example.com"}
                    className="pl-9"
                    disabled={busy}
                  />
                </div>
                <Button type="submit" variant="outline" size="icon" disabled={busy}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                </Button>
              </div>
              {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
              {!registerable && (
                <p className="mt-3 text-xs ink-faded">
                  Staff and clients cannot self-register. Ask your firm to invite you.
                </p>
              )}
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
                    Verify & continue <ArrowRight className="ml-2 h-4 w-4" />
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
// Signed-in visitor at /login/:portal — gate or bounce
// ---------------------------------------------------------------

function PortalGate({
  portal,
  twoFactorNeeded,
}: {
  portal: PortalId;
  twoFactorNeeded: boolean;
}) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const searchParams = useSearchParams()[0];
  const returnTo = searchParams.get("returnTo");
  // Authorization resolved from memberships server-side; the legacy role
  // is only a fallback. Clicking a card never grants privileges.
  const resolved = useQuery(api.orgs.resolve);

  if (twoFactorNeeded) {
    return (
      <AuthLayout subtitle="Security check">
        <TwoFactorChallengeCard onDone={() => navigate(0)} />
      </AuthLayout>
    );
  }

  if (resolved === undefined) {
    return (
      <AuthLayout subtitle={PORTALS[portal].title}>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Checking your access…
        </div>
      </AuthLayout>
    );
  }

  // Which home does this account's resolved portal lead to?
  const mine = resolved.portal;
  const home =
    mine === "client"
      ? "/portal"
      : mine === "staff"
        ? "/staff"
        : mine === "firm"
          ? "/dashboard"
          : "/login";

  // "lawyer" and "firm" cards both open the console for org members.
  const wanted =
    portal === "client" ? "client" : portal === "staff" ? "staff" : "firm";
  const authorized = mine !== null && mine === wanted;

  return (
    <AuthLayout subtitle={PORTALS[portal].title}>
      <Card className="rule-frame min-w-[350px] bg-card shadow-md">
        <CardHeader className="text-center">
          <CardTitle className="font-serif text-2xl">
            {authorized ? `Continue to ${PORTALS[portal].title.replace(" Login", "")}` : "Different portal"}
          </CardTitle>
          <CardDescription>
            {authorized
              ? `You are signed in as ${user?.email ?? "a member"} and authorized for this portal.`
              : `Your account (${user?.email ?? ""}) is not authorized for this portal.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Button asChild className="w-full">
            <Link to={authorized ? (returnTo ? resolveRedirectAfterAuth(returnTo) : home) : home}>
              Continue
              <ArrowRight className="ml-2 size-4" />
            </Link>
          </Button>
          <Button variant="outline" className="w-full" onClick={() => navigate("/login")}>
            Choose another portal
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
              to="/login"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-4" />
              Choose another portal
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
