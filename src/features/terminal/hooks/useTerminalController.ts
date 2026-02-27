/**
 * 终端控制器 Hook。
 * 职责：对外暴露分组后的终端查询与操作接口。
 */
import useTerminalRuntimeCore from "@/features/terminal/hooks/useTerminalRuntimeCore";

/**
 * 终端控制器入口。
 * 目前先兼容复用原 useTerminalRuntime，后续逐步拆分 xterm/gutter/search 子模块。
 */
export default function useTerminalController(
  props: Parameters<typeof useTerminalRuntimeCore>[0],
) {
  const raw = useTerminalRuntimeCore(props);

  return {
    terminalQuery: {
      isTerminalReady: raw.isTerminalReady,
      getTerminalSize: raw.getTerminalSize,
      hasActiveSelection: raw.hasActiveSelection,
    },
    terminalActions: {
      registerTerminalContainer: raw.registerTerminalContainer,
      copyActiveSelection: raw.copyActiveSelection,
      pasteToActiveTerminal: raw.pasteToActiveTerminal,
      clearActiveTerminal: raw.clearActiveTerminal,
      searchActiveTerminalNext: raw.searchActiveTerminalNext,
      searchActiveTerminalPrev: raw.searchActiveTerminalPrev,
    },
  };
}
