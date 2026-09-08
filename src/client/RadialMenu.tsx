import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { angleDelta, clampOffset, radialArc, radialPoint, radialWindow, RADIAL_CENTER, RADIAL_STEP, RADIAL_VISIBLE } from "./radial-scroll";
import { advanceMotion, dragOrigin, releaseMotion, rubberBandOffset } from "./radial-motion";

export interface RadialOption {
  id: string;
  label: string;
  detail?: string;
  disabled?: boolean;
}

/** A finite list on a quarter-circle. Callers own the workflow, this menu owns input and focus. */
export function RadialMenu({
  title, description, options, emptyMessage = "No options available", preferredId,
  initialOffset = 0, animateEntry = false, onOffsetChange, onSelect, onClose, onBack,
}: {
  title: string;
  description?: string;
  options: readonly RadialOption[];
  emptyMessage?: string;
  preferredId?: string;
  initialOffset?: number;
  animateEntry?: boolean;
  onOffsetChange?(offset: number): void;
  onSelect(id: string): void;
  onClose(): void;
  onBack?(): void;
}) {
  const preferredIndex = options.findIndex(option => option.id === preferredId);
  const [rawOffset, setOffset] = useState(() => clampOffset(preferredIndex >= 0 ? preferredIndex - 1 : initialOffset, options.length));
  const offset = clampOffset(rawOffset, options.length);
  const maximum = Math.max(0, options.length - RADIAL_VISIBLE);
  const dialog = useRef<HTMLDialogElement>(null);
  const panel = useRef<HTMLElement>(null);
  const [presence, setPresence] = useState<"entering" | "open" | "leaving">("entering");
  const [dismissing, setDismissing] = useState(false);
  const pendingLeave = useRef<(() => void) | undefined>(undefined);
  const leaveTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const wheel = useRef<HTMLDivElement>(null);
  const offsetRef = useRef(rawOffset);
  const animation = useRef<number | undefined>(undefined);
  const reducedMotion = useRef(false);
  const [motion, setMotion] = useState<"idle" | "dragging" | "settling">("idle");
  const drag = useRef<{
    id: number; angle: number; x: number; y: number; moved: boolean;
    position: number; velocity: number; time: number; caught: boolean;
  } | undefined>(undefined);
  const suppressClick = useRef(false);
  const optionsId = useId();
  const helpId = useId();
  const preferenceApplied = useRef(preferredIndex >= 0);

  useEffect(() => {
    if (preferredIndex < 0 || preferenceApplied.current) return;
    preferenceApplied.current = true;
    scrollTo(preferredIndex - 1);
  }, [preferredIndex]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current!;
    element.showModal();
    wheel.current?.focus();
    return () => {
      if (animation.current !== undefined) cancelAnimationFrame(animation.current);
      clearTimeout(leaveTimeout.current);
      pendingLeave.current = undefined;
      element.close();
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  function finishEntry() {
    if (!pendingLeave.current) setPresence("open");
  }

  function finishLeave() {
    const next = pendingLeave.current;
    pendingLeave.current = undefined;
    clearTimeout(leaveTimeout.current);
    next?.();
  }

  /** Keep the modal mounted and inert until its exit finishes. Accept only one action. */
  function leave(next: () => void, dismiss = false) {
    if (pendingLeave.current) return;
    pendingLeave.current = next;
    drag.current = undefined;
    stopMotion();
    if (reducedMotion.current || document.hidden) { finishLeave(); return; }
    panel.current?.style.setProperty("--menu-exit-opacity", getComputedStyle(panel.current).opacity);
    setDismissing(dismiss);
    setPresence("leaving");
    // Also complete if an animation is cancelled or the browser drops its end event.
    leaveTimeout.current = setTimeout(finishLeave, 180);
  }

  function paint(position: number) {
    offsetRef.current = position;
    setOffset(position);
  }

  function stopMotion() {
    if (animation.current !== undefined) cancelAnimationFrame(animation.current);
    animation.current = undefined;
    setMotion("idle");
    onOffsetChange?.(clampOffset(offsetRef.current, options.length));
  }

  function scrollTo(next: number) {
    stopMotion();
    const bounded = clampOffset(next, options.length);
    paint(bounded);
    onOffsetChange?.(bounded);
  }

  function settle(velocity = 0) {
    stopMotion();
    if (reducedMotion.current || options.length <= RADIAL_VISIBLE) {
      scrollTo(Math.round(offsetRef.current));
      return;
    }
    let next = releaseMotion(offsetRef.current, velocity, options.length);
    let previous = performance.now();
    setMotion("settling");
    const frame = (now: number) => {
      next = advanceMotion(next, (now - previous) / 1000, options.length);
      previous = now;
      paint(next.position);
      if (next.done) stopMotion();
      else animation.current = requestAnimationFrame(frame);
    };
    animation.current = requestAnimationFrame(frame);
  }

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      reducedMotion.current = preference.matches;
      if (preference.matches) {
        scrollTo(Math.round(offsetRef.current));
        finishEntry();
        finishLeave();
      }
    };
    const suspend = () => {
      if (document.hidden) {
        drag.current = undefined;
        scrollTo(Math.round(offsetRef.current));
        finishLeave();
      }
    };
    update();
    preference.addEventListener("change", update);
    document.addEventListener("visibilitychange", suspend);
    // A changed inventory invalidates both a drag and its release target.
    drag.current = undefined;
    scrollTo(offsetRef.current);
    return () => {
      if (animation.current !== undefined) cancelAnimationFrame(animation.current);
      animation.current = undefined;
      preference.removeEventListener("change", update);
      document.removeEventListener("visibilitychange", suspend);
    };
  }, [options.length]);

  // A non-passive listener prevents the page behind the modal from scrolling.
  useEffect(() => {
    const element = wheel.current!;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (pendingLeave.current) return;
      finishEntry();
      const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
      const pixels = delta * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 300 : 1);
      element.focus({ preventScroll: true });
      scrollTo(offsetRef.current + pixels / 100);
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [options.length, onOffsetChange]);

  function pointerAngle(event: PointerEvent) {
    const rect = wheel.current!.getBoundingClientRect();
    const centerX = rect.left + rect.width * RADIAL_CENTER / 360;
    const centerY = rect.top + rect.height * RADIAL_CENTER / 360;
    if (Math.hypot(event.clientX - centerX, event.clientY - centerY) < rect.width * .2) return undefined;
    return Math.atan2(centerY - event.clientY, centerX - event.clientX) * 180 / Math.PI;
  }

  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || event.button !== 0 || pendingLeave.current) return;
    finishEntry();
    const caught = animation.current !== undefined;
    stopMotion();
    const angle = pointerAngle(event);
    const control = (event.target as Element).closest(".radial-center-controls, .radial-hub");
    suppressClick.current = caught && !control;
    if (angle === undefined || control) return;
    drag.current = {
      id: event.pointerId, angle, x: event.clientX, y: event.clientY, moved: false,
      position: dragOrigin(offsetRef.current, options.length), velocity: 0, time: event.timeStamp, caught,
    };
  }

  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    const angle = pointerAngle(event);
    if (angle === undefined) return;
    if (!current.moved && Math.hypot(event.clientX - current.x, event.clientY - current.y) < 7) return;
    if (!current.moved) {
      current.moved = true;
      suppressClick.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      event.currentTarget.focus({ preventScroll: true });
      setMotion("dragging");
    }
    // The options follow the finger. Clockwise rotation reveals earlier items.
    const delta = -angleDelta(current.angle, angle) / RADIAL_STEP;
    const elapsed = Math.max(1, event.timeStamp - current.time);
    const blend = 1 - Math.exp(-elapsed / 40);
    current.velocity += (Math.max(-8, Math.min(8, delta * 1000 / elapsed)) - current.velocity) * blend;
    current.position += delta;
    paint(reducedMotion.current ? clampOffset(current.position, options.length) : rubberBandOffset(current.position, options.length));
    current.angle = angle;
    current.time = event.timeStamp;
  }

  function finishDrag(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (current?.id !== event.pointerId) return;
    drag.current = undefined;
    if (current.moved || current.caught) {
      // A paused finger or cancelled gesture must not fling the list.
      const velocity = event.type === "pointerup" && event.timeStamp - current.time < 100 ? current.velocity : 0;
      settle(velocity);
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function navigate(event: KeyboardEvent) {
    if (pendingLeave.current) { event.preventDefault(); return; }
    const target = event.target as HTMLElement;
    if (target.closest(".radial-center-controls")) return;
    const index = Number(target.dataset.index ?? Math.round(offset));
    let next: number;
    if (event.key === "Home") next = 0;
    else if (event.key === "End") next = options.length - 1;
    else if (event.key === "ArrowDown" || event.key === "ArrowRight") next = index + 1;
    else if (event.key === "ArrowUp" || event.key === "ArrowLeft") next = index - 1;
    else if (event.key === "PageDown") next = index + RADIAL_VISIBLE;
    else if (event.key === "PageUp") next = index - RADIAL_VISIBLE;
    else return;
    event.preventDefault();
    finishEntry();
    next = Math.max(0, Math.min(next, options.length - 1));
    scrollTo(next < offset ? next : next > offset + 2 ? next - 2 : offset);
    requestAnimationFrame(() => {
      const button = wheel.current?.querySelector<HTMLButtonElement>(`[data-index="${next}"]`);
      button?.focus({ preventScroll: true });
    });
  }

  const thumbSize = options.length ? Math.min(90, 90 * RADIAL_VISIBLE / options.length) : 90;
  const thumbLength = Math.max(3, thumbSize * (1 - Math.min(.5, Math.abs(rawOffset - offset))));
  const thumbStart = maximum ? (90 - thumbLength) * offset / maximum : 0;
  return (
    <dialog
      ref={dialog}
      className="radial-dialog"
      aria-label={title}
      data-presence={presence}
      data-dismissing={dismissing || undefined}
      data-from-launcher={animateEntry || undefined}
      onCancel={event => { event.preventDefault(); leave(onClose, true); }}
      onPointerDown={event => { if (event.target === event.currentTarget) leave(onClose, true); }}
    >
      <section
        ref={panel}
        className="radial-panel"
        inert={presence === "leaving"}
        onAnimationEnd={event => {
          if (event.target !== event.currentTarget) return;
          if (event.animationName === "radial-menu-enter") finishEntry();
          if (event.animationName === "radial-menu-exit") finishLeave();
        }}
      >
        <header className="radial-heading">
          <p>{description ?? "Herdr Control"}</p>
          <h2>{title}</h2>
          <p id={helpId}>Drag the arc to scroll · Arrow keys also work</p>
          {options.length === 0 && <p role="status">{emptyMessage}</p>}
        </header>
        <div
          ref={wheel}
          className="radial-wheel"
          data-motion={motion}
          role="group"
          aria-label="Radial options"
          aria-describedby={helpId}
          tabIndex={0}
          onKeyDown={navigate}
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={finishDrag}
          onPointerCancel={finishDrag}
          onLostPointerCapture={event => {
            if (event.target === event.currentTarget && drag.current) {
              drag.current = undefined;
              settle();
            }
          }}
          onClickCapture={event => {
            if (suppressClick.current && event.detail !== 0) { event.preventDefault(); event.stopPropagation(); }
            suppressClick.current = false;
          }}
        >
          <svg className="radial-track" viewBox="0 0 360 360" role="meter" aria-label="List position"
            aria-valuemin={0} aria-valuemax={maximum || 1} aria-valuenow={Math.round(offset * 1000) / 1000}
            aria-valuetext={`${Math.floor(offset) + (options.length ? 1 : 0)} of ${options.length}`} aria-controls={optionsId}>
            <path className="radial-scroll-track" d={radialArc(0, 90)} />
            {options.length > 0 && <path className="radial-scroll-thumb" d={radialArc(thumbStart, thumbStart + thumbLength)} />}
          </svg>
          <div className="radial-options" id={optionsId}>
            {radialWindow(options.length, offset, rawOffset - offset).map(({ index, angle }) => {
              const option = options[index];
              const point = radialPoint(angle, 200);
              const visible = angle >= 14.99 && angle <= 75.01;
              return (
                <button
                  key={option.id}
                  type="button"
                  className={`radial-option ${option.id === preferredId ? "preferred" : ""}`}
                  data-index={index}
                  aria-label={option.detail ? `${option.label} · ${option.detail}` : option.label}
                  aria-disabled={option.disabled || undefined}
                  aria-hidden={!visible || undefined}
                  tabIndex={visible ? 0 : -1}
                  title={option.detail ? `${option.label} · ${option.detail}` : option.label}
                  style={{
                    left: `${point.x / 3.6}%`, top: `${point.y / 3.6}%`,
                    transform: "translate(-50%, -50%)",
                    "--orb-opacity": Math.max(0, Math.min(1, angle / 15, (90 - angle) / 15)),
                    "--orb-order": Math.max(0, Math.min(3, index - Math.floor(offset))),
                    "--orb-enter-x": `${(RADIAL_CENTER - point.x) * .06}px`,
                    "--orb-enter-y": `${(RADIAL_CENTER - point.y) * .06}px`,
                    pointerEvents: visible ? undefined : "none",
                  } as CSSProperties}
                  onClick={() => { if (!option.disabled) leave(() => onSelect(option.id)); }}
                >
                  <span>{option.label}</span>
                  {option.detail && <small>{option.detail}</small>}
                </button>
              );
            })}
          </div>
          <div className="radial-center-controls">
            <p className="radial-position" role="status">{options.length ? `${Math.floor(offset) + 1}–${Math.min(options.length, Math.floor(offset) + RADIAL_VISIBLE)} / ${options.length}` : "0 options"}</p>
            {maximum > 0 && <div className="radial-step-controls">
              <button type="button" className="secondary" aria-label="Previous options" disabled={offset <= 0} onClick={() => scrollTo(Math.ceil(offset) - 1)}>‹</button>
              <button type="button" className="secondary" aria-label="Next options" disabled={offset >= maximum} onClick={() => scrollTo(Math.floor(offset) + 1)}>›</button>
            </div>}
          </div>
          <button className={`radial-hub${animateEntry ? " from-launcher" : ""}`} type="button" aria-label={onBack ? "Back" : "Close menu"} onClick={() => leave(onBack ?? onClose, !onBack)}>
            {onBack ? "←" : "×"}
          </button>
        </div>
        {onBack && <button className="radial-dismiss secondary" type="button" onClick={() => leave(onClose, true)}>Close menu</button>}
      </section>
    </dialog>
  );
}
