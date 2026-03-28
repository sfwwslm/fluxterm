/**
 * 子应用窗口尺寸配置。
 *
 * 这里需要与 `src-tauri/tauri.conf.json` 中主窗口的
 * `width`、`height`、`minWidth`、`minHeight` 保持一致，
 * 避免主窗口与子应用窗口出现不一致的基础尺寸约束。
 */
export const SUBAPP_WINDOW_WIDTH = 1024;
export const SUBAPP_WINDOW_HEIGHT = 768;
export const SUBAPP_WINDOW_MIN_WIDTH = 1024;
export const SUBAPP_WINDOW_MIN_HEIGHT = 768;

/**
 * 组件浮窗尺寸配置。
 *
 * 浮窗是从主窗口拆出的辅助窗口，默认尺寸略小于主窗口，
 * 用于在视觉层级上与主窗口、子应用窗口做区分。
 */
export const FLOATING_WIDGET_WINDOW_WIDTH = 800;
export const FLOATING_WIDGET_WINDOW_HEIGHT = 600;
export const FLOATING_WIDGET_WINDOW_MIN_WIDTH = 800;
export const FLOATING_WIDGET_WINDOW_MIN_HEIGHT = 600;
