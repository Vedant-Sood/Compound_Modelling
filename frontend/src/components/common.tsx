import { useEffect, useRef } from "react";
import type { LogEntry } from "./useLog";

export function Console({ entries, onClear }: { entries: LogEntry[]; onClear: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo(0, ref.current.scrollHeight);
  }, [entries]);
  return (
    <div className="console" ref={ref}>
      <button className="small clear" onClick={onClear}>Clear</button>
      {entries.map((e, i) => (
        <div key={i} className={`log ${e.level}`}>
          <span className="muted">{e.time}</span> {e.message}
        </div>
      ))}
    </div>
  );
}

export function dataURLtoBlob(url: string): Blob {
  const [head, data] = url.split(",");
  const mime = head.match(/:(.*?);/)?.[1] ?? "image/png";
  const bin = atob(data);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
