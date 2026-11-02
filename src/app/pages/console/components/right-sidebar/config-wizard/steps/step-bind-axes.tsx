import { useMemo } from "react";
import { toast } from "sonner";
import { cn } from "@/app/components/ui/utils";
import { controlTypeHasNoDriveAxes } from "@/app/project/configuration-rules";
import {
  countBoundAxesOnObject,
  getMotorIdForAxis,
  listAxisBindingsFromMotors,
  planAutoBind,
} from "@/app/pages/console/hooks/binding-utils";
import { useProjectStore } from "@/app/pages/console/hooks/use-project-store";
import { useSelection } from "@/app/pages/console/hooks/use-selection";
import { AxisMotorTreeSelect } from "../axis-motor-tree-select";
import { formatAxisLabel } from "../axis-utils";
import { CONTROL_TYPE_DEFINITION_BY_ID } from "../config-descriptors";
import { wizardBtnPrimary, wizardBtnSecondary } from "../wizard-buttons";
import { getWizardCounts, type WizardView } from "../wizard-state";
import { WizardStepHeading } from "../wizard-step-heading";

type EmptyStateProps = {
  title: string;
  detail: string;
  actionLabel: string;
  onAction: () => void;
};

const EmptyState = ({ title, detail, actionLabel, onAction }: EmptyStateProps) => (
  <div className="flex flex-col items-center gap-3 rounded-md bg-muted p-6 text-center">
    <div className="space-y-1">
      <p className="text-body-md font-medium text-foreground">{title}</p>
      <p className="text-body-sm text-muted-foreground">{detail}</p>
    </div>
    <button type="button" className={wizardBtnSecondary} onClick={onAction}>
      {actionLabel}
    </button>
  </div>
);

type StepBindAxesProps = {
  onNavigate: (view: WizardView) => void;
};

export const StepBindAxes = ({ onNavigate }: StepBindAxesProps) => {
  const { objects, plcs, motors, bindAxis, autoBindAxes } = useProjectStore();
  const { multiSelectedIds, select, setTreeFocus } = useSelection();
  const counts = getWizardCounts({ objects, plcs, motors });
  const bindable = objects.filter((object) => !controlTypeHasNoDriveAxes(object.controlType));
  const effectiveBindings = useMemo(() => listAxisBindingsFromMotors(motors), [motors]);
  const plan = useMemo(() => planAutoBind(objects, motors), [motors, objects]);
  const unbound = counts.axes - counts.boundAxes;

  const handleAutoBind = () => {
    const { assignments, unplacedAxisCount } = autoBindAxes();
    if (assignments.length === 0) return;
    if (unplacedAxisCount > 0) {
      toast.warning(
        `已绑定 ${assignments.length} 个吊点，还有 ${unplacedAxisCount} 个没有可用的驱动单元`,
      );
    } else {
      toast.success(`已绑定 ${assignments.length} 个吊点`);
    }
  };

  const handleBind = (objectId: number, axisKey: string, motorId: number | null) => {
    if (!bindAxis(objectId, axisKey, motorId)) {
      toast.warning("这台驱动单元和该物体已绑定的不在同一主控或同一个口");
    }
  };

  const heading = (
    <WizardStepHeading
      title="把每个吊点交给一台驱动单元"
      description="绑定只建立对应关系，不会让设备运动。绑定后，物体的动作才会下发到这些电机。"
    />
  );

  if (bindable.length === 0) {
    return (
      <div className="space-y-4">
        {heading}
        <EmptyState
          title="还没有需要绑定的吊点"
          detail="先添加一个要运动的受控物体。"
          actionLabel="去添加物体"
          onAction={() => onNavigate("objects")}
        />
      </div>
    );
  }

  if (motors.length === 0) {
    return (
      <div className="space-y-4">
        {heading}
        <EmptyState
          title="还没有驱动单元"
          detail="配置好主控和驱动单元后再来绑定。暂时没有设备，可以先去编排动作。"
          actionLabel="去配置主控与驱动"
          onAction={() => onNavigate("hardware")}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {heading}

      {unbound === 0 ? (
        <p className="rounded-md bg-muted px-3 py-2 text-body-md text-show">全部吊点已绑定</p>
      ) : plan.assignments.length > 0 ? (
        <div className="flex items-center justify-between gap-3 rounded-md bg-accent px-3 py-2">
          <p className="min-w-0 text-body-md text-foreground">
            还有 {unbound} 个吊点未绑定，可以按顺序自动分配
            {plan.unplacedAxisCount > 0 ? `，其中 ${plan.unplacedAxisCount} 个暂无可用的驱动单元` : ""}
          </p>
          <button type="button" className={wizardBtnPrimary} onClick={handleAutoBind}>
            自动绑定
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3 rounded-md bg-accent px-3 py-2">
          <p className="min-w-0 text-body-md text-warning">
            还有 {unbound} 个吊点未绑定，但没有可用的驱动单元
          </p>
          <button type="button" className={wizardBtnSecondary} onClick={() => onNavigate("hardware")}>
            去添加
          </button>
        </div>
      )}

      {bindable.map((object) => {
        const selected = multiSelectedIds.length === 1 && multiSelectedIds[0] === object.id;
        return (
          <section key={object.id} className="space-y-2 rounded-md bg-muted p-3">
            <button
              type="button"
              aria-pressed={selected}
              onClick={() => {
                select(object.id);
                setTreeFocus({ kind: "controlled-object", id: object.id });
              }}
              className={cn(
                "block min-h-9 w-full min-w-0 truncate rounded-sm px-1 text-left text-body-md font-medium hover:bg-accent",
                selected ? "text-primary" : "text-foreground",
              )}
            >
              {object.name}
              <span className="ml-2 font-normal text-muted-foreground">
                {CONTROL_TYPE_DEFINITION_BY_ID[object.controlType].label} ·{" "}
                {countBoundAxesOnObject(object, motors)}/{object.axes.length}
              </span>
            </button>
            <div className="grid grid-cols-2 gap-1">
              {object.axes.map((axis, index) => {
                const motorId = getMotorIdForAxis(object.id, axis.key, motors);
                const label = formatAxisLabel(index);
                return (
                  <div
                    key={axis.key}
                    className="flex min-w-0 items-center gap-2 rounded-md bg-input-background pl-3 pr-1"
                  >
                    <span
                      className={cn(
                        "shrink-0 font-mono text-mono-md tabular-nums",
                        motorId === null ? "text-warning" : "text-muted-foreground",
                      )}
                    >
                      {label}
                    </span>
                    <AxisMotorTreeSelect
                      objectId={object.id}
                      axisKey={axis.key}
                      value={motorId}
                      plcs={plcs}
                      motors={motors}
                      effectiveBindings={effectiveBindings}
                      size="md"
                      aria-label={`${object.name} ${label} 绑定电机`}
                      onChange={(next) => handleBind(object.id, axis.key, next)}
                    />
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      {objects.length > bindable.length ? (
        <p className="text-body-sm text-muted-foreground">
          另有 {objects.length - bindable.length} 个物体不需要绑定（无控制、轨道车）。
        </p>
      ) : null}
      <p className="text-body-sm text-muted-foreground">
        同一个物体的吊点要用同一主控、同一个口的驱动单元。熟悉之后，也可以把电机从工程结构直接拖到 3D 吊点上。
      </p>
    </div>
  );
};
