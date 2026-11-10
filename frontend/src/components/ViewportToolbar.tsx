// Floating camera controls shared by every 3D workspace: fit, reset, axis views,
// projection, auto-rotate, zoom, image export and fullscreen.

import { useEffect, useRef, useState, type RefObject } from "react";
import type { VolumeRenderer } from "../render/VolumeRenderer";
import { download } from "./LineChart";
import { dataURLtoBlob } from "./common";

interface Props {
  renderer: RefObject<VolumeRenderer | null>;
  /** Frame the current content; defaults to the renderer's own fit(). */
  onFit?: () => void;
  /** Controlled projection (Atomic Explorer keeps it in its undo history). */
  orthographic?: boolean;
  onOrthographic?: (on: boolean) => void;
  imageName: string;
  /** Workspace is visible; keyboard shortcuts are ignored otherwise. */
  active: boolean;
}

const HINT_KEY = "chemmodel.viewHintDismissed";

export function ViewportToolbar({ renderer, onFit, orthographic, onOrthographic, imageName, active }: Props) {
  const [orthoLocal, setOrthoLocal] = useState(false);
  const ortho = orthographic ?? orthoLocal;
  const [spin, setSpin] = useState(false);
  const [axesOpen, setAxesOpen] = useState(false);
  const [hint, setHint] = useState(() => {
    try {
      return localStorage.getItem(HINT_KEY) !== "1";
    } catch {
      return true;
    }
  });
  const ref = useRef<HTMLDivElement>(null);

  const fit = () => (onFit ? onFit() : renderer.current?.fit());
  const setOrtho = (on: boolean) => {
    if (onOrthographic) onOrthographic(on);
    else {
      setOrthoLocal(on);
      renderer.current?.setOrthographic(on);
    }
  };
  const toggleSpin = () => {
    renderer.current?.setAutoRotate(!spin);
    setSpin(!spin);
  };
  const shot = () => renderer.current && download(imageName, dataURLtoBlob(renderer.current.exportPNG(3)));
  const fullscreen = () => {
    const wrap = ref.current?.closest(".viewport-wrap");
    if (!wrap) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
    else wrap.requestFullscreen?.().catch(() => undefined);
  };
  const dismissHint = () => {
    setHint(false);
    try {
      localStorage.setItem(HINT_KEY, "1");
    } catch {
      /* storage unavailable */
    }
  };

  // shortcuts shared by all 3D views (workspace-specific keys live in each workspace)
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(t.tagName)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const r = renderer.current;
      if (!r) return;
      if (e.key === "f") fit();
      else if (e.key === "r") r.resetView();
      else if (e.key === "+" || e.key === "=") r.zoomBy(1.25);
      else if (e.key === "-" || e.key === "_") r.zoomBy(0.8);
      else if (e.key === "x" || e.key === "X") r.viewAlong(e.shiftKey ? "-x" : "+x");
      else if (e.key === "y" || e.key === "Y") r.viewAlong(e.shiftKey ? "-y" : "+y");
      else if (e.key === "z" || e.key === "Z") r.viewAlong(e.shiftKey ? "-z" : "+z");
      else if (e.key === " " && t.tagName !== "BUTTON") {
        e.preventDefault();
        toggleSpin();
      } else return;
      dismissHint();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // stop spinning when the workspace is hidden
  useEffect(() => {
    if (!active && spin) {
      renderer.current?.setAutoRotate(false);
      setSpin(false);
    }
  }, [active, spin, renderer]);

  return (
    <>
      <div className="view-toolbar" ref={ref} onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
        <button className="icon" title="Fit to content (F)" onClick={fit}>
          <Icon d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
        </button>
        <button className="icon" title="Reset camera (R)" onClick={() => renderer.current?.resetView()}>
          <Icon d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4" />
        </button>
        <div className="vt-group">
          <button className={`icon ${axesOpen ? "on" : ""}`} title="View along an axis (X / Y / Z, Shift for −)" onClick={() => setAxesOpen(!axesOpen)}>
            <Icon d="M12 12V3M12 12l7.8 4.5M12 12l-7.8 4.5" />
          </button>
          {axesOpen && (
            <div className="vt-pop">
              {(["+x", "-x", "+y", "-y", "+z", "-z"] as const).map((d) => (
                <button
                  key={d}
                  onClick={() => {
                    renderer.current?.viewAlong(d);
                    setAxesOpen(false);
                  }} title={`Look from ${d} toward the centre`}>
                  {d}
                </button>
              ))}
            </div>
          )}
        </div>
        <span className="vt-sep" />
        <button className="icon" title="Zoom in (+)" onClick={() => renderer.current?.zoomBy(1.25)}>
          <Icon d="M12 6v12M6 12h12" />
        </button>
        <button className="icon" title="Zoom out (−)" onClick={() => renderer.current?.zoomBy(0.8)}>
          <Icon d="M6 12h12" />
        </button>
        <span className="vt-sep" />
        <button className={`icon ${ortho ? "on" : ""}`} title={`Projection: ${ortho ? "orthographic" : "perspective"} (click to switch)`} onClick={() => setOrtho(!ortho)}>
          {ortho ? <Icon d="M5 5h14v14H5z" /> : <Icon d="M7 5h10l3 14H4z" />}
        </button>
        <button className={`icon ${spin ? "on" : ""}`} title="Auto-rotate (Space)" onClick={toggleSpin}>
          <Icon d="M20 12a8 8 0 1 1-3-6.2M20 4v4h-4" />
        </button>
        <span className="vt-sep" />
        <button className="icon" title="Save image at 3× resolution" onClick={shot}>
          <Icon d="M4 8h3l2-3h6l2 3h3v11H4zM12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z" />
        </button>
        <button className="icon" title="Fullscreen viewport" onClick={fullscreen}>
          <Icon d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5M9 9h6v6H9z" />
        </button>
      </div>
      {hint && (
        <div className="view-hint" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
          <span><kbd>Drag</kbd> rotate</span>
          <span><kbd>Right-drag</kbd> pan</span>
          <span><kbd>Scroll</kbd> zoom</span>
          <span><kbd>?</kbd> all shortcuts</span>
          <button className="link" onClick={dismissHint}>Got it</button>
        </div>
      )}
    </>
  );
}

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}
