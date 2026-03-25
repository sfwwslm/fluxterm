/**
 * 终端主题编译器。
 * 职责：把主题预设中的终端 token 转换为 xterm 可直接消费的对象。
 */
import type { ThemePreset } from "@/main/theme/themeContracts";

/** xterm 可直接消费的终端主题对象。 */
export type ResolvedTerminalTheme = {
  /** 终端背景色。 */
  background: string;
  /** 终端前景色。 */
  foreground: string;
  /** 选区背景色。 */
  selectionBackground: string;
  /** 选区前景色。 */
  selectionForeground: string;
  /** 光标主色。 */
  cursor: string;
  /** 光标对比色。 */
  cursorAccent: string;
  /** ANSI 黑色。 */
  black: string;
  /** ANSI 红色。 */
  red: string;
  /** ANSI 绿色。 */
  green: string;
  /** ANSI 黄色。 */
  yellow: string;
  /** ANSI 蓝色。 */
  blue: string;
  /** ANSI 品红。 */
  magenta: string;
  /** ANSI 青色。 */
  cyan: string;
  /** ANSI 白色。 */
  white: string;
  /** ANSI 亮黑。 */
  brightBlack: string;
  /** ANSI 亮红。 */
  brightRed: string;
  /** ANSI 亮绿。 */
  brightGreen: string;
  /** ANSI 亮黄。 */
  brightYellow: string;
  /** ANSI 亮蓝。 */
  brightBlue: string;
  /** ANSI 亮品红。 */
  brightMagenta: string;
  /** ANSI 亮青。 */
  brightCyan: string;
  /** ANSI 亮白。 */
  brightWhite: string;
};

/** 终端主题编译选项。 */
type BuildTerminalThemeOptions = {
  /** 是否输出透明背景。 */
  translucentBackground?: boolean;
  /** 透明背景 alpha。 */
  translucentBackgroundAlpha?: number;
  /** 透明模式下使用的基底颜色。 */
  translucentBackgroundBase?: string;
};

/**
 * 把十六进制颜色转为带透明度的 rgba。
 * 仅处理 #rgb / #rrggbb，其他格式直接回退原值。
 */
function withAlpha(color: string, alpha: number) {
  const normalized = color.trim();
  const shortHex = /^#([0-9a-fA-F]{3})$/;
  const longHex = /^#([0-9a-fA-F]{6})$/;
  const rgbLike =
    /^rgba?\(\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})(?:\s*,\s*(?:[0-9]*\.?[0-9]+))?\s*\)$/i;
  if (shortHex.test(normalized)) {
    const [, raw] = shortHex.exec(normalized) ?? [];
    if (!raw) return color;
    const [r, g, b] = raw.split("").map((char) => char + char);
    return `rgba(${parseInt(r, 16)}, ${parseInt(g, 16)}, ${parseInt(b, 16)}, ${alpha})`;
  }
  if (longHex.test(normalized)) {
    const [, raw] = longHex.exec(normalized) ?? [];
    if (!raw) return color;
    const r = raw.slice(0, 2);
    const g = raw.slice(2, 4);
    const b = raw.slice(4, 6);
    return `rgba(${parseInt(r, 16)}, ${parseInt(g, 16)}, ${parseInt(b, 16)}, ${alpha})`;
  }
  if (rgbLike.test(normalized)) {
    const [, r, g, b] = rgbLike.exec(normalized) ?? [];
    if (!r || !g || !b) return color;
    return `rgba(${Number(r)}, ${Number(g)}, ${Number(b)}, ${alpha})`;
  }
  return color;
}

/**
 * 从主题定义生成 xterm 主题对象。
 * 该函数负责展开 ANSI 色板，并根据选项输出透明或不透明终端背景。
 */
export function buildTerminalTheme(
  theme: ThemePreset,
  options: BuildTerminalThemeOptions = {},
): ResolvedTerminalTheme {
  const alpha = options.translucentBackgroundAlpha ?? 0.52;
  const translucentBase =
    options.translucentBackgroundBase ?? theme.terminal.background;
  const background = options.translucentBackground
    ? withAlpha(translucentBase, alpha)
    : theme.terminal.background;
  return {
    background,
    foreground: theme.terminal.foreground,
    selectionBackground: theme.terminal.selectionBackground,
    selectionForeground: theme.terminal.selectionForeground,
    cursor: theme.terminal.cursor,
    cursorAccent: theme.terminal.cursorAccent,
    black: theme.terminal.ansi.black,
    red: theme.terminal.ansi.red,
    green: theme.terminal.ansi.green,
    yellow: theme.terminal.ansi.yellow,
    blue: theme.terminal.ansi.blue,
    magenta: theme.terminal.ansi.magenta,
    cyan: theme.terminal.ansi.cyan,
    white: theme.terminal.ansi.white,
    brightBlack: theme.terminal.ansi.brightBlack,
    brightRed: theme.terminal.ansi.brightRed,
    brightGreen: theme.terminal.ansi.brightGreen,
    brightYellow: theme.terminal.ansi.brightYellow,
    brightBlue: theme.terminal.ansi.brightBlue,
    brightMagenta: theme.terminal.ansi.brightMagenta,
    brightCyan: theme.terminal.ansi.brightCyan,
    brightWhite: theme.terminal.ansi.brightWhite,
  };
}
