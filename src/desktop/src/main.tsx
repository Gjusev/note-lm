import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./styles/tokens.css";
import { applyTheme } from "./lib/uiState";
import { getLang } from "./i18n";
import { App } from "./App";

// Resolve the persisted theme BEFORE first paint (no flash of light theme).
applyTheme(
  (localStorage.getItem("notelm.theme") as "light" | "dark" | "system" | null) ?? "system"
);
// Same for the language: <html lang> matches the UI language from the start.
document.documentElement.lang = getLang();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: true, retry: 1, staleTime: 5_000 },
  },
});

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
);
