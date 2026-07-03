import { createFileRoute, Link, Outlet, useLocation } from "@tanstack/react-router";
import { Toaster } from "@/components/ui/sonner";
import { PasscodeGate } from "@/components/PasscodeGate";
import { LogOut } from "lucide-react";

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
  return (
    <PasscodeGate>
      <div className="min-h-screen bg-background">
        <header className="border-b bg-card sticky top-0 z-10">
          <div className="mx-auto max-w-7xl px-4 py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center justify-between gap-2">
              <h1 className="text-lg font-bold tracking-tight">Steel Rate Manager</h1>
              <button
                onClick={() => {
                  sessionStorage.removeItem("mbs_unlocked");
                  location.reload();
                }}
                className="sm:hidden text-muted-foreground hover:text-foreground"
                aria-label="Lock"
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
                onClick={() => {
                  sessionStorage.removeItem("mbs_unlocked");
                  location.reload();
                }}
                className="hidden sm:inline-flex ml-1 px-2 py-1.5 rounded-md text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Lock"
                title="Lock"
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
    </PasscodeGate>
  );
}

