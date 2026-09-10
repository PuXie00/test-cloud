import { pendingGoEntries } from "../../hooks/go-ready";
import { useGoReady } from "../../hooks/go-ready-provider";

export const GoReadyOverlay = () => {
  const { state, go, cancel } = useGoReady();

  if (state.phase === "idle") return null;

  const pendingCount = pendingGoEntries(state.entries).length;
  const canGoAll = pendingCount > 0;
  const handleGoAll = () => {
    void go();
  };
  const handleCancelAll = () => {
    cancel();
  };

  return (
    <div className="pointer-events-auto absolute bottom-3 left-1/2 z-20 -translate-x-1/2">
      <div className="flex items-center gap-3 rounded-md bg-card px-3 py-2 shadow-[0_4px_24px_rgba(0,0,0,0.4)]">
        <span className="flex items-center gap-2 text-body-sm text-foreground">
          <span className="inline-block size-2 rounded-full bg-show" aria-hidden />
          {canGoAll
            ? `GO 准备 · ${pendingCount} 个物体`
            : "GO 执行中"}
        </span>
        <button
          type="button"
          aria-label="全部物体 GO"
          disabled={!canGoAll}
          onClick={handleGoAll}
          className="h-7 rounded-sm bg-primary px-3 text-body-sm font-semibold text-primary-foreground disabled:pointer-events-none disabled:opacity-40"
        >
          GO
        </button>
        <button
          type="button"
          aria-label="取消全部 GO"
          onClick={handleCancelAll}
          className="h-7 rounded-sm border border-primary px-3 text-body-sm text-primary hover:bg-primary/10"
        >
          清除
        </button>
      </div>
    </div>
  );
};
