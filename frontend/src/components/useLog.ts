import { useCallback, useState } from "react";

export interface LogEntry {
  time: string;
  message: string;
  level: "info" | "warn" | "error";
}

export function useLog() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const log = useCallback((message: string, level: LogEntry["level"] = "info") => {
    const time = new Date().toLocaleTimeString();
    setEntries((e) => [...e.slice(-499), { time, message, level }]);
  }, []);
  const clear = useCallback(() => setEntries([]), []);
  return { log, entries, clear };
}
