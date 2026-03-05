import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./Tooltip.css";

/** Tooltip 弹出的方向预设。 */
type TooltipPlacement = "top" | "bottom" | "left" | "right";

type TooltipProps = {
  /** 提示内容文本。 */
  content: string;
  /** 触发 Tooltip 的子元素。 */
  children: React.ReactNode;
  /** 弹出方向，默认为 "top"。 */
  placement?: TooltipPlacement;
  /** 气泡与目标元素之间的间距（像素），默认为 8。 */
  offset?: number;
};

/**
 * 全局 Tooltip 悬浮提示组件。
 * 职责：展示简短的辅助信息。
 * 交互：通过 createPortal 将气泡挂载到 body 下，确保气泡在复杂的层级（如 Overflow: hidden 容器）中仍能完整显示。
 */
export default function Tooltip({
  content,
  children,
  placement = "top",
  offset = 8,
}: TooltipProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const targetRef = useRef<HTMLSpanElement | null>(null);

  function updatePosition() {
    const target = targetRef.current;
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    switch (placement) {
      case "bottom":
        setPosition({ left: centerX, top: rect.bottom + offset });
        break;
      case "left":
        setPosition({ left: rect.left - offset, top: centerY });
        break;
      case "right":
        setPosition({ left: rect.right + offset, top: centerY });
        break;
      default:
        setPosition({ left: centerX, top: rect.top - offset });
        break;
    }
  }

  function handleShow() {
    updatePosition();
    setOpen(true);
  }

  function handleHide() {
    setOpen(false);
  }

  return (
    <>
      <span
        className="tooltip-target"
        ref={targetRef}
        onMouseEnter={handleShow}
        onMouseLeave={handleHide}
        onFocus={handleShow}
        onBlur={handleHide}
      >
        {children}
      </span>
      {open &&
        createPortal(
          <div className="tooltip-layer">
            <div
              className="tooltip-bubble"
              data-placement={placement}
              style={{ left: position.left, top: position.top }}
              role="tooltip"
            >
              {content}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
