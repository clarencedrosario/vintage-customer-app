import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api } from "@/convex/_generated/api";
import { useAction, useMutation, useQuery } from "convex/react";
import { CheckCircle2, Github, Link2, ShieldCheck, XCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

/**
 * GitHub integration (Settings) — owner/administrator only by capability.
 * The token lives in the server-side environment (Keys tab); the card
 * only verifies it and manages repository connections. Every connection
 * is verified against the API before it is stored, and every action is
 * audited.
 */
export function GitHubCard() {
  const connections = useQuery(api.githubStore.listConnections, {});
  const audit = useQuery(api.githubStore.recentAudit, {});

  const verify = useAction(api.github.verifyToken);
  const connect = useAction(api.github.connectRepo);
  const disconnect = useMutation(api.githubStore.disconnectRepo);

  const [repoInput, setRepoInput] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState<string | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  const runVerify = async () => {
    setVerifying(true);
    setVerified(null);
    setVerifyError(null);
    try {
      const r = await verify({});
      if (r.ok) {
        setVerified(r.login);
        toast.success(`GitHub token verified as ${r.login}.`);
      } else {
        setVerifyError(r.error ?? "Verification failed.");
      }
    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : "Verification failed.");
    } finally {
      setVerifying(false);
    }
  };

  const runConnect = async () => {
    const repo = repoInput.trim();
    if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) {
      toast.error('Enter the repository as "owner/name".');
      return;
    }
    setConnecting(true);
    try {
      const r = await connect({ repo });
      toast.success(
        `Connected ${r.fullName} (default branch ${r.defaultBranch}${r.canPush ? ", push allowed" : ""}).`,
      );
      setRepoInput("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not connect the repository.");
    } finally {
      setConnecting(false);
    }
  };

  return (
    <Card className="rule-frame bg-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-serif">
          <Github className="size-4" aria-hidden="true" /> GitHub integration
        </CardTitle>
        <CardDescription className="ink-faded">
          Link a repository so the chamber can push matter chronologies as
          versioned documents. The access token is stored server-side (Keys
          tab) and is never shown here.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Token status */}
        <div className="space-y-2">
          <p className="type-label ink-faded">Access token (GITHUB_TOKEN)</p>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" size="sm" onClick={runVerify} disabled={verifying}>
              <ShieldCheck className="mr-2 h-4 w-4" />
              {verifying ? "Verifying…" : "Verify token"}
            </Button>
            {verified && (
              <span className="flex items-center gap-1.5 text-sm">
                <CheckCircle2 className="size-4 text-primary" aria-hidden="true" />
                Verified as <strong className="font-medium">{verified}</strong>
              </span>
            )}
            {verifyError && (
              <span className="flex items-center gap-1.5 text-sm text-destructive">
                <XCircle className="size-4" aria-hidden="true" />
                {verifyError}
              </span>
            )}
          </div>
          {!verified && !verifyError && (
            <p className="text-xs ink-faded">
              Create a fine-grained personal access token with read access to
              the repositories you want to link (and contents write access if
              you plan to push chronologies), then add it as{" "}
              <code className="rounded bg-muted px-1 py-0.5">GITHUB_TOKEN</code>{" "}
              in the Keys tab.
            </p>
          )}
        </div>

        {/* Connect a repository */}
        <div className="space-y-2">
          <p className="type-label ink-faded">Connect a repository</p>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={repoInput}
              onChange={(e) => setRepoInput(e.target.value)}
              placeholder="owner/repository"
              className="max-w-xs"
              aria-label="Repository (owner/name)"
            />
            <Button size="sm" onClick={runConnect} disabled={connecting || !repoInput.trim()}>
              <Link2 className="mr-2 h-4 w-4" />
              {connecting ? "Connecting…" : "Connect"}
            </Button>
          </div>
        </div>

        {/* Connected repositories */}
        <div className="space-y-2">
          <p className="type-label ink-faded">Connected repositories</p>
          {connections === undefined ? (
            <p className="text-sm ink-faded">Retrieving connections…</p>
          ) : connections.length === 0 ? (
            <p className="text-sm ink-faded">
              No repositories connected yet.
            </p>
          ) : (
            <div className="space-y-2">
              {connections.map((c) => (
                <div
                  key={c._id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-background p-3"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{c.repo}</span>
                      <Badge variant="secondary" className="text-xs">
                        {c.defaultBranch}
                      </Badge>
                    </div>
                    <p className="type-label mt-1 ink-faded">
                      Connected {new Date(c.connectedAt).toLocaleDateString()}
                      {" · "}
                      Last verified {new Date(c.lastVerifiedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={async () => {
                      try {
                        await disconnect({ repo: c.repo });
                        toast.success(`Disconnected ${c.repo}.`);
                      } catch (err) {
                        toast.error(
                          err instanceof Error ? err.message : "Could not disconnect.",
                        );
                      }
                    }}
                  >
                    Disconnect
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Audit trail */}
        {audit && audit.length > 0 && (
          <div className="space-y-2">
            <p className="type-label ink-faded">Recent activity</p>
            <ul className="space-y-1.5">
              {audit.slice(0, 6).map((a) => (
                <li key={a._id} className="text-xs ink-faded">
                  <span className="font-medium text-foreground">{a.actorName}</span>{" "}
                  — {a.detail ?? a.action}
                  <span className="mx-1.5">·</span>
                  {new Date(a.createdAt).toLocaleString()}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
