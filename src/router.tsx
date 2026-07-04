import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { persistQueryClient } from "@tanstack/react-query-persist-client";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Keep cached data long enough to survive offline reloads.
        gcTime: 1000 * 60 * 60 * 24 * 7, // 7 days
        staleTime: 1000 * 30,
        retry: 1,
        refetchOnReconnect: true,
      },
    },
  });

  // Persist the query cache to localStorage so the last-viewed data
  // is available offline after a reload. SSR-safe: window guard.
  if (typeof window !== "undefined") {
    const persister = createSyncStoragePersister({
      storage: window.localStorage,
      key: "mbs-query-cache-v1",
    });
    persistQueryClient({
      queryClient,
      persister,
      maxAge: 1000 * 60 * 60 * 24 * 7,
    });
  }

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
