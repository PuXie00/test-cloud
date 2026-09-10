import { useEffect, useState } from "react";

const tickClock = () => new Date().toTimeString().slice(0, 8);

export const ConsoleFooter = () => {
  const [clock, setClock] = useState(tickClock);

  useEffect(() => {
    const id = setInterval(() => setClock(tickClock()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <footer className="flex h-6 shrink-0 select-none items-center justify-between bg-background px-3">
      <div className="flex items-center gap-4">
        {/* <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-show" />
          <span className="text-label-caps text-muted-foreground">System Online</span>
        </div> */}
        {/* <span className="font-mono text-mono-sm text-muted-foreground">TC: --:--:--:--</span> */}
        <span className="font-mono text-mono-sm text-warning">规则引擎: 3 激活</span>
      </div>
      <div className="flex items-center gap-4">
        {/* <span className="font-mono text-mono-sm text-muted-foreground">CPU: 12%</span> */}
        {/* <span className="font-mono text-mono-sm text-muted-foreground">MEM: 4.2GB</span> */}
        <span className="font-mono text-mono-sm tabular-nums text-foreground">{clock}</span>
      </div>
    </footer>
  );
};
