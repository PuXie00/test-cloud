import { Move3d } from "lucide-react";

type NodeCanvasProps = {
  templateName?: string;
};

export const NodeCanvas = ({ templateName }: NodeCanvasProps) => (
  <main className="relative flex min-w-0 flex-1 flex-col bg-canvas">
    <div
      className="absolute inset-0"
      style={{
        backgroundImage:
          "linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)",
        backgroundSize: "20px 20px",
      }}
      aria-hidden
    />
    <div className="relative z-10 m-auto flex flex-col items-center gap-3 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-md border border-dashed border-border text-muted-foreground">
        <Move3d className="h-5 w-5" aria-hidden />
      </div>
      {templateName && (
        <p className="rounded-full border border-border bg-card/60 px-3 py-1 text-label-caps text-primary">
          基于模板 · {templateName}
        </p>
      )}
      <p className="max-w-xs text-body-sm text-muted-foreground">
        从左侧拖入节点开始搭建规则。连线、参数面板将在后续 spec 中完善。
      </p>
    </div>
  </main>
);
