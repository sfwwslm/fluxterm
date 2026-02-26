import { useEffect, useId, useMemo, useRef, useState } from "react";
import type React from "react";

type SelectMenuOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

type SelectMenuSize = "sm" | "md";

type SelectMenuProps = {
  value: string | null;
  options: SelectMenuOption[];
  placeholder?: string;
  disabled?: boolean;
  size?: SelectMenuSize;
  onChange: (value: string) => void;
  "aria-label"?: string;
};

function findFirstEnabledIndex(options: SelectMenuOption[]) {
  return options.findIndex((option) => !option.disabled);
}

function findNextEnabledIndex(
  options: SelectMenuOption[],
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

/** 通用下拉菜单组件（自定义列表，支持键盘与玻璃拟态样式）。 */
export default function SelectMenu({
  value,
  options,
  placeholder = "-",
  disabled,
  size = "md",
  onChange,
  "aria-label": ariaLabel,
}: SelectMenuProps) {
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
    const handleWindowBlur = () => setOpen(false);
    document.addEventListener("mousedown", handleOutsideClick);
    window.addEventListener("blur", handleWindowBlur);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, []);

  function handleToggle() {
    if (disabled) return;
    setOpen((prev) => !prev);
  }

  function handleSelect(option: SelectMenuOption) {
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
