import { NumericInputGroup } from "@/app/components/ics/numeric-input-group";
import { UnitAwareNumericInput } from "@/app/components/ics/unit-aware-numeric-input";
import type { ShapeDimensions, ShapePresetId } from "@/app/project/configuration-types";
import { scaleExternalDimensionsByWidth } from "@/app/viz3d/loaders/model-native-size";
import { SHAPE_DEFINITIONS } from "../config-wizard/config-descriptors";

type ShapeDimensionFieldsProps<T extends ShapePresetId> = {
  shape: T;
  values: Partial<ShapeDimensions<T>>;
  onChange: (values: ShapeDimensions<T>) => void;
};

export const ShapeDimensionFields = <T extends ShapePresetId>({
  shape,
  values,
  onChange,
}: ShapeDimensionFieldsProps<T>) => {
  const definition = SHAPE_DEFINITIONS.find((item) => item.id === shape);
  if (!definition) return null;

  const source = values as Record<string, number | undefined>;

  const handleFieldChange = (key: string, next: number) => {
    if (shape === "external") {
      if (key !== "width") return;
      const current = {
        width: source.width ?? 2000,
        height: source.height ?? 1000,
        depth: source.depth ?? 1500,
      };
      onChange(scaleExternalDimensionsByWidth(current, next) as ShapeDimensions<T>);
      return;
    }
    onChange({ ...values, [key]: next } as ShapeDimensions<T>);
  };

  return (
    <NumericInputGroup>
      {definition.fields.map((field) => {
        const readOnly = shape === "external" && field.key !== "width";
        return (
          <UnitAwareNumericInput
            key={field.key}
            prefix={field.label}
            aria-label={field.label}
            value={source[field.key] ?? field.defaultValue}
            onChange={(next) => handleFieldChange(field.key, next)}
            unit={field.unit}
            step={1}
            precision={1}
            readOnly={readOnly}
          />
        );
      })}
    </NumericInputGroup>
  );
};
