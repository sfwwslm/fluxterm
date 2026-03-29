import { callTauri } from "@/shared/tauri/commands";
import type { RdpInputEvent, RdpProfile, RdpSessionSnapshot } from "@/types";

/** 读取 RDP Profile 列表。 */
export function listRdpProfiles() {
  return callTauri<RdpProfile[]>("rdp_profile_list");
}

/** 读取 RDP 分组列表。 */
export function listRdpProfileGroups() {
  return callTauri<string[]>("rdp_profile_groups_list");
}

/** 保存 RDP 分组列表。 */
export function saveRdpProfileGroups(groups: string[]) {
  return callTauri<string[]>("rdp_profile_groups_save", { groups });
}

/** 保存 RDP Profile。 */
export function saveRdpProfile(profile: RdpProfile) {
  return callTauri<RdpProfile>("rdp_profile_save", { profile });
}

/** 删除 RDP Profile。 */
export function deleteRdpProfile(profileId: string) {
  return callTauri<boolean>("rdp_profile_delete", { profileId });
}

/** 创建 RDP 会话。 */
export function createRdpSession(profileId: string) {
  return callTauri<RdpSessionSnapshot>("rdp_session_create", { profileId });
}

/** 建立 RDP 会话桥接。 */
export function connectRdpSession(sessionId: string) {
  return callTauri<RdpSessionSnapshot>("rdp_session_connect", { sessionId });
}

/** 断开 RDP 会话。 */
export function disconnectRdpSession(sessionId: string) {
  return callTauri<RdpSessionSnapshot>("rdp_session_disconnect", { sessionId });
}

/** 发送 RDP 输入事件。 */
export function sendRdpInput(sessionId: string, input: RdpInputEvent) {
  return callTauri<void>("rdp_session_send_input", { sessionId, input });
}

/** 更新 RDP 分辨率。 */
export function resizeRdpSession(
  sessionId: string,
  width: number,
  height: number,
) {
  return callTauri<RdpSessionSnapshot>("rdp_session_resize", {
    sessionId,
    width,
    height,
  });
}

/** 设置 RDP 剪贴板内容。 */
export function setRdpClipboard(sessionId: string, text: string) {
  return callTauri<void>("rdp_session_set_clipboard", {
    sessionId,
    text,
  });
}

/** 响应 RDP 证书确认。 */
export function decideRdpCertificate(sessionId: string, accept: boolean) {
  return callTauri<RdpSessionSnapshot>("rdp_session_cert_decide", {
    sessionId,
    accept,
  });
}
