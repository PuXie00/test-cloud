import { useState } from "react";
import { CheckCircle2, Crosshair, Move3d, Ruler } from "lucide-react";
import { cn } from "@/app/components/ui/utils";
import { PanelHeader } from "@/app/components/ics/panel-header";
import { ALIGNMENT_BY_OBJECT, type AlignmentMethod } from "@/app/pages/console/components/right-sidebar/project-data";
import { useConfigWizard } from "@/app/pages/console/hooks/use-config-wizard";

type AlignmentInlinePanelProps = {
  objectId: number;
  objectName: string;
  className?: string;
};

const btnPrimary =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-label-caps text-primary-foreground hover:opacity-90 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:px-4";
const btnSecondary =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-border bg-transparent px-3 text-label-caps text-foreground hover:bg-accent [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:px-4";

export const AlignmentInlinePanel = ({ objectId, objectName, className }: AlignmentInlinePanelProps) => {
  const { alignedObjectIds, markAligned } = useConfigWizard();
  const initial = ALIGNMENT_BY_OBJECT[objectId];
  const isAligned = alignedObjectIds.has(objectId) || initial?.status === "aligned";
  const [method, setMethod] = useState<AlignmentMethod | null>(initial?.method ?? null);
  const [phase, setPhase] = useState<"idle" | "running">("idle");

  const handlePick = (m: AlignmentMethod) => {
    setMethod(m);
    setPhase("idle");
  };

  const handleStart = () => {
    if (!method) return;
    setPhase("running");
  };

  const handleComplete = () => {
    markAligned(objectId);
    setPhase("idle");
  };

  return (
    <section className={cn("flex flex-col border-t border-border bg-card/30", className)} aria-label={`3D 对齐 · ${objectName}`}>
      <PanelHeader
        title={`3D 对齐 · ${objectName}`}
        icon={Crosshair}
        extra={isAligned ? (
          <span className="inline-flex items-center gap-1 text-body-sm text-primary">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> 已对齐
          </span>
        ) : null}
      />
      <div className="space-y-3 p-4">
        <p className="text-body-sm text-muted-foreground">
          选择对齐方法。完成后步骤 ⑥ 将自动反馈到向导。
        </p>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => handlePick("distance")}
            className={cn(
              "flex flex-col items-start gap-1 rounded-md border p-3 text-left text-body-sm transition-colors",
              "[@media(pointer:coarse)]:p-4",
              method === "distance" ? "border-primary bg-primary/10 text-foreground" : "border-border bg-background text-foreground/80 hover:border-primary/60"
            )}
          >
            <Ruler className="h-4 w-4 text-primary" aria-hidden />
            <span className="font-medium">距离对齐</span>
            <span className="text-muted-foreground">输入模型与地面/参考物体的实测距离</span>
          </button>
          <button
            type="button"
            onClick={() => handlePick("calibrate")}
            className={cn(
              "flex flex-col items-start gap-1 rounded-md border p-3 text-left text-body-sm transition-colors",
              "[@media(pointer:coarse)]:p-4",
              method === "calibrate" ? "border-primary bg-primary/10 text-foreground" : "border-border bg-background text-foreground/80 hover:border-primary/60"
            )}
          >
            <Move3d className="h-4 w-4 text-primary" aria-hidden />
            <span className="font-medium">标定运动范围</span>
            <span className="text-muted-foreground">通过点动到极限位置标定行程</span>
          </button>
        </div>

        <div className="flex items-center justify-end gap-2">
          {phase === "running" ? (
            <>
              <button type="button" className={btnSecondary} onClick={() => setPhase("idle")}>取消</button>
              <button type="button" className={btnPrimary} onClick={handleComplete}>标记完成</button>
            </>
          ) : (
            <button
              type="button"
              className={btnPrimary}
              disabled={!method}
              onClick={handleStart}
            >
              {isAligned ? "重新对齐" : "开始对齐"}
            </button>
          )}
        </div>
      </div>
    </section>
  );
};
