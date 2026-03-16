import type React from "react";
import Button from "@/components/ui/button";
import "./Modal.css";

/**
 * 通用模态框组件。
 * 职责：提供一个居中的对话框容器，包含标题栏、内容区和可选的操作按钮区。
 * 交互：支持点击遮罩层关闭，内容区具有独立滚动条。
 */
type ModalProps = {
  /** 是否打开模态框。 */
  open: boolean;
  /** 是否显示整个模态框的忙碌态遮盖。 */
  busy?: boolean;
  /** 忙碌态遮盖层内容。 */
  busyOverlay?: React.ReactNode;
  /** 模态框标题。 */
  title: string;
  /** 底部操作按钮区的 React 节点。 */
  actions?: React.ReactNode;
  /** 关闭按钮的文本标签。 */
  closeLabel: string;
  /** 内容区的额外类名。 */
  bodyClassName?: string;
  /** 点击关闭按钮或遮罩层时的回调函数。 */
  onClose: () => void;
  /** 模态框主体内容。 */
  children: React.ReactNode;
};

/** 渲染标准模态对话框。 */
export default function Modal({
  open,
  busy = false,
  busyOverlay,
  title,
  actions,
  closeLabel,
  bodyClassName,
  onClose,
  children,
}: ModalProps) {
  if (!open) return null;
  return (
    <div className="modal-overlay" onMouseDown={busy ? undefined : onClose}>
      <div className="modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <span>{title}</span>
          <Button className="ghost" variant="ghost" size="sm" onClick={onClose}>
            {closeLabel}
          </Button>
        </div>
        <div className={`modal-body ${bodyClassName ?? ""}`.trim()}>
          {children}
        </div>
        {actions && <div className="modal-actions">{actions}</div>}
        {busy && busyOverlay ? (
          // busy overlay 直接覆盖整个 modal，而不是只禁用局部区域，
          // 避免关键流程中出现“看起来还能点、实际上不应再点”的假可用状态。
          <div className="modal-busy-overlay" role="status" aria-live="polite">
            {busyOverlay}
          </div>
        ) : null}
      </div>
    </div>
  );
}
