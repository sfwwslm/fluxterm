import React from "react";
import ReactDOM from "react-dom/client";
import { attachConsole } from "@tauri-apps/plugin-log";
import App from "@/App";
import { NoticesProvider } from "@/components/providers/NoticesProvider";

if (import.meta.env.DEV) {
  void attachConsole();
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <NoticesProvider>
      <App />
    </NoticesProvider>
  </React.StrictMode>,
);
