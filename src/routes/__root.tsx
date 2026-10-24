import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";
import {
  LayoutDashboard,
  Settings2,
  Bot,
  Zap,
  Moon,
  Sun,
  Menu,
  X,
  Activity,
  List,
} from "lucide-react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";

function NotFoundComponent() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="max-w-md text-center slide-up">
        <p className="text-8xl font-mono font-bold text-primary/20">404</p>
        <h1 className="mt-4 text-2xl font-display">Page not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">This page doesn&apos;t exist.</p>
        <Link
          to="/"
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-lg shadow-primary/25 hover:shadow-primary/40 transition-all hover:scale-[1.02]"
        >
          Go to dashboard
        </Link>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="max-w-md text-center slide-up">
        <div className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
          <Zap className="size-8" />
        </div>
        <h1 className="mt-4 text-2xl font-display">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {error instanceof Error ? error.message : "Unknown error"}
        </p>
        <button
          onClick={() => { router.invalidate(); reset(); }}
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-lg shadow-primary/25 transition-all hover:scale-[1.02]"
        >
          Try again
        </button>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "GuestPilot — AI Guest Post Agent" },
      { name: "description", content: "Automated guest post campaign management with AI." },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Instrument+Serif&family=Manrope:wght@400;500;600;700&family=JetBrains+Mono&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { to: "/campaigns", label: "Campaigns", icon: List, exact: false },
  { to: "/backlinks", label: "Backlinks", icon: Activity, exact: false },
  { to: "/settings", label: "Settings", icon: Settings2, exact: false },
] as const;

function useDarkMode() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    // Read saved preference or system preference
    const saved = localStorage.getItem("theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const isDark = saved === "dark" || (!saved && prefersDark);
    setDark(isDark);
    document.documentElement.classList.toggle("dark", isDark);
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  };
  return { dark, toggle };
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const { dark, toggle } = useDarkMode();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <QueryClientProvider client={queryClient}>
      <div className="flex min-h-screen bg-background">

        {/* ── Sidebar (desktop) ── */}
        <aside className="hidden lg:flex w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
          <SidebarContent dark={dark} onToggleDark={toggle} />
        </aside>

        {/* ── Mobile sidebar overlay ── */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}
        <aside
          className={`fixed inset-y-0 left-0 z-50 w-64 flex flex-col border-r border-sidebar-border bg-sidebar transition-transform duration-300 lg:hidden ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}
        >
          <SidebarContent dark={dark} onToggleDark={toggle} onClose={() => setSidebarOpen(false)} />
        </aside>

        {/* ── Main content ── */}
        <div className="flex flex-1 flex-col min-w-0">
          {/* Mobile top bar */}
          <header className="flex lg:hidden items-center gap-3 border-b border-border bg-background/80 backdrop-blur px-4 py-3 sticky top-0 z-30">
            <button
              onClick={() => setSidebarOpen(true)}
              className="rounded-lg p-1.5 hover:bg-muted transition-colors"
            >
              <Menu className="size-5" />
            </button>
            <div className="flex items-center gap-2">
              <div className="flex size-7 items-center justify-center rounded-lg agent-gradient text-white text-xs font-bold">
                G
              </div>
              <span className="font-display text-lg">GuestPilot</span>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={toggle}
                className="rounded-lg p-1.5 hover:bg-muted transition-colors text-muted-foreground"
              >
                {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
              </button>
            </div>
          </header>

          <main className="flex-1 overflow-y-auto">
            <Outlet />
          </main>
        </div>
      </div>
      <Toaster richColors position="bottom-right" />
    </QueryClientProvider>
  );
}

function SidebarContent({
  dark,
  onToggleDark,
  onClose,
}: {
  dark: boolean;
  onToggleDark: () => void;
  onClose?: () => void;
}) {
  return (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-sidebar-border">
        <div className="flex size-9 items-center justify-center rounded-xl agent-gradient shadow-lg shadow-primary/30">
          <Bot className="size-5 text-white" />
        </div>
        <div>
          <p className="font-display text-lg leading-none">GuestPilot</p>
          <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">AI Agent v1.0</p>
        </div>
        {onClose && (
          <button onClick={onClose} className="ml-auto rounded-lg p-1 hover:bg-muted transition-colors">
            <X className="size-4" />
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        <p className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
          Navigation
        </p>
        {NAV.map((n) => (
          <Link
            key={n.to}
            to={n.to}
            activeOptions={{ exact: n.exact }}
            onClick={onClose}
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-muted-foreground transition-all hover:bg-accent hover:text-accent-foreground"
            activeProps={{
              className:
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm bg-primary/10 text-primary font-medium shadow-sm",
            }}
          >
            <n.icon className="size-4 shrink-0" />
            {n.label}
          </Link>
        ))}
      </nav>

      {/* Bottom: agent status + theme toggle */}
      <div className="px-3 py-4 border-t border-sidebar-border space-y-2">
        {/* Agent status pill */}
        <div className="flex items-center gap-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-3 py-2.5">
          <div className="relative flex size-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400 truncate">Agent Active</p>
            <p className="text-[10px] text-muted-foreground truncate font-mono">GuestPilot running</p>
          </div>
        </div>

        {/* Theme + activity row */}
        <div className="flex items-center gap-2">
          <button
            onClick={onToggleDark}
            className="flex flex-1 items-center gap-2 rounded-xl px-3 py-2 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            {dark ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
            {dark ? "Light mode" : "Dark mode"}
          </button>
          <Link
            to="/settings"
            className="rounded-xl p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            title="Activity"
          >
            <Activity className="size-3.5" />
          </Link>
        </div>
      </div>
    </div>
  );
}
