import {
  CONTROL_TYPE_RULES,
  nextDriveAxisKey,
} from "@/app/project/configuration-rules";
import {
  MAX_INITIAL_TILT_DIRECTION,
  MAX_MOUNT_ROTATION,
  normalizeInitialTiltDirection,
  normalizeMountRotation,
  normalizeSafetyRadius,
} from "@/app/project/hoist-point-defaults";
import type { MountLayout } from "@/app/project/project-document-types";
import { getMotorIdForAxis } from "@/app/pages/console/hooks/binding-utils";
import type { AxisDefinition, AxisMount, ControlledObject, Motor } from "../config-wizard-types";
import {
  averageMountRadius,
  resolveCircleMountLayout,
  rotateMountAroundOrigin,
} from "./multi-point-axes-circle-layout";
import { resolveLineMountLayout } from "./multi-point-axes-line-layout";
import {
  createNextAxisMount,
  createRelativeAxisMount,
  isPointInsideFootprint,
  type ShapeFootprint,
} from "./multi-point-axes-geometry";
import { applyDistributedMounts } from "./multi-point-axes-distribute";

export type DraftMountLayoutCustom = { kind: "custom" };

export type DraftMountLayoutCircle = {
  kind: "circle";
  radius: number | null;
  chordLengths: Array<number | null>;
};

export type DraftMountLayoutLine = {
  kind: "line";
  spacings: Array<number | null>;
};

export type DraftMountLayout =
  | DraftMountLayoutCustom
  | DraftMountLayoutCircle
  | DraftMountLayoutLine;

export type MultiPointAxesDraft = {
  safetyRadius: number;
  initialTiltDirection: number;
  mountRotation: number;
  mountLayout: DraftMountLayout;
  axes: AxisDefinition[];
  unbindAxisKeys: string[];
  /** axisKey → motorId，待绑定或改绑 */
  pendingBinds: Record<string, number>;
};

export type MultiPointAxesValidationIssue = {
  code:
    | "minimum-axes"
    | "duplicate-key"
    | "invalid-coordinate"
    | "outside-footprint"
    | "invalid-safety-radius"
    | "invalid-initial-tilt"
    | "invalid-mount-rotation"
    | "incomplete-circle-layout"
    | "invalid-circle-layout"
    | "invalid-line-layout";
  message: string;
  axisKey?: string;
};

const MINIMUM_DRIVE_AXES = CONTROL_TYPE_RULES.multiPointSwing.minimumDriveAxes;

const cloneAxes = (axes: readonly AxisDefinition[]): AxisDefinition[] =>
  axes.map((axis) => ({
    ...axis,
    mount: { ...axis.mount },
  }));

const clonePendingBinds = (
  pendingBinds: Record<string, number>,
): Record<string, number> => ({ ...pendingBinds });

const cloneMountLayout = (layout: DraftMountLayout): DraftMountLayout => {
  if (layout.kind === "custom") return { kind: "custom" };
  if (layout.kind === "circle") {
    return {
      kind: "circle",
      radius: layout.radius,
      chordLengths: [...layout.chordLengths],
    };
  }
  return { kind: "line", spacings: [...layout.spacings] };
};

const emptyChordLengths = (count: number): Array<number | null> =>
  Array.from({ length: count }, () => null);

const emptyLineSpacings = (count: number): Array<number | null> =>
  Array.from({ length: Math.max(0, count - 1) }, () => null);

export const resizeChordLengths = (
  chords: ReadonlyArray<number | null>,
  count: number,
): Array<number | null> => {
  if (count <= 0) return [];
  return Array.from({ length: count }, (_, index) => chords[index] ?? null);
};

export const resizeLineSpacings = (
  spacings: ReadonlyArray<number | null>,
  count: number,
): Array<number | null> => {
  const target = Math.max(0, count - 1);
  if (target === 0) return [];
  return Array.from({ length: target }, (_, index) => spacings[index] ?? null);
};

export const toDraftMountLayout = (
  layout: MountLayout | undefined,
  axisCount: number,
): DraftMountLayout => {
  if (!layout || layout.kind === "custom") return { kind: "custom" };
  if (layout.kind === "circle") {
    return {
      kind: "circle",
      radius: layout.radius,
      chordLengths: resizeChordLengths(layout.chordLengths, axisCount),
    };
  }
  return {
    kind: "line",
    spacings: resizeLineSpacings(layout.spacings, axisCount),
  };
};

export const toPersistedMountLayout = (
  layout: DraftMountLayout,
): MountLayout => {
  if (layout.kind === "custom") return { kind: "custom" };
  if (layout.kind === "circle") {
    return {
      kind: "circle",
      radius: layout.radius as number,
      chordLengths: layout.chordLengths.map((chord) => chord as number),
    };
  }
  return {
    kind: "line",
    spacings: layout.spacings.map((spacing) => spacing as number),
  };
};

const withSyncedCircleMounts = (draft: MultiPointAxesDraft): MultiPointAxesDraft => {
  if (draft.mountLayout.kind !== "circle") return draft;
  const resolved = resolveCircleMountLayout(
    draft.mountLayout.radius,
    draft.mountLayout.chordLengths,
    { mountRotation: draft.mountRotation },
  );
  if (!resolved.ok) return draft;
  return {
    ...draft,
    axes: applyDistributedMounts(draft.axes, resolved.mounts),
  };
};

const withSyncedLineMounts = (draft: MultiPointAxesDraft): MultiPointAxesDraft => {
  if (draft.mountLayout.kind !== "line") return draft;
  const resolved = resolveLineMountLayout(
    draft.mountLayout.spacings,
    draft.axes.length,
    { mountRotation: draft.mountRotation },
  );
  if (!resolved.ok) return draft;
  return {
    ...draft,
    axes: applyDistributedMounts(draft.axes, resolved.mounts),
  };
};

const withResizedMountLayout = (
  draft: MultiPointAxesDraft,
  axisCount: number,
): MultiPointAxesDraft => {
  if (draft.mountLayout.kind === "circle") {
    return withSyncedCircleMounts({
      ...draft,
      mountLayout: {
        kind: "circle",
        radius: draft.mountLayout.radius,
        chordLengths: resizeChordLengths(draft.mountLayout.chordLengths, axisCount),
      },
    });
  }
  if (draft.mountLayout.kind === "line") {
    return withSyncedLineMounts({
      ...draft,
      mountLayout: {
        kind: "line",
        spacings: resizeLineSpacings(draft.mountLayout.spacings, axisCount),
      },
    });
  }
  return {
    ...draft,
    mountLayout: cloneMountLayout(draft.mountLayout),
  };
};

export const createMultiPointAxesDraft = (
  object: ControlledObject,
): MultiPointAxesDraft => ({
  safetyRadius: normalizeSafetyRadius(object.safetyRadius),
  initialTiltDirection: normalizeInitialTiltDirection(object.initialTiltDirection),
  mountRotation: normalizeMountRotation(object.mountRotation),
  mountLayout: toDraftMountLayout(object.mountLayout, object.axes.length),
  axes: cloneAxes(object.axes),
  unbindAxisKeys: [],
  pendingBinds: {},
});

export const addDraftAxis = (draft: MultiPointAxesDraft): MultiPointAxesDraft => {
  const mount = createNextAxisMount(draft.axes);
  const axes = [
    ...cloneAxes(draft.axes),
    {
      key: nextDriveAxisKey(draft.axes),
      custom: true,
      mount,
    },
  ];
  return withResizedMountLayout(
    {
      ...draft,
      axes,
      unbindAxisKeys: [...draft.unbindAxisKeys],
      pendingBinds: clonePendingBinds(draft.pendingBinds),
    },
    axes.length,
  );
};

export const insertDraftAxisRelative = (
  draft: MultiPointAxesDraft,
  anchorAxisKey: string,
  position: "before" | "after",
): MultiPointAxesDraft => {
  const anchorIndex = draft.axes.findIndex((axis) => axis.key === anchorAxisKey);
  if (anchorIndex < 0) return draft;

  const insertAt = position === "before" ? anchorIndex : anchorIndex + 1;
  const axis: AxisDefinition = {
    key: nextDriveAxisKey(draft.axes),
    custom: true,
    mount: createRelativeAxisMount(draft.axes, anchorIndex, position),
  };
  const axes = cloneAxes(draft.axes);
  axes.splice(insertAt, 0, axis);

  return withResizedMountLayout(
    {
      ...draft,
      axes,
      unbindAxisKeys: [...draft.unbindAxisKeys],
      pendingBinds: clonePendingBinds(draft.pendingBinds),
    },
    axes.length,
  );
};

export const updateDraftAxisMount = (
  draft: MultiPointAxesDraft,
  axisKey: string,
  patch: Partial<AxisMount>,
): MultiPointAxesDraft => ({
  ...draft,
  mountLayout: cloneMountLayout(draft.mountLayout),
  axes: draft.axes.map((axis) =>
    axis.key === axisKey
      ? { ...axis, mount: { ...axis.mount, ...patch } }
      : { ...axis, mount: { ...axis.mount } },
  ),
  unbindAxisKeys: [...draft.unbindAxisKeys],
  pendingBinds: clonePendingBinds(draft.pendingBinds),
});

export const removeDraftAxis = (
  draft: MultiPointAxesDraft,
  axisKey: string,
  minimumAxes: number = MINIMUM_DRIVE_AXES,
): MultiPointAxesDraft => {
  if (draft.axes.length <= minimumAxes) return draft;
  if (!draft.axes.some((axis) => axis.key === axisKey)) return draft;

  const pendingBinds = clonePendingBinds(draft.pendingBinds);
  delete pendingBinds[axisKey];

  const axes = draft.axes
    .filter((axis) => axis.key !== axisKey)
    .map((axis) => ({ ...axis, mount: { ...axis.mount } }));

  return withResizedMountLayout(
    {
      ...draft,
      axes,
      unbindAxisKeys: draft.unbindAxisKeys.filter((key) => key !== axisKey),
      pendingBinds,
    },
    axes.length,
  );
};

export const setDraftMountLayoutKind = (
  draft: MultiPointAxesDraft,
  kind: DraftMountLayout["kind"],
): MultiPointAxesDraft => {
  if (kind === "custom") {
    return {
      ...draft,
      mountLayout: { kind: "custom" },
      axes: cloneAxes(draft.axes),
      unbindAxisKeys: [...draft.unbindAxisKeys],
      pendingBinds: clonePendingBinds(draft.pendingBinds),
    };
  }

  if (draft.mountLayout.kind === kind) {
    return {
      ...draft,
      mountLayout: cloneMountLayout(draft.mountLayout),
      axes: cloneAxes(draft.axes),
      unbindAxisKeys: [...draft.unbindAxisKeys],
      pendingBinds: clonePendingBinds(draft.pendingBinds),
    };
  }

  if (kind === "line") {
    return withSyncedLineMounts({
      ...draft,
      mountLayout: {
        kind: "line",
        spacings: emptyLineSpacings(draft.axes.length),
      },
      axes: cloneAxes(draft.axes),
      unbindAxisKeys: [...draft.unbindAxisKeys],
      pendingBinds: clonePendingBinds(draft.pendingBinds),
    });
  }

  const radius = averageMountRadius(draft.axes.map((axis) => axis.mount));
  return withSyncedCircleMounts({
    ...draft,
    mountLayout: {
      kind: "circle",
      radius: radius > 0 ? radius : null,
      chordLengths: emptyChordLengths(draft.axes.length),
    },
    axes: cloneAxes(draft.axes),
    unbindAxisKeys: [...draft.unbindAxisKeys],
    pendingBinds: clonePendingBinds(draft.pendingBinds),
  });
};

export const updateDraftMountRotation = (
  draft: MultiPointAxesDraft,
  mountRotation: number,
): MultiPointAxesDraft => {
  const next = normalizeMountRotation(mountRotation);
  const delta = next - draft.mountRotation;
  if (delta === 0) return draft;

  if (draft.mountLayout.kind === "circle") {
    return withSyncedCircleMounts({
      ...draft,
      mountRotation: next,
      axes: cloneAxes(draft.axes),
      unbindAxisKeys: [...draft.unbindAxisKeys],
      pendingBinds: clonePendingBinds(draft.pendingBinds),
    });
  }

  if (draft.mountLayout.kind === "line") {
    return withSyncedLineMounts({
      ...draft,
      mountRotation: next,
      axes: cloneAxes(draft.axes),
      unbindAxisKeys: [...draft.unbindAxisKeys],
      pendingBinds: clonePendingBinds(draft.pendingBinds),
    });
  }

  return {
    ...draft,
    mountRotation: next,
    mountLayout: cloneMountLayout(draft.mountLayout),
    axes: draft.axes.map((axis) => ({
      ...axis,
      mount: rotateMountAroundOrigin(axis.mount, delta),
    })),
    unbindAxisKeys: [...draft.unbindAxisKeys],
    pendingBinds: clonePendingBinds(draft.pendingBinds),
  };
};

export const updateDraftCircleRadius = (
  draft: MultiPointAxesDraft,
  radius: number | null,
): MultiPointAxesDraft => {
  if (draft.mountLayout.kind !== "circle") return draft;
  return withSyncedCircleMounts({
    ...draft,
    mountLayout: {
      kind: "circle",
      radius,
      chordLengths: [...draft.mountLayout.chordLengths],
    },
    axes: cloneAxes(draft.axes),
    unbindAxisKeys: [...draft.unbindAxisKeys],
    pendingBinds: clonePendingBinds(draft.pendingBinds),
  });
};

export const updateDraftCircleChord = (
  draft: MultiPointAxesDraft,
  index: number,
  value: number | null,
): MultiPointAxesDraft => {
  if (draft.mountLayout.kind !== "circle") return draft;
  if (index < 0 || index >= draft.mountLayout.chordLengths.length) return draft;
  const chordLengths = [...draft.mountLayout.chordLengths];
  chordLengths[index] = value;
  return withSyncedCircleMounts({
    ...draft,
    mountLayout: {
      kind: "circle",
      radius: draft.mountLayout.radius,
      chordLengths,
    },
    axes: cloneAxes(draft.axes),
    unbindAxisKeys: [...draft.unbindAxisKeys],
    pendingBinds: clonePendingBinds(draft.pendingBinds),
  });
};

export const applyFirstCircleChordToAll = (
  draft: MultiPointAxesDraft,
): MultiPointAxesDraft => {
  if (draft.mountLayout.kind !== "circle") return draft;
  const first = draft.mountLayout.chordLengths[0];
  if (typeof first !== "number" || !Number.isFinite(first) || first <= 0) {
    return draft;
  }
  return withSyncedCircleMounts({
    ...draft,
    mountLayout: {
      kind: "circle",
      radius: draft.mountLayout.radius,
      chordLengths: draft.mountLayout.chordLengths.map(() => first),
    },
    axes: cloneAxes(draft.axes),
    unbindAxisKeys: [...draft.unbindAxisKeys],
    pendingBinds: clonePendingBinds(draft.pendingBinds),
  });
};

export const updateDraftLineSpacing = (
  draft: MultiPointAxesDraft,
  index: number,
  value: number | null,
): MultiPointAxesDraft => {
  if (draft.mountLayout.kind !== "line") return draft;
  if (index < 0 || index >= draft.mountLayout.spacings.length) return draft;
  const spacings = [...draft.mountLayout.spacings];
  spacings[index] = value;
  return withSyncedLineMounts({
    ...draft,
    mountLayout: { kind: "line", spacings },
    axes: cloneAxes(draft.axes),
    unbindAxisKeys: [...draft.unbindAxisKeys],
    pendingBinds: clonePendingBinds(draft.pendingBinds),
  });
};

export const applyFirstLineSpacingToAll = (
  draft: MultiPointAxesDraft,
): MultiPointAxesDraft => {
  if (draft.mountLayout.kind !== "line") return draft;
  const first = draft.mountLayout.spacings[0];
  if (typeof first !== "number" || !Number.isFinite(first) || first <= 0) {
    return draft;
  }
  return withSyncedLineMounts({
    ...draft,
    mountLayout: {
      kind: "line",
      spacings: draft.mountLayout.spacings.map(() => first),
    },
    axes: cloneAxes(draft.axes),
    unbindAxisKeys: [...draft.unbindAxisKeys],
    pendingBinds: clonePendingBinds(draft.pendingBinds),
  });
};

export const toggleDraftAxisUnbind = (
  draft: MultiPointAxesDraft,
  axisKey: string,
): MultiPointAxesDraft => {
  const isPending = draft.unbindAxisKeys.includes(axisKey);
  const pendingBinds = clonePendingBinds(draft.pendingBinds);
  delete pendingBinds[axisKey];
  return {
    ...draft,
    mountLayout: cloneMountLayout(draft.mountLayout),
    axes: cloneAxes(draft.axes),
    unbindAxisKeys: isPending
      ? draft.unbindAxisKeys.filter((key) => key !== axisKey)
      : [...draft.unbindAxisKeys, axisKey],
    pendingBinds,
  };
};

/** 设置待绑定/改绑；若等于工程当前绑定则清除 pending */
export const setDraftAxisBind = (
  draft: MultiPointAxesDraft,
  objectId: number,
  axisKey: string,
  motorId: number,
  motors: readonly Motor[],
): MultiPointAxesDraft => {
  const engineeringId = getMotorIdForAxis(objectId, axisKey, motors);
  const pendingBinds = clonePendingBinds(draft.pendingBinds);
  if (motorId === engineeringId) {
    delete pendingBinds[axisKey];
  } else {
    pendingBinds[axisKey] = motorId;
  }
  return {
    ...draft,
    mountLayout: cloneMountLayout(draft.mountLayout),
    axes: cloneAxes(draft.axes),
    unbindAxisKeys: draft.unbindAxisKeys.filter((key) => key !== axisKey),
    pendingBinds,
  };
};

/** 标记解绑并清除该轴 pending 绑定 */
export const setDraftAxisUnbind = (
  draft: MultiPointAxesDraft,
  objectId: number,
  axisKey: string,
  motors: readonly Motor[],
): MultiPointAxesDraft => {
  const engineeringId = getMotorIdForAxis(objectId, axisKey, motors);
  const pendingBinds = clonePendingBinds(draft.pendingBinds);
  delete pendingBinds[axisKey];

  if (!engineeringId) {
    return {
      ...draft,
      mountLayout: cloneMountLayout(draft.mountLayout),
      axes: cloneAxes(draft.axes),
      unbindAxisKeys: draft.unbindAxisKeys.filter((key) => key !== axisKey),
      pendingBinds,
    };
  }

  if (draft.unbindAxisKeys.includes(axisKey)) {
    return {
      ...draft,
      mountLayout: cloneMountLayout(draft.mountLayout),
      axes: cloneAxes(draft.axes),
      unbindAxisKeys: [...draft.unbindAxisKeys],
      pendingBinds,
    };
  }

  return {
    ...draft,
    mountLayout: cloneMountLayout(draft.mountLayout),
    axes: cloneAxes(draft.axes),
    unbindAxisKeys: [...draft.unbindAxisKeys, axisKey],
    pendingBinds,
  };
};

export const getEffectiveDraftMotorId = (
  objectId: number,
  axisKey: string,
  motors: readonly Motor[],
  draft: Pick<MultiPointAxesDraft, "unbindAxisKeys" | "pendingBinds">,
): number | null => {
  if (draft.pendingBinds[axisKey]) return draft.pendingBinds[axisKey]!;
  if (draft.unbindAxisKeys.includes(axisKey)) return null;
  return getMotorIdForAxis(objectId, axisKey, motors);
};

const isFiniteCoordinate = (value: number): boolean => Number.isFinite(value);

export const validateMultiPointAxesDraft = (
  draft: MultiPointAxesDraft,
  footprint: ShapeFootprint,
  minimumAxes: number = MINIMUM_DRIVE_AXES,
): MultiPointAxesValidationIssue[] => {
  const issues: MultiPointAxesValidationIssue[] = [];

  if (draft.axes.length < minimumAxes) {
    issues.push({
      code: "minimum-axes",
      message: `至少需要 ${minimumAxes} 个吊点`,
    });
  }

  if (typeof draft.safetyRadius !== "number" || !Number.isFinite(draft.safetyRadius) || draft.safetyRadius < 0) {
    issues.push({
      code: "invalid-safety-radius",
      message: "安全范围半径必须为非负数值",
    });
  }

  if (
    typeof draft.initialTiltDirection !== "number" ||
    !Number.isFinite(draft.initialTiltDirection) ||
    draft.initialTiltDirection < 0 ||
    draft.initialTiltDirection > MAX_INITIAL_TILT_DIRECTION
  ) {
    issues.push({
      code: "invalid-initial-tilt",
      message: `初始倾斜角度必须在 0–${MAX_INITIAL_TILT_DIRECTION} 之间`,
    });
  }

  if (
    typeof draft.mountRotation !== "number" ||
    !Number.isFinite(draft.mountRotation) ||
    draft.mountRotation < 0 ||
    draft.mountRotation > MAX_MOUNT_ROTATION
  ) {
    issues.push({
      code: "invalid-mount-rotation",
      message: `吊点旋转必须在 0–${MAX_MOUNT_ROTATION} 之间`,
    });
  }

  if (draft.mountLayout.kind === "circle") {
    const resolved = resolveCircleMountLayout(
      draft.mountLayout.radius,
      draft.mountLayout.chordLengths,
      { mountRotation: draft.mountRotation },
    );
    if (!resolved.ok) {
      issues.push({
        code:
          resolved.code === "incomplete-chords" || resolved.code === "invalid-radius"
            ? "incomplete-circle-layout"
            : "invalid-circle-layout",
        message: resolved.message,
      });
    }
  }

  if (draft.mountLayout.kind === "line") {
    const resolved = resolveLineMountLayout(
      draft.mountLayout.spacings,
      draft.axes.length,
      { mountRotation: draft.mountRotation },
    );
    if (!resolved.ok) {
      issues.push({
        code: "invalid-line-layout",
        message: resolved.message,
      });
    }
  }

  const seenKeys = new Set<string>();
  for (const axis of draft.axes) {
    if (seenKeys.has(axis.key)) {
      issues.push({
        code: "duplicate-key",
        message: `吊点 key "${axis.key}" 重复`,
        axisKey: axis.key,
      });
    } else {
      seenKeys.add(axis.key);
    }

    const { x, z } = axis.mount;
    if (!isFiniteCoordinate(x) || !isFiniteCoordinate(z)) {
      issues.push({
        code: "invalid-coordinate",
        message: `吊点 ${axis.key} 坐标无效`,
        axisKey: axis.key,
      });
      continue;
    }

    if (!isPointInsideFootprint({ x, z }, footprint)) {
      issues.push({
        code: "outside-footprint",
        message: `吊点 ${axis.key} 超出有效轮廓`,
        axisKey: axis.key,
      });
    }
  }

  return issues;
};

const canonicalPendingBinds = (pendingBinds: Record<string, number>) =>
  Object.keys(pendingBinds)
    .sort()
    .map((key) => [key, pendingBinds[key]!]);

const canonicalDraft = (draft: MultiPointAxesDraft) => ({
  safetyRadius: draft.safetyRadius,
  initialTiltDirection: draft.initialTiltDirection,
  mountRotation: draft.mountRotation,
  mountLayout: draft.mountLayout,
  axes: draft.axes.map((axis) => ({
    key: axis.key,
    custom: axis.custom,
    mount: axis.mount,
  })),
  unbindAxisKeys: [...draft.unbindAxisKeys].sort(),
  pendingBinds: canonicalPendingBinds(draft.pendingBinds),
});

export const isMultiPointAxesDraftDirty = (
  initial: MultiPointAxesDraft,
  current: MultiPointAxesDraft,
): boolean =>
  JSON.stringify(canonicalDraft(initial)) !== JSON.stringify(canonicalDraft(current));
