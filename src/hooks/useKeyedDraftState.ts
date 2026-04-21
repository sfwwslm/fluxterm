import { useState } from "react";

/**
 * 按外部 sourceKey 切换草稿源。
 * 当 sourceKey 未变化时保留本地草稿；变化后自动回落到新的初始值。
 */
export default function useKeyedDraftState(
  sourceKey: string,
  initialValue: string,
) {
  const [draft, setDraft] = useState<{
    sourceKey: string;
    value: string;
  } | null>(null);
  const value =
    draft && draft.sourceKey === sourceKey ? draft.value : initialValue;

  function updateValue(next: string) {
    setDraft({ sourceKey, value: next });
  }

  function resetValue() {
    setDraft(null);
  }

  return [value, updateValue, resetValue] as const;
}
