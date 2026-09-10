import {
  ArrowLeftRight,
  Gamepad2,
  Globe,
  Hand,
  Monitor,
  PanelRightOpen,
  Users,
  X,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/app/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/app/components/ui/popover";
import { cn } from "@/app/components/ui/utils";
import {
  COLLAB_QUICK_SNAPSHOT,
  parseConnectedLabel,
} from "./collab-quick-constants";
import { QUICK_OPERATOR_ROLE_LABEL, type QuickOperator, type QuickOperatorRole } from "./collab-quick-types";
import { CollabStatusPill } from "./collab-status-pill";
import { COLLAB_SURFACES } from "./collab-surfaces";

type CollabQuickPopoverProps = {
  connected?: string;
  onOpenFullManage: () => void;
};

const operatorPillVariant = (role: QuickOperatorRole) => {
  if (role === "control") return "active" as const;
  if (role === "partition") return "info" as const;
  return "idle" as const;
};

const QuickSection = ({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Globe;
  title: string;
  children: ReactNode;
}) => (
  <section className={cn("rounded-md p-3", COLLAB_SURFACES.section)}>
    <div className="mb-2 flex items-center gap-2">
      <Icon className="h-3.5 w-3.5 shrink-0 text-secondary" aria-hidden />
      <h4 className="text-label-caps text-muted-foreground">{title}</h4>
    </div>
    {children}
  </section>
);

export const CollabQuickPopover = ({
  connected = "24/24 Connected",
  onOpenFullManage,
}: CollabQuickPopoverProps) => {
  const [open, setOpen] = useState(false);
  const { count, allOnline } = parseConnectedLabel(connected);
  const snapshot = COLLAB_QUICK_SNAPSHOT;

  const handleFullManage = () => {
    setOpen(false);
    onOpenFullManage();
  };

  const handleReclaim = (operator: QuickOperator) => {
    toast.success(`已回收 ${operator.label} 的权限（演示）`);
  };

  const handleSwitchStandby = () => {
    toast.success("已切换至备用控台（演示）");
  };

  const handleRequestControl = () => {
    toast.info("已发送控制权请求（演示）");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="查看多机协作状态"
          aria-expanded={open}
          className="flex items-center gap-2 rounded-md px-2 py-1 transition-colors hover:bg-accent"
        >
          <span
            className={cn("h-2 w-2 rounded-full", allOnline ? "bg-show" : "bg-warning")}
            aria-hidden
          />
          <span className="font-mono text-mono-sm tabular-nums text-muted-foreground">
            {count} 在线
          </span>
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={8}
        className={cn(
          "w-[380px] overflow-hidden rounded-lg border-0 p-0",
          COLLAB_SURFACES.shell,
          "shadow-[0_4px_24px_rgba(0,0,0,0.4)]",
        )}
      >
        <div className={cn("flex items-center justify-between px-4 py-3", COLLAB_SURFACES.chrome)}>
          <div className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-primary" aria-hidden />
            <span className="text-body-md font-semibold text-foreground">多机协作</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleFullManage}
              className="inline-flex items-center gap-1 rounded-sm px-2 py-1 text-body-sm text-primary transition-colors hover:bg-accent"
            >
              <PanelRightOpen className="h-3.5 w-3.5" aria-hidden />
              完整管理
            </button>
            <button
              type="button"
              aria-label="关闭"
              onClick={() => setOpen(false)}
              className="rounded-sm p-1 text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className={cn("flex flex-col gap-3 p-3", COLLAB_SURFACES.content)}>
          <QuickSection icon={Gamepad2} title="当前控制权">
            <div
              className={cn(
                "flex items-center justify-between gap-2 rounded-md px-3 py-2.5",
                COLLAB_SURFACES.elevated,
              )}
            >
              <span className="text-body-md text-foreground">{snapshot.controlOwner}</span>
              <CollabStatusPill variant="active">拥有者</CollabStatusPill>
            </div>
          </QuickSection>

          <QuickSection icon={Users} title="在线操作员">
            <div className="flex flex-col gap-2">
              {snapshot.operators.map((operator, index) => (
                <div
                  key={operator.id}
                  className={cn(
                    "flex items-center justify-between gap-2 rounded-md px-3 py-2",
                    index % 2 === 0 ? COLLAB_SURFACES.recessed : COLLAB_SURFACES.elevated,
                    !operator.online && "opacity-60",
                  )}
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <span
                      className={cn(
                        "truncate text-body-md",
                        operator.online ? "text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {operator.label}
                      {operator.isLocal ? (
                        <span className="text-muted-foreground">（本机）</span>
                      ) : null}
                    </span>
                    <CollabStatusPill variant={operatorPillVariant(operator.role)}>
                      {QUICK_OPERATOR_ROLE_LABEL[operator.role]}
                    </CollabStatusPill>
                  </div>
                  {operator.reclaimable ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 shrink-0 px-2 text-body-sm"
                      onClick={() => handleReclaim(operator)}
                    >
                      回收
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          </QuickSection>

          <QuickSection icon={Monitor} title="主机状态">
            <div className="flex flex-col gap-2">
              {snapshot.hosts.map((host, index) => (
                <div
                  key={host.id}
                  className={cn(
                    "flex items-center justify-between gap-2 rounded-md px-3 py-2",
                    index % 2 === 0 ? COLLAB_SURFACES.recessed : COLLAB_SURFACES.elevated,
                  )}
                >
                  <div className="flex items-center gap-2">
                    {host.isPrimary ? (
                      <span className="text-warning" aria-hidden>
                        ⌂
                      </span>
                    ) : null}
                    <span className="text-body-md text-foreground">{host.name}</span>
                  </div>
                  <span
                    className={cn(
                      "text-body-sm",
                      host.online ? "text-show" : "text-muted-foreground",
                    )}
                  >
                    {host.roleLabel} • {host.online ? "在线" : "离线"}
                  </span>
                </div>
              ))}
            </div>
          </QuickSection>
        </div>

        <div className={cn("flex gap-2 px-3 py-3", COLLAB_SURFACES.chrome)}>
          <Button
            type="button"
            className="flex-1 bg-warning text-background hover:bg-warning/90"
            onClick={handleSwitchStandby}
          >
            <ArrowLeftRight className="h-4 w-4 shrink-0" aria-hidden />
            手动切换至备用
          </Button>
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            onClick={handleRequestControl}
          >
            <Hand className="h-4 w-4 shrink-0 text-secondary" aria-hidden />
            请求控制权
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
};
