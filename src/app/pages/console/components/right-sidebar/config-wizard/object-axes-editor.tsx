import { useState } from "react";
import { ImageOff } from "lucide-react";
import { FormLabelHelp } from "@/app/components/ui/forms";
import { UnitAwareNumericInput } from "@/app/components/ics/unit-aware-numeric-input";
import { Select } from "@/app/components/ui/select";
import {
  CONTROL_TYPE_RULES,
  controlTypeHasNoDriveAxes,
} from "@/app/project/configuration-rules";
import {
  DEFAULT_MODEL_RUN_DIRECTION,
  MODEL_RUN_DIRECTION_OPTIONS,
  type ModelRunDirection,
} from "@/app/project/hoist-point-defaults";
import { useProjectStore } from "@/app/pages/console/hooks/use-project-store";
import type { AxisDefinition, ControlType } from "./config-wizard-types";
import { MultiPointAxesDialog } from "./multi-point-axes/multi-point-axes-dialog";
import {
  createMultiPointAxesDraft,
  validateMultiPointAxesDraft,
} from "./multi-point-axes/multi-point-axes-draft";
import { createShapeFootprint } from "./multi-point-axes/multi-point-axes-geometry";

const MODEL_RUN_DIRECTION_SELECT_OPTIONS = MODEL_RUN_DIRECTION_OPTIONS.map((option) => ({
  value: String(option.value),
  label: option.label,
}));

const PulleyDistanceHelp = () => (
  <div className="space-y-2">
    <p>
      滑轮出线点到最近行程端点的链条长度。该端点可能是原点，也可能是终点，取决于实际原点位置。
    </p>
    <p>图中实线为最短链长 Lmin，虚线为轴的有效行程。</p>
    <div className="flex h-28 w-full items-center justify-center rounded-md bg-input-background">
      <div className="flex flex-col items-center gap-1 text-muted-foreground">
        <ImageOff className="h-5 w-5" aria-hidden />
        <span className="text-mono-sm">示意图待补充</span>
      </div>
    </div>
  </div>
);

type ObjectAxesEditorProps = {
  objectId: number;
  controlType: ControlType;
  axes: AxisDefinition[];
};

export const ObjectAxesEditor = ({ objectId, controlType, axes }: ObjectAxesEditorProps) => {
  const { findObject, updateObject, motors, plcs, applyMultiPointAxesConfiguration } =
    useProjectStore();
  const [multiPointDialogOpen, setMultiPointDialogOpen] = useState(false);
  const [initialSelectedAxisKey, setInitialSelectedAxisKey] = useState<string | null>(null);
  const minimumAxes = CONTROL_TYPE_RULES[controlType].minimumDriveAxes;
  const object = findObject(objectId);
  const isMultiPointSwing = controlType === "multiPointSwing";
  const multiPointIssues =
    isMultiPointSwing && object
      ? validateMultiPointAxesDraft(
          createMultiPointAxesDraft(object),
          createShapeFootprint(object),
          minimumAxes,
        )
      : [];

  const handleOpenMultiPointDialog = (axisKey?: string) => {
    setInitialSelectedAxisKey(axisKey ?? null);
    setMultiPointDialogOpen(true);
  };

  const handleMultiPointDialogOpenChange = (open: boolean) => {
    setMultiPointDialogOpen(open);
    if (!open) setInitialSelectedAxisKey(null);
  };

  if (controlTypeHasNoDriveAxes(controlType)) {
    return (
      <div className="rounded-md bg-muted p-4">
        <p className="text-body-sm text-muted-foreground">该控制类型无需驱动轴</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <span className="text-body-sm text-muted-foreground">模型运行方向</span>
        <Select
          aria-label="模型运行方向"
          value={String(object?.modelRunDirection ?? DEFAULT_MODEL_RUN_DIRECTION)}
          options={MODEL_RUN_DIRECTION_SELECT_OPTIONS}
          onValueChange={(next) =>
            updateObject(objectId, {
              modelRunDirection: (Number(next) === 2 ? 2 : 1) as ModelRunDirection,
            })
          }
        />
      </div>

      <div className="space-y-1">
        <FormLabelHelp label="轴链条最短长度" labelTitle={<PulleyDistanceHelp />} />
        <UnitAwareNumericInput
          value={object?.pulleyDistance ?? 0}
          min={0}
          step={1}
          precision={0}
          unit="mm"
          aria-label="轴链条最短长度"
          onChange={(pulleyDistance) =>
            updateObject(objectId, { pulleyDistance: Math.max(0, pulleyDistance) })
          }
        />
      </div>

      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-label-caps text-muted-foreground">吊点配置</p>
          <p className="mt-0.5 text-body-sm text-muted-foreground">
            至少 {minimumAxes} 吊点 · 当前 {axes.length} 吊点
          </p>
        </div>
      </div>

      {multiPointIssues.length > 0 ? (
        <ul className="space-y-1 rounded-md bg-input-background px-3 py-2">
          {multiPointIssues.map((issue) => (
            <li
              key={`${issue.code}-${issue.axisKey ?? "global"}-${issue.message}`}
              className="text-body-sm text-warning"
            >
              {issue.axisKey ? (
                <button
                  type="button"
                  className="text-left text-warning underline-offset-2 hover:underline"
                  onClick={() => handleOpenMultiPointDialog(issue.axisKey)}
                >
                  {issue.message}
                </button>
              ) : (
                issue.message
              )}
            </li>
          ))}
        </ul>
      ) : null}

      <button
        type="button"
        onClick={() => handleOpenMultiPointDialog()}
        className="inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-3 text-body-sm font-semibold text-primary-foreground hover:bg-primary/90"
      >
        打开吊点配置
      </button>

      {object ? (
        <MultiPointAxesDialog
          open={multiPointDialogOpen}
          object={object}
          motors={motors}
          plcs={plcs}
          initialSelectedAxisKey={initialSelectedAxisKey}
          onOpenChange={handleMultiPointDialogOpenChange}
          onApply={(input) => applyMultiPointAxesConfiguration(object.id, input)}
        />
      ) : null}
    </div>
  );
};
