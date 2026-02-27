/**
 * 应用根组件。
 * 职责：作为前端根入口，仅挂载 AppShell。
 */
import AppShell from "@/app/AppShell";

/** 应用根入口。 */
export default function AppRoot() {
  return <AppShell />;
}
