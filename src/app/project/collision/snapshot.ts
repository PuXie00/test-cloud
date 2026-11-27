import { sceneConfigForObject } from "@/app/pages/console/3d/scene-object-config";
import type { ModelPose } from "../action-sequence/types";
import type { ProjectSetup } from "../project-document-types";
import { controlledObjectConfigToWizard } from "../setup-adapters";
import type { CollisionObject } from "./types";

export function snapshotCollisionObjects(
  objects: ProjectSetup["controlledObjects"],
  basePoses: ReadonlyMap<number, Partial<ModelPose>>,
): CollisionObject[] {
  return objects.map((object) => {
    const config = sceneConfigForObject(controlledObjectConfigToWizard(object));
    // 外模丢失时视窗显示占位方块，扫描仍须辨认其为缺失的外模。
    if (object.shapePreset === "external" && !config.model) config.model = { id: "" };
    return {
      id: object.id, name: object.name, config, modelKey: object.modelId,
      enabledAxes: object.enabledVirtualAxes,
      basePose: basePoses.get(object.id) ?? {},
    };
  });
}
