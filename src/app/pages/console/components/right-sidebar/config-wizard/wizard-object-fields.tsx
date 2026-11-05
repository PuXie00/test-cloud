import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import { normalizeMotionAxisParams } from "@/app/project/motion-acceleration";
import { motionAxisIdForKind } from "@/app/project/virtual-axis-mapping";
import { STROKE_LIMITS } from "@/app/project/stroke-limits";
import type { MotionAxisKind, MotionAxisParams, ShapePresetId } from "@/app/project/configuration-types";
import { useProjectStore } from "@/app/pages/console/hooks/use-project-store";
import { MotionAxisRangeField } from "../property-forms/motion-axis-range-field";
import { ObjectControlTypeField } from "../property-forms/object-control-type-field";
import { ShapeDimensionFields } from "../property-forms/shape-dimension-fields";
import {
  CONTROL_TYPE_DEFINITION_BY_ID,
  defaultShapeDimensions,
  MOTION_DEFAULTS,
  PALETTE_SHAPE_DEFINITIONS,
  toEngineDimensions,
} from "./config-descriptors";
import type { ControlledObject } from "./config-wizard-types";

const SHAPE_OPTIONS = PALETTE_SHAPE_DEFINITIONS.map((shape) => ({
  label: shape.label,
  value: shape.id,
}));

const fieldLabelClass = "text-body-sm text-muted-foreground";

/** 向导里只留第一次搭建要决定的几项，其余参数在「工程结构 → 属性」 */
export const WizardObjectFields = ({ object }: { object: ControlledObject }) => {
  const { updateObject } = useProjectStore();
  const motionAxes = CONTROL_TYPE_DEFINITION_BY_ID[object.controlType].motionAxes;

  const handleShapeChange = (shapePreset: ShapePresetId) => {
    const shapeDimensions = defaultShapeDimensions(shapePreset);
    updateObject(object.id, {
      shapePreset,
      shapeDimensions,
      dimensions: toEngineDimensions(shapePreset, shapeDimensions),
      modelId: undefined,
    });
  };

  const handleRangeChange = (axis: MotionAxisKind, value: MotionAxisParams) => {
    updateObject(object.id, {
      motionParams: {
        ...object.motionParams,
        [motionAxisIdForKind(axis)]: normalizeMotionAxisParams(value),
      },
    });
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <label className="min-w-0 space-y-1">
          <span className={fieldLabelClass}>名称</span>
          <Input
            name="name"
            aria-label="名称"
            value={object.name}
            onChange={(event) => updateObject(object.id, { name: event.target.value })}
          />
        </label>
        <div className="min-w-0 space-y-1">
          <span className={fieldLabelClass}>运动方式</span>
          <ObjectControlTypeField objectId={object.id} value={object.controlType} />
        </div>
      </div>

      <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3">
        <div className="min-w-0 space-y-1">
          <span className={fieldLabelClass}>形状</span>
          {object.shapePreset === "external" ? (
            <p className="flex h-9 items-center text-body-sm text-foreground">外部模型</p>
          ) : (
            <Select
              aria-label="形状"
              options={SHAPE_OPTIONS}
              value={object.shapePreset}
              onValueChange={(value) => handleShapeChange(value as ShapePresetId)}
            />
          )}
        </div>
        <div className="min-w-0 space-y-1">
          <span className={fieldLabelClass}>尺寸</span>
          <ShapeDimensionFields
            shape={object.shapePreset}
            values={object.shapeDimensions ?? {}}
            onChange={(shapeDimensions) =>
              updateObject(object.id, {
                shapeDimensions,
                dimensions: toEngineDimensions(object.shapePreset, shapeDimensions),
              })
            }
          />
        </div>
      </div>

      {motionAxes.map((axis) => (
        <MotionAxisRangeField
          key={axis}
          axis={axis}
          value={object.motionParams?.[motionAxisIdForKind(axis)] ?? MOTION_DEFAULTS[axis]}
          onChange={(value) => handleRangeChange(axis, value)}
          limits={STROKE_LIMITS[object.controlType][motionAxisIdForKind(axis)]}
        />
      ))}
    </div>
  );
};
