import {
  createRootRoute,
  createRoute,
  createRouter,
  Navigate,
  Outlet,
} from "@tanstack/react-router";
import { App } from "@/App";
import { SessionsPage } from "@/routes/sessions";
import { SessionDetailPage } from "@/routes/sessions/session";
import { NewSessionPage } from "@/routes/sessions/new";
import { SettingsPage } from "@/routes/settings";

const rootRoute = createRootRoute({
  component: App,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: () => <Navigate to="/sessions" replace />,
});

const sessionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sessions",
  component: SessionsPage,
});

const sessionsIndexRoute = createRoute({
  getParentRoute: () => sessionsRoute,
  path: "/",
  component: () => null,
});

const sessionDetailRoute = createRoute({
  getParentRoute: () => sessionsRoute,
  path: "$sessionId",
  component: SessionDetailPage,
});

const newSessionRoute = createRoute({
  getParentRoute: () => sessionsRoute,
  path: "new",
  component: NewSessionPage,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsPage,
});

export const routeTree = rootRoute.addChildren([
  indexRoute,
  sessionsRoute.addChildren([
    sessionsIndexRoute,
    newSessionRoute,
    sessionDetailRoute,
  ]),
  settingsRoute,
]);

export function createAppRouter() {
  return createRouter({
    routeTree,
    scrollRestoration: true,
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

declare module "@tanstack/react-router" {
  interface Register {
    router: AppRouter;
  }
}
