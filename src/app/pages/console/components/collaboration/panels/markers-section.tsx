import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/components/ui/utils";
import { CollabSection } from "../collab-section";
import { CollabSectionPanel } from "../collab-section-panel";
import { COLLAB_SURFACES } from "../collab-surfaces";
import type { CollabMarker } from "../collab-types";

type MarkersSectionProps = {
  markers: CollabMarker[];
};

export const MarkersSection = ({ markers }: MarkersSectionProps) => (
  <CollabSection
    title="协作标记"
    action={
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="text-muted-foreground hover:text-foreground"
        onClick={() => toast.info("演示模式，暂不支持新建")}
      >
        <Plus className="h-3.5 w-3.5" aria-hidden />
        添加标记
      </Button>
    }
  >
    <CollabSectionPanel className="flex flex-col gap-2 p-3">
      {markers.map((marker, index) => (
        <div
          key={marker.id}
          className={cn(
            "rounded-md px-4 py-3",
            index % 2 === 0 ? COLLAB_SURFACES.recessed : COLLAB_SURFACES.elevated,
          )}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-body-md text-foreground">{marker.location}</span>
            <span className="font-mono text-mono-sm tabular-nums text-muted-foreground">
              {marker.time}
            </span>
          </div>
          <p className="mt-1 text-body-sm text-foreground">{marker.content}</p>
          <p className="mt-1 text-body-sm text-muted-foreground">— {marker.author}</p>
        </div>
      ))}
    </CollabSectionPanel>
  </CollabSection>
);
