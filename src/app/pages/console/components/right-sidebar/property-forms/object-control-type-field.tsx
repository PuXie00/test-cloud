import { useState } from "react";
import { toast } from "sonner";
import type { ControlType } from "@/app/project/configuration-types";
import { useProject } from "@/app/project/use-project";
import {
  analyzeControlTypeChangeImpact,
  EMPTY_CONTROL_TYPE_CHANGE_IMPACT,
  type ControlTypeChangeImpact,
} from "@/app/pages/console/hooks/control-type-change";
import { useProjectStore } from "@/app/pages/console/hooks/use-project-store";
import { CONTROL_TYPE_DEFINITION_BY_ID } from "../config-wizard/config-descriptors";
import { ControlTypeChangeConfirmDialog } from "./control-type-change-confirm-dialog";
import { ControlTypeSelector } from "./control-type-selector";

type ObjectControlTypeFieldProps = {
  objectId: number;
  value: ControlType;
};

/** 改控制类型：有影响时先确认 */
export const ObjectControlTypeField = ({ objectId, value }: ObjectControlTypeFieldProps) => {
  const { changeObjectControlType } = useProjectStore();
  const { currentProject } = useProject();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingControlType, setPendingControlType] = useState<ControlType | null>(null);
  const [pendingImpact, setPendingImpact] = useState<ControlTypeChangeImpact | null>(null);

  const handleChange = (controlType: ControlType) => {
    const document = currentProject?.document;
    if (!document) return;
    const impact = analyzeControlTypeChangeImpact(document, [objectId], controlType);
    if (!impact.changed) {
      changeObjectControlType([objectId], controlType);
      return;
    }
    setPendingControlType(controlType);
    setPendingImpact(impact);
    setConfirmOpen(true);
  };

  const handleConfirm = () => {
    if (pendingControlType) {
      const result = changeObjectControlType([objectId], pendingControlType);
      if (!result.ok) toast.error(result.reason);
    }
    setPendingControlType(null);
    setPendingImpact(null);
    setConfirmOpen(false);
  };

  return (
    <>
      <ControlTypeSelector value={value} onChange={handleChange} />
      <ControlTypeChangeConfirmDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          setConfirmOpen(open);
          if (!open) {
            setPendingControlType(null);
            setPendingImpact(null);
          }
        }}
        targetLabel={pendingControlType ? CONTROL_TYPE_DEFINITION_BY_ID[pendingControlType].label : ""}
        impact={pendingImpact ?? EMPTY_CONTROL_TYPE_CHANGE_IMPACT}
        onConfirm={handleConfirm}
      />
    </>
  );
};
