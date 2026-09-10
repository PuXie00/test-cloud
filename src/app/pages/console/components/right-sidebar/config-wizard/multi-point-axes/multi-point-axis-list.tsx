import { AlertTriangle, Trash2 } from "lucide-react";
import { useMemo } from "react";
import { NumericInputGroup } from "@/app/components/ics/numeric-input-group";
import { UnitAwareNumericInput } from "@/app/components/ics/unit-aware-numeric-input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/app/components/ui/tooltip";
import { cn } from "@/app/components/ui/utils";
import {
  listAxisBindingsFromMotors,
  type AxisBindingRef,
} from "@/app/pages/console/hooks/binding-utils";
import { AxisMotorTreeSelect } from "../axis-motor-tree-select";
import {
  AxisRowMoreMenu,
  type AxisInsertPosition,
} from "../axis-row-more-menu";
import { formatAxisLabel } from "../axis-utils";
import type { AxisDefinition, AxisMount, Motor, Plc } from "../config-wizard-types";
import {
  getEffectiveDraftMotorId,
  type MultiPointAxesDraft,
} from "./multi-point-axes-draft";

export type MultiPointAxisListProps = {
  axes: readonly AxisDefinition[];
  motors: readonly Motor[];
  plcs: readonly Plc[];
  objectId: number;
  draft: Pick<MultiPointAxesDraft, "unbindAxisKeys" | "pendingBinds">;
  selectedAxisKey: string | null;
  invalidAxisKeys: ReadonlySet<string>;
  minimumAxes: number;
  /** 存在时表示驱动轴数量上限；达到后禁用「添加/插入」 */
  maxAxes?: number;
  /** 圆形布局时坐标只读 */
  mountsReadOnly?: boolean;
  onSelect: (axisKey: string) => void;
  onMountChange: (axisKey: string, patch: Partial<AxisMount>) => void;
  onBindChange: (axisKey: string, motorId: number | null) => void;
  onInsertRelative: (axisKey: string, position: AxisInsertPosition) => void;
  onRemove: (axisKey: string) => void;
};

export const MultiPointAxisList = ({
  axes,
  motors,
  plcs,
  objectId,
  draft,
  selectedAxisKey,
  invalidAxisKeys,
  minimumAxes,
  maxAxes,
  mountsReadOnly = false,
  onSelect,
  onMountChange,
  onBindChange,
  onInsertRelative,
  onRemove,
}: MultiPointAxisListProps) => {
  const canDelete = axes.length > minimumAxes;
  const canAdd = maxAxes === undefined || axes.length < maxAxes;
  const effectiveBindings = useMemo((): AxisBindingRef[] => {
    const otherObjectBindings = listAxisBindingsFromMotors(motors).filter(
      (binding) => binding.objectId !== objectId,
    );
    const objectBindings = axes.flatMap((axis) => {
      const motorId = getEffectiveDraftMotorId(objectId, axis.key, motors, draft);
      return motorId
        ? [{ objectId, axisKey: axis.key, motorId }]
        : [];
    });
    return [...otherObjectBindings, ...objectBindings];
  }, [axes, draft, motors, objectId]);

  return (
    <div className="space-y-1">
      {axes.map((axis, index) => {
        const label = formatAxisLabel(index);
        const selected = axis.key === selectedAxisKey;
        const invalid = invalidAxisKeys.has(axis.key);
        const pendingUnbind = draft.unbindAxisKeys.includes(axis.key);
        const pendingBind = Boolean(draft.pendingBinds[axis.key]);
        const value = getEffectiveDraftMotorId(objectId, axis.key, motors, draft);
        const deleteLabel = value
          ? `删除 ${label}（应用后解绑）`
          : `删除 ${label}`;

        const deleteButton = (
          <button
            type="button"
            aria-label={deleteLabel}
            disabled={!canDelete}
            onClick={(event) => {
              event.stopPropagation();
              onRemove(axis.key);
            }}
            className={cn(
              "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground",
              canDelete
                ? "hover:bg-accent hover:text-destructive"
                : "cursor-not-allowed opacity-40",
            )}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
          </button>
        );

        return (
          <div
            key={axis.key}
            className="space-y-2 rounded-md bg-card px-3 py-2"
          >
            <div className="flex min-h-7 items-center gap-2">
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => onSelect(axis.key)}
                className="shrink-0 text-left text-body-sm text-foreground"
              >
                {label}
              </button>
              <AxisMotorTreeSelect
                objectId={objectId}
                axisKey={axis.key}
                value={value}
                plcs={plcs}
                motors={motors}
                effectiveBindings={effectiveBindings}
                pendingUnbind={pendingUnbind}
                pendingBind={pendingBind}
                aria-label={`${label} 绑定电机`}
                onChange={(motorId) => onBindChange(axis.key, motorId)}
              />
              {invalid ? (
                <span className="inline-flex items-center gap-1 text-body-sm text-warning">
                  <AlertTriangle className="h-3 w-3" aria-hidden />
                  越界
                </span>
              ) : null}
              <AxisRowMoreMenu
                axisLabel={label}
                disabled={!canAdd}
                onInsert={(position) => onInsertRelative(axis.key, position)}
              />
              {!canDelete ? (
                <Tooltip>
                  <TooltipTrigger asChild>{deleteButton}</TooltipTrigger>
                  <TooltipContent>
                    该控制类型至少需要 {minimumAxes} 个驱动轴
                  </TooltipContent>
                </Tooltip>
              ) : (
                deleteButton
              )}
            </div>
            <NumericInputGroup>
              <UnitAwareNumericInput
                prefix="X"
                value={axis.mount.x}
                step={1}
                precision={1}
                unit="mm"
                readOnly={mountsReadOnly}
                aria-label={`${label} X`}
                onChange={(xMm) => onMountChange(axis.key, { x: xMm })}
              />
              <UnitAwareNumericInput
                prefix="Z"
                value={axis.mount.z}
                step={1}
                precision={1}
                unit="mm"
                readOnly={mountsReadOnly}
                aria-label={`${label} Z`}
                onChange={(zMm) => onMountChange(axis.key, { z: zMm })}
              />
            </NumericInputGroup>
          </div>
        );
      })}
    </div>
  );
};
