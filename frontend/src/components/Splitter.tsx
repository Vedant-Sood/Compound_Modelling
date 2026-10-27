// Drag handle that resizes a workspace panel by updating a CSS variable.

interface Props {
  variable: "--left" | "--right" | "--bottom";
  direction: 1 | -1; // +1: dragging right/down grows the panel
  vertical?: boolean; // true for the bottom panel (drag in y)
  min: number;
  max: number;
}

export function Splitter({ variable, direction, vertical, min, max }: Props) {
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const ws = e.currentTarget.closest(".workspace") as HTMLElement | null;
    if (!ws) return;
    const start = vertical ? e.clientY : e.clientX;
    const initial = parseFloat(getComputedStyle(ws).getPropertyValue(variable)) || 300;
    const move = (ev: PointerEvent) => {
      const delta = ((vertical ? ev.clientY : ev.clientX) - start) * direction;
      ws.style.setProperty(variable, `${Math.min(max, Math.max(min, initial + delta))}px`);
      window.dispatchEvent(new Event("resize"));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return <div className={`splitter ${vertical ? "h" : "v"} ${variable.slice(2)}`} onPointerDown={onPointerDown} />;
}
