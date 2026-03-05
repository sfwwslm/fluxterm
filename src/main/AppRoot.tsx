/**
 * 应用根组件。
 * 职责：作为前端根入口，仅挂载 AppShell。
 */
import AppShell from "@/main/AppShell";
import SubAppRoot from "@/subapps/SubAppRoot";
import { parseSubAppIdFromHash } from "@/subapps/core/lifecycle";

/** 应用根入口。 */
export default function AppRoot() {
  if (parseSubAppIdFromHash(window.location.hash)) {
    return <SubAppRoot />;
  }
  return <AppShell />;
}
