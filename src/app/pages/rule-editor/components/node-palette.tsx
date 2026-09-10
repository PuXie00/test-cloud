import { Cpu, Cog, Network, Radio, Shield, Sigma, type LucideIcon } from "lucide-react";
import { PanelHeader } from "@/app/components/ics/panel-header";

type NodeKind = {
  id: string;
  label: string;
  icon: LucideIcon;
};

const GROUPS: { title: string; nodes: NodeKind[] }[] = [
  { title: "设备", nodes: [{ id: "device.servo", label: "伺服设备", icon: Cpu }, { id: "device.io", label: "I/O 设备", icon: Cog }] },
  { title: "逻辑", nodes: [{ id: "logic.compare", label: "比较", icon: Sigma }, { id: "logic.and", label: "与/或/非", icon: Sigma }] },
  { title: "运算", nodes: [{ id: "math.expr", label: "表达式", icon: Sigma }] },
  { title: "特殊", nodes: [{ id: "safety.collide", label: "碰撞保护", icon: Shield }, { id: "safety.distance", label: "位差保护", icon: Shield }] },
  { title: "外部信号", nodes: [{ id: "ext.timecode", label: "Timecode", icon: Radio }, { id: "ext.dmx", label: "DMX512", icon: Radio }, { id: "ext.psn", label: "PSN", icon: Radio }] },
  { title: "通讯", nodes: [{ id: "net.action", label: "下发动作", icon: Network }] },
];

export const NodePalette = () => (
  <aside className="flex w-[240px] shrink-0 flex-col border-r border-border bg-card/40">
    <PanelHeader title="节点" />
    <div className="custom-scrollbar flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
      {GROUPS.map((g) => (
        <div key={g.title} className="flex flex-col gap-1.5">
          <span className="text-label-caps text-muted-foreground">{g.title}</span>
          {g.nodes.map((n) => {
            const Icon = n.icon;
            return (
              <button
                key={n.id}
                type="button"
                draggable
                className="flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5 text-left text-body-sm text-foreground/80 hover:border-primary/60 hover:text-foreground [@media(pointer:coarse)]:py-2.5"
              >
                <Icon className="h-3.5 w-3.5 text-primary" aria-hidden />
                <span className="truncate">{n.label}</span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  </aside>
);
