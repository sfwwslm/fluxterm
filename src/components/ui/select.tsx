import { useEffect, useId, useMemo, useRef, useState } from "react";
import type React from "react";
import "./select.css";

/** 下拉菜单单个选项的元数据。 */
type SelectOption = {
  /** 选项值。 */
  value: string;
  /** 显示标签。 */
  label: string;
  /** 是否禁用该选项。 */
  disabled?: boolean;
};

/** 支持的菜单尺寸。 */
type SelectSize = "sm" | "md";

type SelectProps = {
  /** 当前选中的值。 */
  value: string | null;
  /** 选项列表。 */
  options: SelectOption[];
  /** 未选择时的占位符。 */
  placeholder?: string;
  /** 是否整体禁用。 */
  disabled?: boolean;
  /** 视觉尺寸。 */
  size?: SelectSize;
  /** 选中值变化时的回调。 */
  onChange: (value: string) => void;
  /** 无障碍访问标签。 */
  "aria-label"?: string;
};

function findFirstEnabledIndex(options: SelectOption[]) {
  return options.findIndex((option) => !option.disabled);
}

function findNextEnabledIndex(
  options: SelectOption[],
  currentIndex: number,
  direction: 1 | -1,
) {
  if (!options.length) return -1;
  let next = currentIndex;
  for (let step = 0; step < options.length; step += 1) {
    next = (next + direction + options.length) % options.length;
    if (!options[next].disabled) return next;
  }
  return -1;
}

/**
 * 通用下拉选择器组件。
 * 职责：提供基于自定义列表的 Select 交互，支持键盘导航（上下键切换、回车确认）及自动关闭策略。
 */
export default function Select({
  value,
  options,
  placeholder = "-",
  disabled,
  size = "md",
  onChange,
  "aria-label": ariaLabel,
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const selectedIndex = useMemo(
    () => options.findIndex((option) => option.value === value),
    [options, value],
  );
  const selectedLabel = useMemo(
    () => options.find((option) => option.value === value)?.label ?? null,
    [options, value],
  );

  useEffect(() => {
    if (!open) return;
    const targetIndex =
      selectedIndex >= 0 && !options[selectedIndex]?.disabled
        ? selectedIndex
        : findFirstEnabledIndex(options);
    setActiveIndex(targetIndex);
  }, [open, options, selectedIndex]);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleOutsideTouch = (event: TouchEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleWindowBlur = () => setOpen(false);
    // 使用捕获阶段，避免被 Modal 内部 stopPropagation 阻断，确保点击弹窗其它区域也能关闭下拉。
    document.addEventListener("mousedown", handleOutsideClick, true);
    document.addEventListener("touchstart", handleOutsideTouch, true);
    window.addEventListener("blur", handleWindowBlur);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick, true);
      document.removeEventListener("touchstart", handleOutsideTouch, true);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, []);

  function handleToggle() {
    if (disabled) return;
    setOpen((prev) => !prev);
  }

  function handleSelect(option: SelectOption) {
    if (option.disabled) return;
    onChange(option.value);
    setOpen(false);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setActiveIndex((prev) => findNextEnabledIndex(options, prev, 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setActiveIndex((prev) => findNextEnabledIndex(options, prev, -1));
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const option = options[activeIndex];
      if (option && !option.disabled) {
        handleSelect(option);
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div
      className={`select-menu select-menu--${size} ${disabled ? "is-disabled" : ""}`}
      ref={rootRef}
    >
      <button
        type="button"
        className="select-menu-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel}
        onClick={handleToggle}
        onKeyDown={handleKeyDown}
        disabled={disabled}
      >
        <span
          className={`select-menu-value ${selectedLabel ? "" : "is-placeholder"}`}
        >
          {selectedLabel ?? placeholder}
        </span>
        <span className="select-menu-arrow" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div className="select-menu-list" role="listbox" id={listId}>
          {options.map((option, index) => {
            const isSelected = option.value === value;
            const isActive = index === activeIndex;
            return (
              <button
                type="button"
                key={option.value}
                role="option"
                aria-selected={isSelected}
                className={`select-menu-option ${isSelected ? "is-selected" : ""} ${isActive ? "is-active" : ""}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => handleSelect(option)}
                disabled={option.disabled}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
