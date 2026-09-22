import { useState } from "react";
import { Link, NavLink, useNavigate } from "react-router";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Check, ChevronsUpDown, Building2, ClipboardList, FileCheck } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Activity,
  Bell,
  BellRing,
  BookOpen,
  Landmark,
  LogOut,
  Menu,
  Receipt,
  ScrollText,
  Settings,
  Shield,
  Users,
  UsersRound,
} from "lucide-react";

const NAV = [
  { to: "/dashboard", label: "Overview", icon: Landmark },
  { to: "/attention", label: "Morning docket", icon: BellRing },
  { to: "/tasks", label: "Tasks", icon: ClipboardList },
  { to: "/drafts", label: "Draft review", icon: FileCheck },
  { to: "/comms", label: "Comms", icon: ScrollText },
  { to: "/health", label: "Matter health", icon: Activity },
  { to: "/reports", label: "Reports", icon: ScrollText },
  { to: "/knowledge", label: "Knowledge & courts", icon: BookOpen },
  { to: "/clients", label: "Clients", icon: Users },
  { to: "/billing", label: "Billing", icon: Receipt },
  { to: "/team", label: "Team", icon: UsersRound },
  { to: "/settings", label: "Settings", icon: Settings },
];

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Chamber navigation" className="flex flex-col gap-1 px-3">
      {NAV.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          onClick={onNavigate}
          className={({ isActive }) =>
            `sidebar-link${isActive ? " sidebar-link-active" : ""}`
          }
        >
          <item.icon className="size-4 shrink-0" aria-hidden="true" />
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}

const KIND_LABEL: Record<string, string> = {
  hearing_reminder: "Hearing",
  deadline_reminder: "Deadline",
  task_assigned: "Task",
  doc_request: "Documents",
  message: "Message",
  draft_approval: "Draft",
  invoice_followup: "Invoice",
  automation: "Automation",
};

/** Top-bar notification centre: unread badge, list, per-item open + mark-read. */
function NotificationBell() {
  const unread = useQuery(api.notifications.unreadCount);
  const items = useQuery(api.notifications.list, { limit: 25 });
  const markRead = useMutation(api.notifications.markRead);
  const markAllRead = useMutation(api.notifications.markAllRead);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const count = unread ?? 0;

  const openItem = async (id: string, linkTo?: string) => {
    setOpen(false);
    try {
      await markRead({ notificationId: id as never });
    } catch {
      // Read state is best-effort; still navigate.
    }
    if (linkTo) navigate(linkTo);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="relative inline-flex size-9 items-center justify-center rounded-md border border-border bg-card text-foreground transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-[#B68A45]"
          aria-label={count > 0 ? `Notifications, ${count} unread` : "Notifications"}
        >
          <Bell className="size-4.5" aria-hidden="true" />
          {count > 0 && (
            <span className="absolute -right-1 -top-1 flex min-w-4.5 items-center justify-center rounded-full bg-[#B68A45] px-1 text-[10px] font-semibold leading-4 text-white">
              {count > 99 ? "99+" : count}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="font-serif text-sm font-semibold">Notifications</span>
          {count > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => {
                void markAllRead();
              }}
            >
              Mark all read
            </Button>
          )}
        </div>
        <div className="max-h-96 overflow-y-auto">
          {!items && (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">Loading…</p>
          )}
          {items && items.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              Nothing yet — reminders, tasks and messages will appear here.
            </p>
          )}
          {items?.map((n) => {
            const isUnread = !n.readAt;
            return (
              <button
                key={n._id}
                type="button"
                onClick={() => void openItem(n._id, n.linkTo)}
                className={`block w-full border-b border-border/70 px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-accent/60 ${
                  isUnread ? "bg-[#B68A45]/[0.06]" : ""
                }`}
              >
                <span className="flex items-start gap-2">
                  {isUnread && (
                    <span
                      className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[#B68A45]"
                      aria-hidden="true"
                    />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block text-[11px] uppercase tracking-wide text-muted-foreground">
                      {KIND_LABEL[n.kind] ?? "Notice"}
                    </span>
                    <span className="mt-0.5 block truncate text-sm font-medium">{n.title}</span>
                    {n.body && (
                      <span className="mt-0.5 block line-clamp-2 text-xs text-muted-foreground">
                        {n.body}
                      </span>
                    )}
                    <span className="mt-1 block text-[11px] text-muted-foreground">
                      {new Date(n.createdAt).toLocaleString("en-IN", {
                        timeZone: "Asia/Kolkata",
                        day: "numeric",
                        month: "short",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </span>
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Org switcher for members of more than one organisation. */
function OrgSwitcher({ onNavigate }: { onNavigate?: () => void }) {
  const orgs = useQuery(api.orgs.myOrganizations);
  const caps = useQuery(api.workspace.myCapabilities);
  const setActive = useMutation(api.orgs.setActiveOrganization);

  if (!orgs || orgs.length === 0) return null;
  const currentId = caps?.orgId ?? null;
  const current = orgs.find((o) => o.orgId === currentId) ?? orgs[0]!;
  const roleLabel = (r: string) =>
    r.replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center justify-between gap-2 rounded-md border border-sidebar-border px-3 py-2 text-left hover:bg-white/5"
          aria-label="Switch organisation"
        >
          <span className="flex min-w-0 items-center gap-2">
            <Building2 className="size-4 shrink-0 text-sidebar-primary" aria-hidden="true" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-sidebar-foreground">
                {current.name}
              </span>
              <span className="block truncate text-[11px] text-slate-400">
                {roleLabel(current.orgRole)}
              </span>
            </span>
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-slate-400" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuLabel>Your organisations</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {orgs.map((o) => (
          <DropdownMenuItem
            key={o.orgId}
            onClick={async () => {
              if (o.orgId === currentId) return;
              try {
                await setActive({ orgId: o.orgId });
                onNavigate?.();
                window.location.reload();
              } catch {
                // Suspended membership etc.; leave selection unchanged.
              }
            }}
          >
            <span className="min-w-0 flex-1 truncate">{o.name}</span>
            {o.orgId === currentId && (
              <Check className="size-4 text-[#8a6a33]" aria-hidden="true" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Discreet top-bar entry to the platform console — only for platform admins. */
function PlatformLink() {
  const amAdmin = useQuery(api.platform.amIPlatformAdmin);
  if (!amAdmin) return null;
  return (
    <NavLink
      to="/platform"
      title="Platform console"
      aria-label="Platform console"
      className="flex size-8 items-center justify-center rounded-md text-slate-500 hover:bg-muted hover:text-foreground"
    >
      <Shield className="size-4" aria-hidden="true" />
    </NavLink>
  );
}

/**
 * Authenticated desktop layout: fixed navy sidebar (~260px), top bar,
 * independently scrolling main content, responsive mobile navigation.
 */
export function ChamberShell({
  subtitle,
  title,
  actions,
  children,
}: {
  subtitle?: string;
  title?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleSignOut = async () => {
    await signOut();
    // Logout lands on the portal selector.
    navigate("/login?reason=signedout", { replace: true });
  };

  return (
    <div className="flex min-h-screen bg-background">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-card focus:px-3 focus:py-2 focus:text-sm focus:shadow"
      >
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside
        aria-label="Chamber sidebar"
        className="fixed inset-y-0 left-0 z-30 hidden w-[260px] flex-col bg-sidebar lg:flex"
      >
        <Link
          to="/"
          className="flex items-center gap-3 border-b border-sidebar-border px-5 py-5"
        >
          <span className="flex size-9 items-center justify-center rounded-md border border-sidebar-primary/40 text-sidebar-primary">
            <ScrollText className="size-4.5" aria-hidden="true" />
          </span>
          <span className="flex flex-col leading-tight">
            <span className="font-serif text-[17px] font-semibold tracking-[0.06em] text-white">
              ADVOKATE.IN
            </span>
            <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-sidebar-primary">
              The Digital Chamber
            </span>
          </span>
        </Link>
        <div className="flex-1 overflow-y-auto py-4">
          <SidebarNav />
        </div>
        <div className="space-y-3 border-t border-sidebar-border px-4 py-4">
          <OrgSwitcher />
          <div className="px-1">
            <p className="truncate text-sm font-medium text-sidebar-foreground">
              {user?.name ?? "Member"}
            </p>
            <p className="truncate text-xs text-slate-400">
              {user?.email ?? ""}
            </p>
          </div>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-h-screen w-full flex-col lg:h-screen lg:overflow-y-auto lg:pl-[260px]">
        {/* Top bar */}
        <header className="sticky top-0 z-20 border-b border-border bg-card/95 backdrop-blur-sm">
          <div className="flex h-14 items-center justify-between gap-4 px-4 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              {/* Mobile nav */}
              <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
                <SheetTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="lg:hidden"
                    aria-label="Open navigation menu"
                  >
                    <Menu className="size-5" />
                  </Button>
                </SheetTrigger>
                <SheetContent
                  side="left"
                  className="w-[260px] border-sidebar-border bg-sidebar p-0 [&>button]:text-slate-300"
                >
                  <SheetHeader className="border-b border-sidebar-border px-5 py-5 text-left">
                    <SheetTitle className="font-serif text-[17px] font-semibold tracking-[0.06em] text-white">
                      ADVOKATE.IN
                    </SheetTitle>
                    <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-sidebar-primary">
                      The Digital Chamber
                    </p>
                  </SheetHeader>
                  <div className="space-y-3 py-3">
                    <SidebarNav onNavigate={() => setMobileOpen(false)} />
                    <div className="px-3 pt-2">
                      <OrgSwitcher onNavigate={() => setMobileOpen(false)} />
                    </div>
                  </div>
                </SheetContent>
              </Sheet>

              <div className="min-w-0">
                {subtitle && (
                  <p className="type-label ink-faded leading-none">{subtitle}</p>
                )}
                {title && (
                  <h1 className="truncate font-serif text-lg font-semibold leading-tight">
                    {title}
                  </h1>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <PlatformLink />
              <NotificationBell />
              {actions}
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSignOut}
                aria-label="Sign out of the chamber"
              >
                <LogOut className="mr-1.5 size-4" aria-hidden="true" />
                <span className="hidden sm:inline">Sign out</span>
              </Button>
            </div>
          </div>
        </header>

        {/* Independently scrolling main */}
        <main
          id="main-content"
          className="flex-1 px-4 py-6 sm:px-6 lg:px-8"
        >
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
