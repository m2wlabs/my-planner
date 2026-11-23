import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useLocation,
  useNavigate,
} from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { Button, Icon, Layout, useFirstRunRedirect, useRunning } from "./components/ui";
import { GoalsPage, TodayPage } from "./pages/planning";
import { MoneyPage, ReportsPage } from "./pages/money";
import { FirstRunPage, SettingsPage } from "./pages/setup";
import { AiDrawer, AiPage } from "./pages/ai";
import { RoutinesPage } from "./pages/routines";
import {
  AiDrawerContext,
  captureWeeklySnapshot,
  useAutoRefreshRates,
  useSettings,
  type AiDrawerRequest,
} from "./lib/hooks";
import * as api from "./lib/api";

const rootRoute = createRootRoute({
  component: Root,
});

function Root() {
  useFirstRunRedirect();
  useAutoRefreshRates();
  const review = useWeeklyReview();
  const { running } = useRunning();
  const { pathname } = useLocation();
  const [aiOpen, setAiOpen] = useState(false);
  const [aiRequest, setAiRequest] = useState<AiDrawerRequest | null>(null);

  const openAi = useCallback((req?: AiDrawerRequest) => {
    if (req) setAiRequest(req);
    setAiOpen(true);
  }, []);
  const closeAi = useCallback(() => setAiOpen(false), []);
  const clearRequest = useCallback(() => setAiRequest(null), []);

  if (pathname === "/first-run") return <Outlet />;

  return (
    <AiDrawerContext.Provider
      value={{ open: aiOpen, request: aiRequest, openAi, closeAi, clearRequest }}
    >
      <Layout />
      {review.due && (
        <ReviewBanner
          hasTimer={Boolean(running)}
          onClose={review.close}
          onSnooze={review.snooze}
        />
      )}
      <AiDrawer />
    </AiDrawerContext.Provider>
  );
}

function ReviewBanner({
  hasTimer,
  onClose,
  onSnooze,
}: {
  hasTimer: boolean;
  onClose: () => void;
  onSnooze: () => void;
}) {
  const navigate = useNavigate();
  return (
    <div
      className={`banner${hasTimer ? " banner--raised" : ""}`}
      role="status"
    >
      <Icon name="bell" size={18} />
      <span className="banner-text">Weekly review is ready.</span>
      <Button
        size="sm"
        variant="primary"
        onClick={() => {
          navigate({ to: "/reports" });
          onClose();
        }}
      >
        Open report
      </Button>
      <Button size="sm" variant="secondary" onClick={onSnooze}>
        Snooze 1h
      </Button>
      <Button size="sm" variant="ghost" onClick={onClose} aria-label="Dismiss">
        <Icon name="x" size={14} />
      </Button>
    </div>
  );
}

function useWeeklyReview() {
  const { data: settings } = useSettings();
  const qc = useQueryClient();
  const [due, setDue] = useState(false);

  useEffect(() => {
    if (!settings || settings.review_enabled === "0") return;
    const reviewTime = settings.review_time ?? "18:00";

    const check = async () => {
      const now = new Date();
      // Weekly review fires on Sundays (getDay() === 0) at or after review_time.
      if (now.getDay() !== 0) return;
      const [h = 18, m = 0] = reviewTime.split(":").map(Number);
      const timeReached = now.getHours() > h || (now.getHours() === h && now.getMinutes() >= m);
      if (!timeReached) return;

      const snoozed = settings.snoozed_until ? new Date(settings.snoozed_until) > now : false;
      if (snoozed) return;

      const mondayIso = api.mondayOf(api.todayLocal());
      const lastSent = settings.last_review_sent ?? "";
      if (lastSent === mondayIso) return;

      // Mark sent immediately and show the in-app banner regardless of OS notification permission.
      await api.setSettings({ last_review_sent: mondayIso, snoozed_until: "" }).catch(() => {});
      qc.invalidateQueries({ queryKey: ["settings"] });
      setDue(true);

      // Best-effort native desktop notification.
      if (api.isTauriRuntime()) {
        try {
          const { isPermissionGranted, requestPermission, sendNotification } = await import(
            "@tauri-apps/plugin-notification"
          );
          let granted = await isPermissionGranted();
          if (!granted) granted = (await requestPermission()) === "granted";
          if (granted) {
            sendNotification({
              title: "Weekly review",
              body: "Your weekly report is ready. Open My Planner → Reports.",
            });
          }
        } catch {
          /* notifications unavailable */
        }
      }

      // Save this week's cleanly filtered report snapshot.
      try {
        await captureWeeklySnapshot(mondayIso);
        qc.invalidateQueries({ queryKey: ["weekly_reports"] });
      } catch {
        /* ignore */
      }
    };

    check();
    const t = setInterval(check, 60_000);
    return () => clearInterval(t);
  }, [settings, qc]);

  const snooze = async () => {
    const until = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await api.setSettings({ snoozed_until: until, last_review_sent: "" });
    qc.invalidateQueries({ queryKey: ["settings"] });
    setDue(false);
  };

  return { due, close: () => setDue(false), snooze };
}

const todayRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/today",
  component: TodayPage,
});
const goalsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/goals",
  validateSearch: (s: Record<string, unknown>): { tab?: string } =>
    typeof s.tab === "string" ? { tab: s.tab } : {},
  component: () => {
    const { tab } = goalsRoute.useSearch();
    return <GoalsPage tab={tab} />;
  },
});
const routinesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/routines",
  component: RoutinesPage,
});
const moneyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/money",
  component: MoneyPage,
});
const reportsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/reports",
  component: ReportsPage,
});
const aiRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/ai",
  component: AiPage,
});
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  validateSearch: (s: Record<string, unknown>): { section?: string } =>
    typeof s.section === "string" ? { section: s.section } : {},
  component: () => {
    const { section } = settingsRoute.useSearch();
    return <SettingsPage initialSection={section} />;
  },
});
const firstRunRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/first-run",
  component: FirstRunPage,
});
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: TodayPage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  todayRoute,
  routinesRoute,
  goalsRoute,
  moneyRoute,
  reportsRoute,
  aiRoute,
  settingsRoute,
  firstRunRoute,
]);

const router = createRouter({ routeTree, history: createHashHistory() });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

export default function App() {
  return <RouterProvider router={router} />;
}
