import type { SequenceIssue } from "./validate-sequence";
import { getPresetDefinition, presetParamLabelOf } from "./preset-registry";

const AXIS_LABEL: Record<string, string> = {
  v1: "虚轴1",
  v2: "虚轴2",
  v3: "虚轴3",
};

const objectPrefix = (
  objectId: number | undefined,
  objectName?: (id: number) => string | undefined,
): string => {
  if (objectId === undefined) return "";
  return `${objectName?.(objectId) ?? `模型 ${objectId}`} `;
};

const translateParamConstraint = (rest: string): string => {
  if (rest === "must be a number") return "必须为数字";
  if (rest === "must be finite") return "必须为有限数字";
  if (rest === "must be > 0") return "必须大于 0";
  if (rest === "must be 1 or -1") return "必须为正向或反向";
  return rest;
};

export const formatPresetRepairMessage = (
  issue: SequenceIssue,
  options?: {
    presetId?: string;
    objectName?: (id: number) => string | undefined;
  },
): string => {
  const who = objectPrefix(issue.objectId, options?.objectName);
  const paramLabel = (key: string): string =>
    options?.presetId ? presetParamLabelOf(options.presetId, key) : key;

  if (issue.code === "limit-exceeded") {
    const position = issue.message.match(/axis (v[123]) position (.+) outside \[(.+), (.+)\]/);
    if (position) {
      const [, axis, value, min, max] = position;
      return `${who}${AXIS_LABEL[axis ?? ""] ?? axis} 位姿 ${value} 超出范围 [${min}, ${max}]`;
    }
    const velocity = issue.message.match(/axis (v[123]) velocity (.+) exceeds (.+)/);
    if (velocity) {
      const [, axis, value, max] = velocity;
      return `${who}${AXIS_LABEL[axis ?? ""] ?? axis} 速度 ${value} 超过上限 ${max}`;
    }
  }

  if (issue.code === "invalid-preset") {
    const missing = issue.message.match(/missing parameter: (\S+)/);
    if (missing?.[1]) return `缺少参数「${paramLabel(missing[1])}」`;
    const unknown = issue.message.match(/unknown parameter: (\S+)/);
    if (unknown?.[1]) return `未知参数「${paramLabel(unknown[1])}」`;
    const typed = issue.message.match(/^parameter (\S+) (.+)$/);
    if (typed?.[1] && typed[2]) {
      return `参数「${paramLabel(typed[1])}」${translateParamConstraint(typed[2])}`;
    }
    if (issue.message.includes("exactly 1 pose per object")) return "静态预设必须每物体恰好 1 个位姿";
    if (issue.message.includes("at least 2 poses per object")) return "动态预设必须每物体至少 2 个位姿";
  }

  if (issue.code === "invalid-dynamic-range") return "结束时间必须大于开始时间";
  if (issue.code === "insufficient-cruise") {
    return `${who}加速与减速无法放入当前区间`.trim();
  }
  if (issue.code === "phase-shorter-than-min-accel") {
    return `${who}加减速短于最短加减速时间`.trim();
  }
  if (issue.code === "idle-on-moving-axis") return `${who}运动轴处于空闲曲线`.trim();
  if (issue.code === "missing-motion-limit") return `${who}缺少速度或最短加减速上限`.trim();
  if (issue.code === "motor-overspeed") return issue.message;
  if (issue.code === "motion-overlap") return `${who}运动来源重叠`.trim();

  return who ? `${who}${issue.message}`.trim() : issue.message;
};

export const collectBlockRepairIssues = (
  issues: readonly SequenceIssue[] | undefined,
  blockId: string,
): SequenceIssue[] => (issues ?? []).filter((issue) => issue.blockId === blockId && issue.severity === "error");

export const formatBlockRepairItems = (
  issues: readonly SequenceIssue[] | undefined,
  blockId: string,
  options?: {
    presetId?: string;
    objectName?: (id: number) => string | undefined;
  },
): string[] => {
  const items: string[] = [];
  const seen = new Set<string>();
  for (const issue of collectBlockRepairIssues(issues, blockId)) {
    const text = formatPresetRepairMessage(issue, options);
    if (seen.has(text)) continue;
    seen.add(text);
    items.push(text);
  }
  return items;
};

export const localPresetParamIssues = (
  presetId: string,
  params: Record<string, import("./types").PresetParamValue>,
): SequenceIssue[] => {
  const definition = getPresetDefinition(presetId);
  if (!definition) {
    return [
      {
        severity: "error",
        code: "invalid-preset",
        message: `unavailable preset definition ${presetId}`,
      },
    ];
  }
  return definition.validateParams(params).map((message) => ({
    severity: "error" as const,
    code: "invalid-preset" as const,
    message,
  }));
};
