import { createFileRoute, Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { LogOut, RefreshCw } from "lucide-react";

export const Route = createFileRoute("/_app")({
  component: AppLayout,
});

const tabs = [
  { to: "/", label: "Daily Rates" },
  { to: "/history", label: "History" },
  { to: "/items", label: "Items" },
  { to: "/bills", label: "Bills" },
  { to: "/saudas", label: "Saudas" },
];

function AppLayout() {
  const loc = useLocation();
  const navigate = useNavigate();
  const [checked, setChecked] = useState(false);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      if (!data.session) {
        navigate({ to: "/auth", replace: true });
      } else {
        setSignedIn(true);
      }
      setChecked(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || !session) {
        setSignedIn(false);
        navigate({ to: "/auth", replace: true });
      } else if (event === "SIGNED_IN") {
        setSignedIn(true);
      }
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [navigate]);

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  const [syncing, setSyncing] = useState(false);
  const syncSheets = async () => {
    if (syncing) return;
    setSyncing(true);
    const tid = toast.loading("Syncing to Google Sheets…");
    try {
      const res = await fetch("/api/public/hooks/sync-sheets", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: "{}",
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      toast.success("Synced!", {
        id: tid,
        description: "Open your Google Sheet",
        action: json.spreadsheetUrl
          ? { label: "Open", onClick: () => window.open(json.spreadsheetUrl, "_blank") }
          : undefined,
      });
    } catch (e: any) {
      toast.error("Sync failed", { id: tid, description: e.message });
    } finally {
      setSyncing(false);
    }
  };

  if (!checked || !signedIn) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">
        Loading...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card sticky top-0 z-10">
        <div className="mx-auto max-w-7xl px-4 py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-lg font-bold tracking-tight">Steel Rate Manager</h1>
            <button
              onClick={signOut}
              className="sm:hidden text-muted-foreground hover:text-foreground"
              aria-label="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
          <nav className="flex gap-1 overflow-x-auto items-center">
            {tabs.map((t) => {
              const active =
                t.to === "/" ? loc.pathname === "/" : loc.pathname.startsWith(t.to);
              return (
                <Link
                  key={t.to}
                  to={t.to}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap transition-colors ${
                    active
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  {t.label}
                </Link>
              );
            })}
            <button
              onClick={syncSheets}
              disabled={syncing}
              className="ml-1 px-2 py-1.5 rounded-md text-sm text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50 inline-flex items-center gap-1"
              aria-label="Sync to Google Sheets"
              title="Sync to Google Sheets"
            >
              <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
              <span className="hidden md:inline">Sync</span>
            </button>
            <button
              onClick={signOut}
              className="hidden sm:inline-flex px-2 py-1.5 rounded-md text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">
        <Outlet />
      </main>
      <Toaster />
    </div>
  );
}
