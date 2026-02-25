import { useRef, useState } from "react";
import { createPortal } from "react-dom";

type TooltipPlacement = "top" | "bottom" | "left" | "right";

type TooltipProps = {
  content: string;
  children: React.ReactNode;
  placement?: TooltipPlacement;
  offset?: number;
};

/** 全局 Tooltip 组件，用于展示悬浮提示并避免父级溢出裁剪。 */
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
