/**
 * WorkspaceShell (workspace redesign §5): the three-column composition -
 * left navigator 200-320px, flexible center, contextual inspector
 * 280-480px. Both columns resize through a splitter (APG window splitter):
 * pointer drag, ArrowLeft/Right = +/-16px, Home/End = min/max. Widths
 * persist per notebook (lib/uiState.ts); the center header exposes a reset
 * ("Layout zurücksetzen").
 *
 * Narrow windows (§5): below 900px the inspector becomes a toggled overlay
 * panel with dialog semantics (role, Escape, focus into the panel and back
 * to the opener); below 700px the navigator becomes the same kind of
 * drawer. Measured on the shell itself (ResizeObserver), not the OS window.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";

const NAV_MIN = 200;
const NAV_MAX = 320;
const INSPECTOR_MIN = 280;
const INSPECTOR_MAX = 480;
const NARROW_NAV = 700;
const NARROW_INSPECTOR = 900;

/** APG window splitter: pointer drag + arrow keys, value via aria-valuenow. */
function Splitter({ label, value, min, max, onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
}) {
  const dragging = useRef(false);
  const start = useRef({ x: 0, width: 0 });
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      style={{ width: 8, margin: "0 -4px", zIndex: 2, cursor: "col-resize", flex: "0 0 8px" }}
      onPointerDown={(e) => {
        dragging.current = true;
        start.current = { x: e.clientX, width: value };
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!dragging.current) return;
        onChange(Math.min(max, Math.max(min, start.current.width + e.clientX - start.current.x)));
      }}
      onPointerUp={(e) => {
        dragging.current = false;
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") onChange(Math.max(min, value - 16));
        if (e.key === "ArrowRight") onChange(Math.min(max, value + 16));
        if (e.key === "Home") onChange(min);
        if (e.key === "End") onChange(max);
      }}
    />
  );
}

/** Container width via ResizeObserver (re-render only on real changes). */
function useShellWidth(ref: React.RefObject<HTMLDivElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setWidth(Math.round(w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

/** Overlay panel used for the inspector (<900px) and the nav drawer
 *  (<700px): role="dialog", Escape closes, focus moves into the panel on
 *  open and back to the opener on close. Focus return works because the
 *  opener (header toggle button) stays mounted the whole time. */
function OverlayPanel({ title, labelledBy, onClose, children, width, side }: {
  title?: string;
  labelledBy?: string;
  onClose: () => void;
  children: ReactNode;
  width: number;
  side: "left" | "right";
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<Element | null>(null);
  useEffect(() => {
    openerRef.current = document.activeElement;
    panelRef.current?.focus();
    return () => {
      const opener = openerRef.current;
      if (opener instanceof HTMLElement && document.contains(opener)) opener.focus();
    };
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 40 }}
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-labelledby={labelledBy}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
        style={{
          position: "absolute", top: 0, bottom: 0, [side]: 0,
          width, maxWidth: "100%", overflowY: "auto",
          background: "var(--paper)",
          borderLeft: side === "right" ? "1px solid var(--rule)" : undefined,
          borderRight: side === "left" ? "1px solid var(--rule)" : undefined,
          display: "flex", flexDirection: "column",
        }}
      >
        {children}
      </div>
    </div>
  );
}

/** The composition root's layout container. Three children: nav, center,
 *  inspector. Inline column vs overlay derives from the measured shell
 *  width - no media queries, the desktop window can be any size. */
export function WorkspaceShell(props: {
  navWidth: number;
  inspectorWidth: number;
  onNavWidth: (w: number) => void;
  onInspectorWidth: (w: number) => void;
  inspectorOpen: boolean;
  navDrawerOpen: boolean;
  onCloseInspector: () => void;
  onCloseNavDrawer: () => void;
  nav: ReactNode;
  center: ReactNode;
  inspector: ReactNode;
}) {
  const shellRef = useRef<HTMLDivElement>(null);
  const width = useShellWidth(shellRef);
  const navAsOverlay = width > 0 && width < NARROW_NAV;
  const inspectorAsOverlay = width > 0 && width < NARROW_INSPECTOR;
  return (
    <div ref={shellRef} style={{ display: "flex", width: "100%", minHeight: 0, position: "relative" }}>
      {/* Navigator: inline column when wide, drawer below 700px. */}
      {!navAsOverlay && (
        <aside
          aria-label="Quellen und Notizen"
          style={{
            width: props.navWidth, flex: `0 0 ${props.navWidth}px`, minWidth: 0, minHeight: 0,
            display: "flex", flexDirection: "column", borderRight: "1px solid var(--rule)",
            background: "var(--paper-muted)", overflow: "hidden",
          }}
        >
          {props.nav}
        </aside>
      )}
      {navAsOverlay && props.navDrawerOpen && (
        <OverlayPanel side="left" width={260}
          title="Navigation" onClose={props.onCloseNavDrawer}>
          {props.nav}
        </OverlayPanel>
      )}
      {!navAsOverlay && (
        <Splitter label="Navigatorbreite anpassen" value={props.navWidth}
          min={NAV_MIN} max={NAV_MAX} onChange={props.onNavWidth} />
      )}
      {/* Center column: the work surface (reader / note / chat / lists). */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
        {props.center}
      </div>
      {/* Inspector splitter sits between center and the inline column. */}
      {props.inspectorOpen && !inspectorAsOverlay && (
        <Splitter label="Inspector-Breite anpassen" value={props.inspectorWidth}
          min={INSPECTOR_MIN} max={INSPECTOR_MAX} onChange={props.onInspectorWidth} />
      )}
      {/* Inspector: inline column 320-400px, overlay panel below 900px.
          Closed on wide windows simply frees the row for the center. */}
      {!inspectorAsOverlay && props.inspectorOpen && (
        <aside
          aria-label="Inspector"
          style={{
            width: props.inspectorWidth, flex: `0 0 ${props.inspectorWidth}px`, minWidth: 0, minHeight: 0,
            display: "flex", flexDirection: "column", borderLeft: "1px solid var(--rule)",
            background: "var(--paper-muted)", overflow: "hidden",
          }}
        >
          {props.inspector}
        </aside>
      )}
      {inspectorAsOverlay && props.inspectorOpen && (
        <OverlayPanel side="right" width={360}
          title="Inspector" labelledBy="inspector-heading" onClose={props.onCloseInspector}>
          {props.inspector}
        </OverlayPanel>
      )}
    </div>
  );
}
