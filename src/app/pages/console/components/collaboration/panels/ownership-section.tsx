import { toast } from "sonner";
import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/components/ui/utils";
import { CollabSection } from "../collab-section";
import { CollabSectionPanel } from "../collab-section-panel";
import { CollabStatusPill } from "../collab-status-pill";
import { COLLAB_SURFACES } from "../collab-surfaces";
import type { CollaborationState } from "../collab-types";

type OwnershipSectionProps = {
  hasControl: boolean;
  onChange: (patch: Partial<CollaborationState>) => void;
};

export const OwnershipSection = ({ hasControl, onChange }: OwnershipSectionProps) => {
  const handleReleaseControl = () => {
    onChange({ hasControl: false });
    toast.success("操作权已释放（演示）");
  };

  const handleRequestControl = () => {
    onChange({ hasControl: true });
    toast.success("已请求控制权（演示）");
  };

  return (
    <CollabSection title="操作权管理">
      <CollabSectionPanel className="flex flex-col gap-3 p-3">
        <div className={cn("rounded-md p-4", COLLAB_SURFACES.elevated)}>
          <p className="text-body-sm text-muted-foreground">当前操作权持有者</p>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span
                className={cn("h-2 w-2 rounded-full", hasControl ? "bg-show" : "bg-muted-foreground")}
                aria-hidden
              />
              <span className="text-body-md text-foreground">张工（本机）</span>
            </div>
            <CollabStatusPill variant={hasControl ? "active" : "idle"}>
              {hasControl ? "完全控制" : "已释放"}
            </CollabStatusPill>
          </div>
          <p className="mt-2 text-body-sm text-muted-foreground">
            操作权状态：{hasControl ? "本机拥有全部受控物体操作权限" : "等待重新分配或请求"}
          </p>
        </div>

        <div className={cn("flex flex-wrap justify-end gap-2 rounded-md p-2", COLLAB_SURFACES.recessed)}>
          <Button type="button" variant="ghost" size="sm" onClick={handleReleaseControl}>
            释放操作权
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={hasControl}
            onClick={handleRequestControl}
          >
            请求控制权
          </Button>
        </div>
      </CollabSectionPanel>
    </CollabSection>
  );
};
