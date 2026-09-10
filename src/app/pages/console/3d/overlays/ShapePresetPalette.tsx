import {
  Box,
  Circle,
  CircleDot,
  Cylinder,
  Hexagon,
  Square,
  type LucideIcon,
} from "lucide-react";
import type { DragEvent } from "react";
import { cn } from "@/app/components/ui/utils";
import type { ShapePresetId } from "@/app/project/configuration-types";
import { PALETTE_SHAPE_DEFINITIONS } from "../../components/right-sidebar/config-wizard/config-descriptors";

export const SHAPE_PRESET_DRAG_TYPE = "application/x-console-shape-preset";

const SHAPE_ICONS: Record<Exclude<ShapePresetId, "external">, LucideIcon> = {
  cube: Box,
  cyl: Cylinder,
  sphere: Circle,
  ring: CircleDot,
  sqRing: Square,
  prism6: Hexagon,
};



const PRESET_BTN =
  "flex h-10 w-10 items-center justify-center transition-colors [&_svg]:size-4";

const PRESET_GROUP_CLASS =
  "pointer-events-auto flex flex-col overflow-hidden";

export const ShapePresetPalette = () => {
  const handleDragStart = (shapeId: ShapePresetId) => (event: DragEvent<HTMLButtonElement>) => {
    console.log("handleDragStart", SHAPE_PRESET_DRAG_TYPE, shapeId);
    event.dataTransfer.setData(SHAPE_PRESET_DRAG_TYPE, shapeId);
    event.dataTransfer.effectAllowed = "copy";
  };



  return (
    <div
      className="pointer-events-auto absolute right-3 top-1/2 flex -translate-y-1/2 flex-col"
      aria-label="几何预设"
    >
      <div className={PRESET_GROUP_CLASS}>
        {PALETTE_SHAPE_DEFINITIONS.map((preset) => {
          const Icon = SHAPE_ICONS[preset.id as Exclude<ShapePresetId, "external">];
          return (
            <button
              key={preset.id}
              type="button"
              draggable
              aria-label={`拖拽放置 ${preset.label}`}
              title={preset.label}
              onDragStart={handleDragStart(preset.id)}
              className={cn(
                PRESET_BTN,
                "cursor-grab text-muted-foreground hover:text-foreground active:cursor-grabbing"
              )}
            >

              <Icon aria-hidden />
            </button>
          );

        })}

      </div>

    </div>

  );

};


