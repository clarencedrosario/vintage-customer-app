"use node";

// ===============================================================
// GitHub provider bridge — runs in the Node runtime.
//
// The token is read ONLY from the server-side environment (Keys tab
// → GITHUB_TOKEN). It is never returned to the browser, never logged,
// and never included in error messages. All state changes (connect /
// audit rows) happen through internal mutations in githubStore.ts so
// writes stay transactional; this file only talks to the GitHub REST
// API and returns plain data.
//
// Every repository claim is verified against the API with the
// configured token before it is stored — the app never records a
// connection it has not actually been able to read.
// ===============================================================

import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

/** Resolve the caller (org admin or above) in the default runtime.
 *  Actions have no direct db access, so authorization runs as a query
 *  against githubStore.actorInternal. */
async function actor(
  ctx: { runQuery: Function },
): Promise<{ orgId: Id<"organizations">; userId: Id<"users">; userName: string }> {
  return (await ctx.runQuery(internal.githubStore.actorInternal, {})) as {
    orgId: Id<"organizations">;
    userId: Id<"users">;
    userName: string;
  };
}

const API = "https://api.github.com";
const MAX_EVENTS_PER_COMMIT = 200;

// ---------------------------------------------------------------------
// Low-level REST helpers
// ---------------------------------------------------------------------

function token(): string | null {
  const t = process.env.GITHUB_TOKEN;
  return t && t.trim().length > 0 ? t.trim() : null;
}

export function hasToken(): boolean {
  return token() !== null;
}

async function gh<T>(
  path: string,
  init?: { method?: "GET" | "PUT" | "POST" | "DELETE"; body?: unknown },
): Promise<T> {
  const t = token();
  if (!t) throw new Error("GITHUB_TOKEN is not set (add it in the Keys tab).");
  const res = await fetch(`${API}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${t}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      // A user agent is required by the GitHub API.
      "User-Agent": "advokate-chamber",
    },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (!res.ok) {
    // Never echo the token; include only status + a short reason.
    let reason = "request failed";
    if (res.status === 401) reason = "token rejected (401) — check GITHUB_TOKEN";
    else if (res.status === 403) reason = "forbidden (403) — token lacks access to this resource";
    else if (res.status === 404) reason = "not found (404) — repository or path does not exist";
    else if (res.status === 422) reason = "unprocessable (422) — likely a conflicting file";
    try {
      const j = (await res.json()) as { message?: string };
      if (j.message) reason = `${reason}: ${j.message.slice(0, 160)}`;
    } catch {
      // ignore body parse issues
    }
    throw new Error(`GitHub request failed — ${reason}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

type RepoInfo = {
  full_name: string;
  name: string;
  owner: { login: string };
  default_branch: string;
  private: boolean;
  permissions?: { push?: boolean; admin?: boolean };
};

type BranchInfo = { name: string; commit: { sha: string } };

type ContentInfo = {
  sha: string | null;
  commit: { sha: string };
  content: { html_url: string } | null;
};

function splitRepo(repo: string): { owner: string; name: string } {
  const parts = repo.split("/").map((p) => p.trim()).filter(Boolean);
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error('Repository must look like "owner/name".');
  }
  return { owner: parts[0], name: parts[1] };
}

/** Encode each path segment but keep "/" separators intact. */
function encodePath(path: string): string {
  return path.split("/").map((seg) => encodeURIComponent(seg)).join("/");
}

// ---------------------------------------------------------------------
// Actions — the browser calls these; all authorization-checked
// ---------------------------------------------------------------------

/** Verify the token works and return the identity it belongs to
 *  (login only — never the token itself). */
export const verifyToken = action({
  args: {},
  handler: async () => {
    if (!hasToken()) {
      return {
        ok: false as const,
        error: "GITHUB_TOKEN is not set (add it in the Keys tab).",
      };
    }
    try {
      const me = await gh<{ login: string }>("/user");
      return { ok: true as const, login: me.login };
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : "Token check failed.",
      };
    }
  },
});

/** List repositories the token can actually read (live, page 1). */
export const listRepos = action({
  args: {},
  handler: async () => {
    if (!hasToken()) {
      throw new Error("GITHUB_TOKEN is not set (add it in the Keys tab).");
    }
    const aff = "owner,collaborator,organization_member";
    const repos = await gh<RepoInfo[]>(
      `/user/repos?per_page=50&affiliation=${encodeURIComponent(aff)}&sort=updated`,
    );
    return repos.map((r) => ({
      fullName: r.full_name,
      defaultBranch: r.default_branch,
      isPrivate: r.private,
      canPush: r.permissions?.push === true,
    }));
  },
});

/** List branches of a repository (verified live against the API). */
export const listBranches = action({
  args: { repo: v.string() },
  handler: async (ctx, args) => {
    await actor(ctx);
    const { owner, name } = splitRepo(args.repo);
    const branches = await gh<BranchInfo[]>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/branches?per_page=50`,
    );
    return branches.map((b) => ({ name: b.name, sha: b.commit.sha }));
  },
});

/** Connect (or re-verify) a repository. The repo is fetched with the
 *  token first — only a readable repo can be connected — then the
 *  connection row is written transactionally in githubStore. */
export const connectRepo = action({
  args: { repo: v.string() },
  handler: async (ctx, args) => {
    const ac = await actor(ctx);
    const { owner, name } = splitRepo(args.repo);

    const info = await gh<RepoInfo>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
    );

    await ctx.runMutation(internal.githubStore.upsertConnection, {
      orgId: ac.orgId,
      repo: info.full_name,
      owner: info.owner.login,
      name: info.name,
      defaultBranch: info.default_branch,
      actorId: ac.userId,
      actorName: ac.userName,
    });

    return {
      fullName: info.full_name,
      defaultBranch: info.default_branch,
      isPrivate: info.private,
      canPush: info.permissions?.push === true,
    };
  },
});

// ---------------------------------------------------------------------
// Push chronology — export a matter's chronology as a Markdown file in
// the repository (docs/chronology/<reference>.md). Uses the Contents
// API; updates an existing file by including its blob sha.
// ---------------------------------------------------------------------

export const pushChronology = action({
  args: {
    repo: v.string(),
    branch: v.optional(v.string()),
    reference: v.string(),
    title: v.string(),
    events: v.array(
      v.object({
        occurredAt: v.optional(v.number()),
        createdAt: v.number(),
        detail: v.string(),
        datePrecision: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const ac = await actor(ctx);
    const { owner, name } = splitRepo(args.repo);
    const repoPath = `repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;

    // Keep the most recent events if the matter is very long.
    const capped = args.events.slice(-MAX_EVENTS_PER_COMMIT);

    const lines: string[] = [];
    lines.push(`# Chronology — ${args.title}`);
    lines.push("");
    lines.push(`Matter reference: \`${args.reference}\``);
    lines.push(
      `Exported from the chamber app on ${new Date().toISOString().slice(0, 10)}.`,
    );
    lines.push("");
    lines.push("| Date (approx.) | Precision | Entry |");
    lines.push("| --- | --- | --- |");
    for (const e of [...capped].sort((a, b) => {
      const at = (a.occurredAt ?? a.createdAt) as number;
      const bt = (b.occurredAt ?? b.createdAt) as number;
      return at - bt;
    })) {
      const when = new Date(e.occurredAt ?? e.createdAt).toISOString().slice(0, 10);
      const detail = e.detail.replace(/\|/g, "\\|").replace(/\n/g, " ");
      lines.push(`| ${when} | ${e.datePrecision ?? "exact"} | ${detail} |`);
    }
    lines.push("");
    lines.push(
      "_Generated from the chamber's chronology. Entries reflect what was recorded at export time._",
    );
    const content = Buffer.from(lines.join("\n"), "utf8").toString("base64");

    const path = `docs/chronology/${args.reference.replace(/[^\w.-]+/g, "_")}.md`;
    let existingSha: string | undefined;
    try {
      const existing = await gh<{ sha: string }>(
        `/${repoPath}/contents/${encodePath(path)}`,
      );
      existingSha = existing.sha;
    } catch {
      // File does not exist yet — fine.
    }

    const result = await gh<ContentInfo>(
      `/${repoPath}/contents/${encodePath(path)}`,
      {
        method: "PUT",
        body: {
          message: `Chronology export: ${args.reference}`,
          content,
          branch: args.branch || undefined,
          sha: existingSha,
        },
      },
    );

    await ctx.runMutation(internal.githubStore.auditWrite, {
      orgId: ac.orgId,
      actorId: ac.userId,
      actorName: ac.userName,
      action: "push_chronology",
      repo: args.repo,
      detail: `Pushed chronology for ${args.reference} (${capped.length} entries) to ${path}.`,
    });

    return {
      path,
      commitSha: result.commit.sha,
      fileUrl: result.content?.html_url ?? null,
      entryCount: capped.length,
    };
  },
});
