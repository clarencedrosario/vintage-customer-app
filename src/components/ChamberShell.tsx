import { Link, NavLink } from "react-router";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import {
  ScrollText,
  Landmark,
  Receipt,
  Users,
  Settings,
  LogOut,
} from "lucide-react";

const CHAMBER_NAV = [
  { to: "/dashboard", label: "Overview", icon: Landmark },
  { to: "/billing", label: "Billing", icon: Receipt },
  { to: "/clients", label: "Clients", icon: Users },
  { to: "/team", label: "Team", icon: ScrollText },
  { to: "/settings", label: "Settings", icon: Settings },
];

/**
 * Shared authenticated shell for the chamber: header, navigation, sign-out.
 */
export function ChamberShell({
  subtitle,
  children,
  actions,
}: {
  subtitle: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  const { user, signOut } = useAuth();

  return (
    <div className="paper-texture min-h-screen">
      <header className="border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-6">
          <div className="flex items-center justify-between py-5">
            <Link to="/dashboard" className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-full border border-foreground/25 text-primary">
                <ScrollText className="size-5" />
              </span>
              <span className="flex flex-col leading-tight">
                <span className="font-serif text-lg font-semibold tracking-[0.08em]">
                  ADVOKATE.IN
                </span>
                <span className="type-label ink-faded">{subtitle}</span>
              </span>
            </Link>
            <div className="flex items-center gap-4">
              {actions}
              <span className="hidden text-sm ink-faded sm:inline">
                {user?.name ?? user?.email ?? "Member"}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  await signOut();
                }}
              >
                <LogOut className="mr-2 size-4" />
                Sign out
              </Button>
            </div>
          </div>
          <nav className="flex gap-1 overflow-x-auto pb-2">
            {CHAMBER_NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `flex items-center gap-1.5 whitespace-nowrap rounded-t border-b-2 px-3 py-2 text-sm transition-colors ${
                    isActive
                      ? "border-primary text-primary"
                      : "border-transparent ink-faded hover:text-foreground"
                  }`
                }
              >
                <item.icon className="size-4" />
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
