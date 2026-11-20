import { createRootRoute, createRoute, createRouter, RouterProvider, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@halo-ds/react";
import { Layout, useFirstRunRedirect } from "./components/ui";
import { GoalsPage, TodayPage } from "./pages/planning";
import { MoneyPage, ReportsPage } from "./pages/money";
import { FirstRunPage, SettingsPage } from "./pages/setup";
import { useSettings } from "./lib/hooks";
import * as api from "./lib/api";

const rootRoute = createRootRoute({
  component: Root,
});

function Root() {
  useFirstRunRedirect();
  const review = useWeeklyReview();
  return (
    <>
      <Layout />
      {review.due && <ReviewBanner onClose={review.close} />}
    </>
  );
}

function ReviewBanner({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const snooze = () => {
    const until = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    api.setSettings({ snoozed_until: until, last_review_sent: "" });
    onClose();
  };
  return (
    <div className="review-banner">
      <span>Weekly review is ready.</span>
      <Button size="sm" variant="primary" onClick={() => { navigate({ to: "/reports" }); onClose(); }}>Open report</Button>
      <Button size="sm" variant="secondary" onClick={snooze}>Snooze 1 hour</Button>
      <Button size="sm" variant="ghost" onClick={onClose}>Dismiss</Button>
    </div>
  );
}

function useWeeklyReview() {
  const { data: settings } = useSettings();
  const [due, setDue] = useState(false);
  useEffect(() => {
    if (!settings || settings.review_enabled === "0") return;
    const reviewTime = settings.review_time ?? "18:00";
    const check = async () => {
      const now = new Date();
      const [h, m] = reviewTime.split(":").map(Number);
      const due = now.getHours() > h || (now.getHours() === h && now.getMinutes() >= m);
      const snoozed = settings.snoozed_until ? new Date(settings.snoozed_until) > now : false;
      const lastSent = settings.last_review_sent ?? "";
      const weekKey = `${now.getFullYear()}-W${Math.floor(now.getDate() / 7)}-${now.getMonth()}`;
      if (due && !snoozed && lastSent !== weekKey) {
        try {
          const { isPermissionGranted, requestPermission, sendNotification } = await import("@tauri-apps/plugin-notification");
          let granted = await isPermissionGranted();
          if (!granted) granted = (await requestPermission()) === "granted";
          if (granted) {
            sendNotification({ title: "Weekly review", body: "Your weekly report is ready. Open My Planner → Reports." });
            await api.setSettings({ last_review_sent: weekKey });
            setDue(true);
          }
        } catch { /* notifications unavailable */ }
        // Save this week's report snapshot.
        try {
          const [tasks, entries, money] = await Promise.all([
            api.listTable("tasks"), api.listTable("time_entries"), api.listTable("money_entries"),
          ]);
          const monday = new Date(now); monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
          await api.saveWeeklyReport(monday.toISOString().slice(0, 10), { tasks, entries, money, at: now.toISOString() });
        } catch { /* ignore */ }
      }
    };
    check();
    const t = setInterval(check, 60000);
    return () => clearInterval(t);
  }, [settings]);
  return { due, close: () => setDue(false) };
}

const todayRoute = createRoute({ getParentRoute: () => rootRoute, path: "/today", component: TodayPage });
const goalsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/goals",
  validateSearch: (s: Record<string, unknown>) => ({ tab: typeof s.tab === "string" ? s.tab : undefined }),
  component: () => {
    const { tab } = goalsRoute.useSearch();
    return <GoalsPage tab={tab} />;
  },
});
const moneyRoute = createRoute({ getParentRoute: () => rootRoute, path: "/money", component: MoneyPage });
const reportsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/reports", component: ReportsPage });
const settingsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/settings", component: SettingsPage });
const firstRunRoute = createRoute({ getParentRoute: () => rootRoute, path: "/first-run", component: FirstRunPage });
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: TodayPage });

const routeTree = rootRoute.addChildren([indexRoute, todayRoute, goalsRoute, moneyRoute, reportsRoute, settingsRoute, firstRunRoute]);
const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

export default function App() {
  return <RouterProvider router={router} />;
}
