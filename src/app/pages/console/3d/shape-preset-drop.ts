import type { ShapePresetId } from "@/app/project/configuration-types";
import {
  PALETTE_SHAPE_DEFINITIONS,
  toEngineDimensions,
} from "../components/right-sidebar/config-wizard/config-descriptors";
import { SHAPE_PRESET_DRAG_TYPE } from "./overlays/ShapePresetPalette";

const paletteShapeIds = new Set(PALETTE_SHAPE_DEFINITIONS.map((shape) => shape.id));

export const isShapePresetDrag = (dataTransfer: DataTransfer): boolean =>
  dataTransfer.types.includes(SHAPE_PRESET_DRAG_TYPE);

export const readShapePresetDrag = (dataTransfer: DataTransfer): ShapePresetId | null => {
  const raw = dataTransfer.getData(SHAPE_PRESET_DRAG_TYPE);
  if (!raw || !paletteShapeIds.has(raw as ShapePresetId)) {
    return null;
  }
  return raw as ShapePresetId;
};

export const placementYForShape = (shapeId: ShapePresetId): number => {
  const definition = PALETTE_SHAPE_DEFINITIONS.find((shape) => shape.id === shapeId);
  if (!definition) return 4;

  const shapeDimensions = Object.fromEntries(
    definition.fields.map((field) => [field.key, field.defaultValue]),
  ) as Parameters<typeof toEngineDimensions>[1];

  return toEngineDimensions(shapeId, shapeDimensions).h / 2;
};
