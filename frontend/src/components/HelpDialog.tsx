// Controls and keyboard shortcuts, opened with "?" or the toolbar help button.

import { useEffect, useRef } from "react";

type Row = [keys: string, action: string];

const GLOBAL: Row[] = [
  ["1 · 2 · 3", "Switch to Atomic · Molecular · Crystal"],
  ["?", "Show or hide this panel"],
  ["Esc", "Close this panel"],
];

const VIEW: Row[] = [
  ["Left-drag", "Rotate around the centre"],
  ["Right-drag / Shift-drag", "Pan"],
  ["Scroll / pinch", "Zoom (scale bar updates live)"],
  ["F", "Fit the content in view"],
  ["R", "Reset the camera"],
  ["X · Y · Z", "Look along +x, +y, +z (Shift for −)"],
  ["+ / −", "Zoom in / out"],
  ["Space", "Auto-rotate on / off"],
];

const WORKSPACE: Record<string, { title: string; rows: Row[] }> = {
  atomic: {
    title: "Atomic Explorer",
    rows: [
      ["O", "Orthographic / perspective"],
      ["I", "Isosurface / volume rendering"],
      ["C", "Clipping plane on / off"],
      ["Ctrl+Z · Ctrl+Y", "Undo · redo settings"],
      ["Ctrl+S", "Save project"],
    ],
  },
  molecular: {
    title: "Molecular Builder",
    rows: [
      ["S", "Select / measure tool (2–4 atoms: distance, angle, dihedral)"],
      ["A", "Add atom tool"],
      ["D", "Delete tool"],
      ["B", "Bond tool (click twice to cycle bond order)"],
      ["Ctrl+Z · Ctrl+Y", "Undo · redo edits"],
    ],
  },
  crystal: {
    title: "Crystal Explorer",
    rows: [
      ["Click atom", "Show its coordination shell"],
      ["Click second atom", "Measure the distance"],
      ["Ctrl+Z", "Undo the last structure change"],
    ],
  },
};

export function HelpDialog({ mode, onClose }: { mode: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const ws = WORKSPACE[mode];
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Controls and shortcuts" tabIndex={-1} ref={ref} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Controls and shortcuts</h2>
          <button className="icon" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="help-grid">
          <HelpTable title="3D view" rows={VIEW} />
          <div>
            {ws && <HelpTable title={ws.title} rows={ws.rows} />}
            <HelpTable title="Application" rows={GLOBAL} />
          </div>
        </div>
        <p className="muted small">
          Shortcuts are ignored while typing in a field. Panels can be resized by dragging their edges. Every value on screen is labelled
          as exact, computed, approximate or hypothetical; hover a property for its method and source.
        </p>
      </div>
    </div>
  );
}

function HelpTable({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <section>
      <h3>{title}</h3>
      <table className="keys">
        <tbody>
          {rows.map(([k, a]) => (
            <tr key={k}>
              <td>
                {k.split(" · ").map((x, i) => (
                  <span key={x}>
                    {i > 0 && " "}
                    <kbd>{x}</kbd>
                  </span>
                ))}
              </td>
              <td>{a}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
