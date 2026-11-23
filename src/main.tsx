import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@halo-ds/react";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import MenuScrollbars from "./components/MenuScrollbars";
import "@halo-ds/react/styles.css";
import "./index.css";

const qc = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={qc}>
        <ToastProvider position="top-right" limit={4} styles={{ root: { top: 56 } }}>
          <MenuScrollbars />
          <App />
        </ToastProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
