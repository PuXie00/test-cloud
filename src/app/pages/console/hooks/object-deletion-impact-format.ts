import type { ObjectDeletionImpact } from "@/app/project/project-object-deletion";

export type ObjectDeletionImpactView = {
  confirmLabel: string;
  summary: string;
  detailLines: string[];
  warningLines: string[];
};

const formatQuotedNames = (names: readonly string[]): string =>
  names.map((name) => `「${name}」`).join("、");

export const formatObjectDeletionImpact = (
  impact: ObjectDeletionImpact,
): ObjectDeletionImpactView => {
  const count = impact.objectIds.length;
  const names = impact.objectNames.length > 0
    ? impact.objectNames
    : impact.objectIds.map(String);
  const summary =
    count === 1
      ? `将删除「${names[0]}」。`
      : `将删除 ${count} 个受控物体：${formatQuotedNames(names)}。`;

  const detailLines: string[] = [];
  if (impact.motorBindingCount > 0) {
    detailLines.push(`将解绑 ${impact.motorBindingCount} 个电机。`);
  }
  if (impact.alignmentCount > 0) {
    detailLines.push(`将删除 ${impact.alignmentCount} 条对齐（alignment）记录。`);
  }
  if (impact.sceneGroupMemberCount > 0) {
    detailLines.push(
      `将从 ${impact.sceneGroupCount} 个场景组移除 ${impact.sceneGroupMemberCount} 个成员。`,
    );
  }
  if (impact.sequenceCount > 0) {
    detailLines.push(
      `将影响 ${impact.sequenceCount} 个动作序列（${impact.trackCount} 条轨道、${impact.blockCount} 个动作块）。`,
    );
  }

  const warningParts: string[] = [];
  if (impact.emptySequenceIds.length > 0) {
    warningParts.push(`${impact.emptySequenceIds.length} 个动作序列`);
  }
  const warningLines =
    warningParts.length > 0
      ? [`${warningParts.join("、")}将保留并标记为待修复。`]
      : [];

  return {
    confirmLabel: "删除",
    summary,
    detailLines,
    warningLines,
  };
};
