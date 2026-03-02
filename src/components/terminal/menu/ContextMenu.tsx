import { useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import "./ContextMenu.css";

export type ContextMenuItem = {
  id?: string;
  label: string;
  disabled?: boolean;
  icon?: ReactNode | null;
  danger?: boolean;
  onClick: () => void;
};

type ContextMenuProps = {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
};

const VIEWPORT_GAP = 8;

/** 通用右键菜单组件。 */
export default function ContextMenu({
  x,
  y,
  items,
  onClose,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({ x, y });

  useLayoutEffect(() => {
    setPosition({ x, y });
  }, [x, y]);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;

    const rect = menu.getBoundingClientRect();
    const maxLeft = Math.max(
      VIEWPORT_GAP,
      window.innerWidth - rect.width - VIEWPORT_GAP,
    );
    const maxTop = Math.max(
      VIEWPORT_GAP,
      window.innerHeight - rect.height - VIEWPORT_GAP,
    );

    const nextX = Math.min(Math.max(x, VIEWPORT_GAP), maxLeft);
    const nextY = Math.min(Math.max(y, VIEWPORT_GAP), maxTop);

    if (nextX === position.x && nextY === position.y) return;
    setPosition({ x: nextX, y: nextY });
  }, [x, y, items, position.x, position.y]);

  return (
    <div className="context-menu-overlay" onMouseDown={onClose}>
      <div
        ref={menuRef}
        className="context-menu"
        style={{ top: position.y, left: position.x }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {items.map((item) => (
          <button
            key={item.id ?? item.label}
            className={item.danger ? "danger" : ""}
            disabled={item.disabled}
            onClick={item.onClick}
          >
            <span className="context-menu-icon" aria-hidden="true">
              {item.icon ?? null}
            </span>
            <span className="context-menu-label">{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
