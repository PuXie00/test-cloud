import { ScrollArea } from "@/app/components/ui/scroll-area";
import { cn } from "@/app/components/ui/utils";
import { COLLAB_SURFACES } from "../collab-surfaces";
import type { CollaborationState } from "../collab-types";
import { AssignmentsSection } from "./assignments-section";
import { HandoverSection } from "./handover-section";
import { MarkersSection } from "./markers-section";
import { MessagesSection } from "./messages-section";
import { OwnershipSection } from "./ownership-section";

type CollaborationPanelProps = {
  state: CollaborationState;
  onChange: (state: CollaborationState) => void;
};

export const CollaborationPanel = ({ state, onChange }: CollaborationPanelProps) => {
  const update = (patch: Partial<CollaborationState>) => {
    onChange({ ...state, ...patch });
  };

  return (
    <ScrollArea className={cn("min-h-0 flex-1", COLLAB_SURFACES.content)}>
      <div className="grid grid-cols-1 gap-4 p-4 xl:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-4">
          <OwnershipSection hasControl={state.hasControl} onChange={update} />
          <HandoverSection requests={state.handoverRequests} onChange={update} />
          <MarkersSection markers={state.markers} />
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <AssignmentsSection
            assignments={state.assignments}
            conflictStrategy={state.conflictStrategy}
            editingAssignments={state.editingAssignments}
            onChange={update}
          />
          <MessagesSection messages={state.messages} onChange={update} />
        </div>
      </div>
    </ScrollArea>
  );
};
