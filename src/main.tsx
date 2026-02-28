import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import { attachConsole } from "@tauri-apps/plugin-log";
import App from "@/App";
import { NoticesProvider } from "@/hooks/useNotices";

/**
 * 开发环境下将 Tauri 日志转发到浏览器控制台，便于联调排查。
 */
function DevLogConsoleBridge() {
  useEffect(() => {
    if (import.meta.env.DEV) {
      attachConsole();
    }
  }, []);

  return null;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <NoticesProvider>
      <DevLogConsoleBridge />
      <App />
    </NoticesProvider>
  </React.StrictMode>,
);
