import type { SelectHTMLAttributes } from "react";

type SelectSize = "sm" | "md";

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  selectSize?: SelectSize;
};

function joinClassNames(...parts: Array<string | undefined | false>) {
  return parts.filter(Boolean).join(" ");
}

/** 统一下拉组件，使用原生 select 保持稳定性。 */
export default function Select({
  className,
  children,
  selectSize = "md",
  disabled,
  ...props
}: SelectProps) {
  return (
    <span
      className={joinClassNames(
        "ui-select",
        `ui-select--${selectSize}`,
        disabled && "ui-select--disabled",
      )}
    >
      <span className="ui-select-gloss" aria-hidden="true" />
      <select
        className={joinClassNames("ui-select-native", className)}
        disabled={disabled}
        {...props}
      >
        {children}
      </select>
      <span className="ui-select-arrow" aria-hidden="true">
        ▾
      </span>
    </span>
  );
}
