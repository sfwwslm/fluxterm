import React from "react";
import ReactDOM from "react-dom/client";
import App from "@/App";
import { NoticesProvider } from "@/hooks/useNotices";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <NoticesProvider>
      <App />
    </NoticesProvider>
  </React.StrictMode>,
);
