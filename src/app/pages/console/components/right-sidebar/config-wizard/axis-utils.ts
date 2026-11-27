import { controlTypeHasMultiPointSwingParams, ensureMinimumDriveAxes } from "@/app/project/configuration-rules";
import type { ControlType } from "@/app/project/configuration-types";
import { defaultMountForAxisIndex } from "@/app/project/hoist-point-defaults";
import type { AxisDefinition, ControlledObject } from "./config-wizard-types";

export const formatAxisLabel = (index: number): string => `吊${index + 1}`;

export const buildTemplateAxes = (
  template: { key: string }[],
  controlType: ControlType,
): AxisDefinition[] =>
  template.map((axis, index) => ({
    key: axis.key,
    custom: false,
    mount: defaultMountForAxisIndex(controlType, index),
  }));

export const axesForControlTypeChange = (
  object: ControlledObject,
  controlType: ControlType,
): AxisDefinition[] => {
  const existing = object.axes;
  const template = ensureMinimumDriveAxes(controlType, []);
  if (controlTypeHasMultiPointSwingParams(object.controlType) && controlTypeHasMultiPointSwingParams(controlType)) {
    // 多点模型共用吊点配置，目标模板只负责补足最低数量。
    const missing = template.length - existing.length;
    if (missing <= 0) return existing;
    const keys = new Set(existing.map(axis => axis.key));
    const additions = buildTemplateAxes(template, controlType).filter(axis => !keys.has(axis.key));
    return [...existing, ...additions.slice(0, missing)];
  }
  const bindings = new Map(existing.map((axis) => [axis.key, axis]));
  const templateKeySet = new Set(template.map((axis) => axis.key));
  const templateAxes = template.map((axis, index) => {
    const prior = bindings.get(axis.key);
    return {
      key: axis.key,
      custom: false,
      mount: prior?.mount ?? defaultMountForAxisIndex(controlType, index),
    };
  });
  // 模板已占用的 key 只保留模板位（mount 已从 prior 合并），避免与 custom 吊点重复
  const customAxes = existing
    .filter((axis) => axis.custom && !templateKeySet.has(axis.key))
    .map((axis) => ({
      ...axis,
      mount: axis.mount ?? { x: 0, z: 0 },
    }));
  return [...templateAxes, ...customAxes];
};

export const buildAxesForControlType = (controlType: ControlType): AxisDefinition[] =>
  buildTemplateAxes(
    ensureMinimumDriveAxes(controlType, []).map((axis) => ({ key: axis.key })),
    controlType,
  );
