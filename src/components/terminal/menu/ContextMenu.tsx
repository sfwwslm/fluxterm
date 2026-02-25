type ContextMenuItem = {
  label: string;
  disabled: boolean;
  onClick: () => void;
};

type ContextMenuProps = {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
};

/** 通用右键菜单组件。 */
export default function ContextMenu({
  x,
  y,
  items,
  onClose,
}: ContextMenuProps) {
  return (
    <div className="context-menu-overlay" onMouseDown={onClose}>
      <div
        className="context-menu"
        style={{ top: y, left: x }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {items.map((item) => (
          <button
            key={item.label}
            disabled={item.disabled}
            onClick={item.onClick}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}
