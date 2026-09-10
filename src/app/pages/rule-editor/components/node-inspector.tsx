import { PanelHeader } from "@/app/components/ics/panel-header";

export const NodeInspector = () => (
  <aside className="flex w-[320px] shrink-0 flex-col border-l border-border bg-card/40">
    <PanelHeader title="节点参数" />
    <div className="custom-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto p-3">
      <p className="text-body-sm text-muted-foreground">选中画布中的节点以查看并编辑其参数。</p>
    </div>
  </aside>
);
