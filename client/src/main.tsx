import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./theme.css";

const rootEl = document.querySelector<HTMLElement>("[data-generated-space-root]");
if (!rootEl) {
  throw new Error("missing generated space root element");
}

const queryClient = new QueryClient();

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <div className="tuner-root">
        <App />
      </div>
    </QueryClientProvider>
  </StrictMode>,
);
