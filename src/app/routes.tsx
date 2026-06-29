export const APP_ROUTES = {
  home: {
    path: "/",
    label: "ホーム",
  },
} as const;

export type AppRouteKey = keyof typeof APP_ROUTES;

