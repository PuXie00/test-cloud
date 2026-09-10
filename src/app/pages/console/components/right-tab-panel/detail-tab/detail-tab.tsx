import { useSelection } from "../../../hooks/use-selection";
import { useControlledObjects } from "../../../hooks/use-controlled-objects";
import { DetailModelInfo } from "./detail-model-info";
import { DetailDriveUnits } from "./detail-drive-units";
import { DetailActiveAlarms } from "./detail-active-alarms";
import { DetailRelatedProgram } from "./detail-related-program";

export const DetailTab = () => {
  const { selectedId, multiSelectedIds } = useSelection();
  const { getById } = useControlledObjects();

  if (multiSelectedIds.length > 1) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-body-sm text-muted-foreground">
        已选 {multiSelectedIds.length} 个受控物体。单选后可查看详情。
      </div>
    );
  }

  const effectiveId = multiSelectedIds.length === 1 ? multiSelectedIds[0] : selectedId;
  const snapshot = effectiveId ? getById(effectiveId) : undefined;

  if (!snapshot) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-body-sm text-muted-foreground">
        请在监控网格或 3D 中选择一个受控物体
      </div>
    );
  }

  return (
    <div className="custom-scrollbar h-full overflow-y-auto">
      <DetailModelInfo snapshot={snapshot} />
      <DetailDriveUnits snapshot={snapshot} />
      <DetailActiveAlarms snapshot={snapshot} />
      <DetailRelatedProgram objectName={snapshot.descriptor.name} />
    </div>
  );
};
