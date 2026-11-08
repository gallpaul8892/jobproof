import { useEffect, useId, useRef, type ReactNode } from "react";

/** A modal confirmation on the native <dialog>: focus moves in, Escape cancels, focus returns on close. */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
  testId,
}: {
  open: boolean;
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  testId: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    } else if (!open && dialog.open) {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    }
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="confirm"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      data-testid={testId}
    >
      <h2 id={titleId}>{title}</h2>
      {children}
      <div className="form-actions">
        <button type="button" className="btn btn-primary" data-testid={`${testId}-confirm`} onClick={onConfirm}>
          {confirmLabel}
        </button>
        <button type="button" className="btn" data-testid={`${testId}-cancel`} onClick={onCancel} autoFocus>
          {cancelLabel}
        </button>
      </div>
    </dialog>
  );
}
