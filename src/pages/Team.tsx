import { ChamberShell } from "@/components/ChamberShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { useMutation, useQuery } from "convex/react";
import { ScrollText } from "lucide-react";
import { toast } from "sonner";

export default function Team() {
  const { user: me } = useAuth();
  const team = useQuery(api.workspace.team);
  const setRole = useMutation(api.workspace.setRole);

  return (
    <ChamberShell subtitle="The Digital Chamber">
      <p className="type-label ink-faded">Members of Chambers</p>
      <h1 className="mt-2 font-serif text-3xl font-semibold tracking-tight">
        Team
      </h1>
      <p className="mt-2 max-w-2xl ink-faded">
        Advocates and staff with access to this chamber. The administrator may
        adjust roles; members appear in matter assignee lists.
      </p>

      {team === undefined ? (
        <p className="mt-10 text-sm ink-faded">Calling the roll…</p>
      ) : team.length === 0 ? (
        <Card className="mt-10 border-dashed">
          <CardContent className="py-12 text-center text-sm ink-faded">
            No members yet.
          </CardContent>
        </Card>
      ) : (
        <ul className="mt-8 space-y-3">
          {team.map((m) => (
            <li
              key={m._id}
              className="rule-frame flex flex-wrap items-center justify-between gap-4 bg-card px-5 py-4"
            >
              <div className="min-w-0">
                <p className="font-serif text-lg font-semibold">
                  {m.name ?? "—"}
                  {m._id === me?._id && (
                    <span className="type-label ml-2 ink-faded">(you)</span>
                  )}
                </p>
                <p className="text-sm ink-faded">
                  {[m.designation, m.email].filter(Boolean).join(" · ")}
                </p>
                {m.barCouncilId && (
                  <p className="type-label mt-0.5 ink-faded">
                    Bar ID {m.barCouncilId}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-3">
                {me?.role === "admin" && m._id !== me._id ? (
                  <Select
                    value={m.role ?? "member"}
                    onValueChange={async (v) => {
                      try {
                        await setRole({
                          userId: m._id,
                          role: v as "admin" | "user" | "member",
                        });
                        toast.success("Role updated.");
                      } catch (err) {
                        toast.error(
                          err instanceof Error ? err.message : "Failed.",
                        );
                      }
                    }}
                  >
                    <SelectTrigger className="w-36">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">Administrator</SelectItem>
                      <SelectItem value="user">Advocate</SelectItem>
                      <SelectItem value="member">Staff</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <span className="stamp ink-faded">
                    {m.role === "admin" ? "Administrator" : m.role === "user" ? "Advocate" : "Member"}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </ChamberShell>
  );
}
