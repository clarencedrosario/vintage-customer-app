import '@vly-ai/integrations';
import { Toaster } from "@/components/ui/sonner";
import { RequireAuth } from "@/components/RequireAuth";
import { VlyToolbar } from "../vly-toolbar-readonly.tsx";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import React, { StrictMode, useEffect, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router";
import "./index.css";

// Lazy load route components for better code splitting
const Landing = lazy(() => import("./pages/Landing.tsx"));
const LoginPage = lazy(() => import("./pages/Login.tsx"));
const FindALawyer = lazy(() => import("./pages/FindALawyer.tsx"));
const Dashboard = lazy(() => import("./pages/Dashboard.tsx"));
const Matters = lazy(() => import("./pages/Matters.tsx"));
const Conflicts = lazy(() => import("./pages/Conflicts.tsx"));
const Intake = lazy(() => import("./pages/Intake.tsx"));
const IntakeComplete = lazy(() => import("./pages/IntakeComplete.tsx"));
const CalendarPage = lazy(() => import("./pages/Calendar.tsx"));
const CourtDay = lazy(() => import("./pages/CourtDay.tsx"));
const Documents = lazy(() => import("./pages/Documents.tsx"));
const AdvokateAI = lazy(() => import("./pages/AdvokateAI.tsx"));
const Research = lazy(() => import("./pages/Research.tsx"));
const PortalAdmin = lazy(() => import("./pages/PortalAdmin.tsx"));
const Attention = lazy(() => import("./pages/Attention.tsx"));
const MatterDetail = lazy(() => import("./pages/MatterDetail.tsx"));
const Clients = lazy(() => import("./pages/Clients.tsx"));
const Client360 = lazy(() => import("./pages/Client360.tsx"));
const Billing = lazy(() => import("./pages/Billing.tsx"));
const Platform = lazy(() => import("./pages/Platform.tsx"));
const Knowledge = lazy(() => import("./pages/Knowledge.tsx"));
const Tasks = lazy(() => import("./pages/Tasks.tsx"));
const Drafts = lazy(() => import("./pages/Drafts.tsx"));
const Comms = lazy(() => import("./pages/Comms.tsx"));
const OfflineCentre = lazy(() => import("./pages/OfflineCentre.tsx"));
const Health = lazy(() => import("./pages/Health.tsx"));
const Reports = lazy(() => import("./pages/Reports.tsx"));
const Team = lazy(() => import("./pages/Team.tsx"));
const Settings = lazy(() => import("./pages/Settings.tsx"));
const ClientPortal = lazy(() => import("./pages/ClientPortal.tsx"));
const StaffPortal = lazy(() => import("./pages/StaffPortal.tsx"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));

// Simple loading fallback for route transitions
function RouteLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-pulse text-muted-foreground">Loading...</div>
    </div>
  );
}

/** Silent error boundary — if VlyToolbar crashes it renders nothing instead of
 *  crashing the whole app (e.g. hook errors in WebContainer environment). */
class ToolbarErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(err: Error) {
    console.warn("[VlyToolbar] Caught error, toolbar disabled:", err.message);
  }
  render() {
    return this.state.hasError ? null : this.props.children;
  }
}

/** Hard guard so runtime errors never leave the preview as a blank page. */
class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string; stack: string }
> {
  state = { hasError: false, message: "", stack: "" };
  static getDerivedStateFromError(error: Error) {
    return {
      hasError: true,
      message: error.message || "Unknown runtime error",
      stack: error.stack || "",
    };
  }
  componentDidCatch(err: Error) {
    console.error("[WebContainer preview] Root crash:", err);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background text-foreground p-6">
          <div className="max-w-lg text-center">
            <p className="text-sm font-semibold">Preview runtime error</p>
            <p className="mt-2 text-xs text-muted-foreground break-words">
              {this.state.message}
            </p>
            {this.state.stack && (
              <pre className="mt-3 text-left text-[10px] leading-4 text-muted-foreground/80 max-h-40 overflow-auto rounded border border-border/60 p-2">
                {this.state.stack}
              </pre>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);



function RouteSyncer() {
  const location = useLocation();
  useEffect(() => {
    window.parent.postMessage(
      { type: "iframe-route-change", path: location.pathname },
      "*",
    );
  }, [location.pathname]);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data?.type === "navigate") {
        if (event.data.direction === "back") window.history.back();
        if (event.data.direction === "forward") window.history.forward();
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  return null;
}


createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RootErrorBoundary>
      <ToolbarErrorBoundary>
        <VlyToolbar />
      </ToolbarErrorBoundary>
      <ConvexAuthProvider client={convex}>
        <BrowserRouter>
          <RouteSyncer />
          <Suspense fallback={<RouteLoading />}>
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/auth" element={<Navigate to="/login" replace />} />
              <Route path="/login" element={<LoginPage />} />              <Route
                path="/intake/complete"
                element={<IntakeComplete />}
              />
              <Route path="/find-a-lawyer" element={<FindALawyer />} />
              <Route
                path="/dashboard"
                element={
                  <RequireAuth>
                    <Dashboard />
                  </RequireAuth>
                }
              />
              <Route
                path="/attention"
                element={
                  <RequireAuth>
                    <Attention />
                  </RequireAuth>
                }
              />
              <Route
                path="/matters"
                element={
                  <RequireAuth>
                    <Matters />
                  </RequireAuth>
                }
              />
              <Route
                path="/calendar"
                element={
                  <RequireAuth>
                    <CalendarPage />
                  </RequireAuth>
                }
              />
              <Route
                path="/court-day"
                element={
                  <RequireAuth>
                    <CourtDay />
                  </RequireAuth>
                }
              />
              <Route
                path="/documents"
                element={
                  <RequireAuth>
                    <Documents />
                  </RequireAuth>
                }
              />
              <Route
                path="/ai"
                element={
                  <RequireAuth>
                    <AdvokateAI />
                  </RequireAuth>
                }
              />
              <Route
                path="/research"
                element={
                  <RequireAuth>
                    <Research />
                  </RequireAuth>
                }
              />
              <Route
                path="/portal-admin"
                element={
                  <RequireAuth>
                    <PortalAdmin />
                  </RequireAuth>
                }
              />
              <Route
                path="/conflicts"
                element={
                  <RequireAuth>
                    <Conflicts />
                  </RequireAuth>
                }
              />
              <Route
                path="/intake"
                element={
                  <RequireAuth>
                    <Intake />
                  </RequireAuth>
                }
              />
              <Route
                path="/matters/:matterId"
                element={
                  <RequireAuth>
                    <MatterDetail />
                  </RequireAuth>
                }
              />
              <Route
                path="/clients"
                element={
                  <RequireAuth>
                    <Clients />
                  </RequireAuth>
                }
              />
              <Route
                path="/clients/:clientId"
                element={
                  <RequireAuth>
                    <Client360 />
                  </RequireAuth>
                }
              />
              <Route
                path="/tasks"
                element={
                  <RequireAuth>
                    <Tasks />
                  </RequireAuth>
                }
              />
              <Route
                path="/drafts"
                element={
                  <RequireAuth>
                    <Drafts />
                  </RequireAuth>
                }
              />
              <Route
                path="/comms"
                element={
                  <RequireAuth>
                    <Comms />
                  </RequireAuth>
                }
              />
              <Route
                path="/offline"
                element={
                  <RequireAuth>
                    <OfflineCentre />
                  </RequireAuth>
                }
              />
              <Route
                path="/health"
                element={
                  <RequireAuth>
                    <Health />
                  </RequireAuth>
                }
              />
              <Route
                path="/reports"
                element={
                  <RequireAuth>
                    <Reports />
                  </RequireAuth>
                }
              />
              <Route
                path="/billing"
                element={
                  <RequireAuth>
                    <Billing />
                  </RequireAuth>
                }
              />
              <Route
                path="/platform"
                element={
                  <RequireAuth>
                    <Platform />
                  </RequireAuth>
                }
              />
              <Route
                path="/knowledge"
                element={
                  <RequireAuth>
                    <Knowledge />
                  </RequireAuth>
                }
              />
              <Route
                path="/team"
                element={
                  <RequireAuth>
                    <Team />
                  </RequireAuth>
                }
              />
              <Route
                path="/settings"
                element={
                  <RequireAuth>
                    <Settings />
                  </RequireAuth>
                }
              />
              <Route
                path="/portal"
                element={
                  <RequireAuth portal="client">
                    <ClientPortal />
                  </RequireAuth>
                }
              />
              <Route
                path="/staff"
                element={
                  <RequireAuth portal="staff">
                    <StaffPortal />
                  </RequireAuth>
                }
              />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
        <Toaster />
      </ConvexAuthProvider>
    </RootErrorBoundary>
  </StrictMode>,
);
