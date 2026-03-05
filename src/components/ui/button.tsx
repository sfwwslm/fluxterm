import type { ButtonHTMLAttributes } from "react";
import "./button.css";

/** 按钮支持的视觉变体。 */
type ButtonVariant = "default" | "primary" | "ghost" | "danger";
/** 按钮支持的预设尺寸。 */
type ButtonSize = "sm" | "md" | "icon";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** 视觉风格。 */
  variant?: ButtonVariant;
  /** 尺寸。 */
  size?: ButtonSize;
};

function joinClassNames(...parts: Array<string | undefined | false>) {
  return parts.filter(Boolean).join(" ");
}

/**
 * 统一按钮组件。
 * 职责：作为应用内的通用交互触发点，提供符合设计规范的玻璃拟态视觉反馈。
 */
export default function Button({
  className,
  variant = "default",
  size = "md",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={joinClassNames(
        "ui-button",
        `ui-button--${variant}`,
        `ui-button--${size}`,
        className,
      )}
      {...props}
    />
  );
}
