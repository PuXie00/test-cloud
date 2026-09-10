import { toast } from "sonner";
import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/components/ui/utils";
import { CollabSection } from "../collab-section";
import { CollabSectionPanel } from "../collab-section-panel";
import { COLLAB_SURFACES } from "../collab-surfaces";
import type { CollaborationState, HandoverRequest } from "../collab-types";

type HandoverSectionProps = {
  requests: HandoverRequest[];
  onChange: (patch: Partial<CollaborationState>) => void;
};

export const HandoverSection = ({ requests, onChange }: HandoverSectionProps) => {
  const handleHandover = (id: string, approved: boolean) => {
    onChange({
      handoverRequests: requests.filter((item) => item.id !== id),
    });
    toast.success(approved ? "已同意交接请求（演示）" : "已拒绝交接请求（演示）");
  };

  return (
    <CollabSection title="权限交接">
      <CollabSectionPanel className="p-3">
        {requests.length === 0 ? (
          <div
            className={cn(
              "flex min-h-[72px] items-center justify-center rounded-md px-4 py-6 text-center",
              COLLAB_SURFACES.recessed,
            )}
          >
            <p className="text-body-sm text-muted-foreground">暂无待处理交接请求</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {requests.map((request, index) => (
              <div
                key={request.id}
                className={cn(
                  "flex flex-wrap items-center justify-between gap-3 rounded-md px-4 py-3",
                  index % 2 === 0 ? COLLAB_SURFACES.recessed : COLLAB_SURFACES.elevated,
                )}
              >
                <span className="text-body-md text-foreground">
                  <span className="text-primary">{request.requester}</span>
                  <span className="text-muted-foreground"> 请求 </span>
                  {request.targetGroup}
                  <span className="text-muted-foreground"> 控制权</span>
                </span>
                <div className="flex gap-2">
                  <Button type="button" size="sm" onClick={() => handleHandover(request.id, true)}>
                    同意
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleHandover(request.id, false)}
                  >
                    拒绝
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CollabSectionPanel>
    </CollabSection>
  );
};
