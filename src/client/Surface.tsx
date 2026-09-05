import {
  useEffect,
  useId,
  useRef,
  type FormEventHandler,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { attachTerminalViewport } from "./terminal-viewport";

interface TaskSurfaceProps {
  title: string;
  context?: string;
  description?: string;
  className?: string;
  busy?: boolean;
  fitViewport?: boolean;
  activity?: ReactNode;
  initialFocusRef?: RefObject<HTMLElement | null>;
  actions: ReactNode;
  onClose(): void;
  onSubmit?: FormEventHandler<HTMLFormElement>;
  children: ReactNode;
}

/** A focused workflow: a restrained panel on desktop and a full-screen view on mobile. */
export function TaskSurface({
  title,
  context,
  description,
  className = "",
  busy = false,
  fitViewport = false,
  activity,
  initialFocusRef,
  actions,
  onClose,
  onSubmit,
  children,
}: TaskSurfaceProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const element = dialog.current!;
    const detach = fitViewport ? attachTerminalViewport(element) : undefined;
    element.showModal();
    initialFocusRef?.current?.focus({ preventScroll: true });
    return () => { detach?.(); element.close(); };
  }, []);

  const content = (
    <>
      <header className={`surface-header${activity ? " active" : ""}`}>
        {activity && <div className="surface-activity">{activity}</div>}
        <div className="surface-header-inner">
          <button
            className="surface-back"
            type="button"
            aria-label="Go back"
            disabled={busy}
            onClick={onClose}
          >
            <BackIcon />
          </button>
          <div className="surface-heading">
            {context && <span className="surface-context">{context}</span>}
            <h2 id={titleId}>{title}</h2>
            {description && <p>{description}</p>}
          </div>
        </div>
      </header>
      <div className="surface-body">
        <div className="surface-body-inner">{children}</div>
      </div>
      <footer className="surface-footer">
        <div className="surface-footer-inner">{actions}</div>
      </footer>
    </>
  );

  return createPortal(
    <dialog
      ref={dialog}
      className={`task-surface ${className}`.trim()}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      {onSubmit
        ? <form className="surface-layout" onSubmit={onSubmit}>{content}</form>
        : <div className="surface-layout">{content}</div>}
    </dialog>,
    document.body,
  );
}

interface ConfirmSurfaceProps {
  title: string;
  message: string;
  confirmLabel: string;
  pendingLabel?: string;
  error?: string;
  busy?: boolean;
  tone?: "neutral" | "destructive";
  onClose(): void;
  onConfirm(): void;
}

/** A deliberately narrow decision surface with no arbitrary content layout. */
export function ConfirmSurface({
  title,
  message,
  confirmLabel,
  pendingLabel = "Working…",
  error,
  busy = false,
  tone = "neutral",
  onClose,
  onConfirm,
}: ConfirmSurfaceProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);

  return createPortal(
    <dialog
      ref={dialog}
      className="confirm-surface"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="confirm-handle" aria-hidden="true" />
      <div className="confirm-copy">
        <h2 id={titleId}>{title}</h2>
        <p>{message}</p>
        {error && <p className="surface-error">{error}</p>}
      </div>
      <footer className="surface-footer">
        <button className="surface-button secondary" type="button" disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button
          className={`surface-button ${tone === "destructive" ? "destructive" : "primary"}`}
          type="button"
          disabled={busy}
          onClick={onConfirm}
        >
          {busy ? pendingLabel : confirmLabel}
        </button>
      </footer>
    </dialog>,
    document.body,
  );
}

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m14.5 5-7 7 7 7" />
    </svg>
  );
}
