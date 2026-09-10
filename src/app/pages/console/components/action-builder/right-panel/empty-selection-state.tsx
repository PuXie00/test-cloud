import { MousePointer2 } from "lucide-react";

export const EmptySelectionState = () => (
  <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-10 text-center">
    <div className="flex h-10 w-10 items-center justify-center rounded-md border border-dashed border-border text-muted-foreground">
      <MousePointer2 className="h-4 w-4" aria-hidden />
    </div>

    <div className="space-y-3">
      <p className="text-body-sm text-muted-foreground">
        请在 3D 视图中选中受控物体模型
      </p>
      <p className="text-body-sm text-muted-foreground">或在时间轴左侧选择轨道</p>
    </div>
  </div>
);
