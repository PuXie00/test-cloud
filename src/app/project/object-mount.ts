/**
 * 物体挂载（父子）关系：只存在于工程文件，PLC 不感知。
 * 有父物体时，position / rotation 是相对父物体（父物体虚轴全 0 的安装姿态）的局部值；
 * 无父物体时为世界值。单位 mm / deg，旋转为 Babylon 欧拉顺序（与 3D 根节点一致）。
 */
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { degToRad, radToDeg, wrapAngleDeg0to360 } from "./object-rotation";
import { roundProjectCoordinate } from "./project-quantity";

export type MountVec3 = { x: number; y: number; z: number };

export type MountPose = { position: MountVec3; rotation: MountVec3 };

export type MountNode = MountPose & { id: number; parentId?: number | null };

const byIdOf = <T extends { id: number }>(objects: readonly T[]): Map<number, T> =>
  new Map(objects.map((object) => [object.id, object]));

/** 父物体链（近 → 远）；父物体缺失或成环时截断 */
export const mountAncestorIds = (
  objects: readonly Pick<MountNode, "id" | "parentId">[],
  id: number,
): number[] => {
  const byId = byIdOf(objects);
  const chain: number[] = [];
  const seen = new Set([id]);
  let parentId = byId.get(id)?.parentId ?? null;
  while (parentId != null && byId.has(parentId) && !seen.has(parentId)) {
    chain.push(parentId);
    seen.add(parentId);
    parentId = byId.get(parentId)?.parentId ?? null;
  }
  return chain;
};

/** 有效父物体：存在且不成环；否则 null（按世界坐标处理） */
export const resolveMountParentId = (
  objects: readonly Pick<MountNode, "id" | "parentId">[],
  id: number,
): number | null => mountAncestorIds(objects, id)[0] ?? null;

/** ids 的全部后代（不含 ids 自身） */
export const mountDescendantIds = (
  objects: readonly Pick<MountNode, "id" | "parentId">[],
  ids: Iterable<number>,
): Set<number> => {
  const roots = new Set(ids);
  const result = new Set<number>();
  for (const object of objects) {
    if (roots.has(object.id)) continue;
    if (mountAncestorIds(objects, object.id).some((ancestor) => roots.has(ancestor))) {
      result.add(object.id);
    }
  }
  return result;
};

/** 只保留"祖先不在集合里"的物体：同时选中父子时，子物体随父物体走 */
export const topmostMountIds = (
  objects: readonly Pick<MountNode, "id" | "parentId">[],
  ids: readonly number[],
): number[] => {
  const selected = new Set(ids);
  return ids.filter(
    (id) => !mountAncestorIds(objects, id).some((ancestor) => selected.has(ancestor)),
  );
};

/** childId 能否挂到 parentId 上：父物体存在、不是自己、不是自己的后代 */
export const canMountTo = (
  objects: readonly Pick<MountNode, "id" | "parentId">[],
  childId: number,
  parentId: number,
): boolean =>
  childId !== parentId &&
  objects.some((object) => object.id === parentId) &&
  !mountAncestorIds(objects, parentId).includes(childId);

const localMatrix = (pose: MountPose): Matrix => {
  // 旧工程可能缺 rotation，与 normalizeObjectRotationDeg 一样按 0 处理
  const rotation = pose.rotation ?? { x: 0, y: 0, z: 0 };
  return Matrix.Compose(
    Vector3.One(),
    Quaternion.RotationYawPitchRoll(
      degToRad(rotation.y),
      degToRad(rotation.x),
      degToRad(rotation.z),
    ),
    new Vector3(pose.position.x, pose.position.y, pose.position.z),
  );
};

const cleanAngleDeg = (rad: number): number => {
  const wrapped = wrapAngleDeg0to360(roundProjectCoordinate(radToDeg(rad)));
  return wrapped >= 360 ? 0 : wrapped;
};

const poseFromMatrix = (matrix: Matrix): MountPose => {
  const scale = new Vector3();
  const rotation = new Quaternion();
  const translation = new Vector3();
  matrix.decompose(scale, rotation, translation);
  const euler = rotation.toEulerAngles();
  return {
    position: {
      x: roundProjectCoordinate(translation.x),
      y: roundProjectCoordinate(translation.y),
      z: roundProjectCoordinate(translation.z),
    },
    rotation: { x: cleanAngleDeg(euler.x), y: cleanAngleDeg(euler.y), z: cleanAngleDeg(euler.z) },
  };
};

/** 物体安装姿态（自身及所有父物体虚轴全 0）的世界矩阵 */
const installWorldMatrix = (objects: readonly MountNode[], id: number): Matrix | null => {
  const byId = byIdOf(objects);
  const self = byId.get(id);
  if (!self) return null;
  let world = localMatrix(self);
  for (const ancestorId of mountAncestorIds(objects, id)) {
    world = world.multiply(localMatrix(byId.get(ancestorId)!));
  }
  return world;
};

/** 物体安装姿态的世界坐标 / 朝向 */
export const objectWorldPose = (objects: readonly MountNode[], id: number): MountPose | null => {
  const world = installWorldMatrix(objects, id);
  return world ? poseFromMatrix(world) : null;
};

/** 世界姿态 → 相对 parentId 的局部姿态；parentId 为 null 时原样（取整） */
export const poseRelativeToParent = (
  objects: readonly MountNode[],
  parentId: number | null,
  world: MountPose,
): MountPose => {
  const parentWorld = parentId == null ? null : installWorldMatrix(objects, parentId);
  const worldMatrix = localMatrix(world);
  return poseFromMatrix(parentWorld ? worldMatrix.multiply(parentWorld.invert()) : worldMatrix);
};

/** 改挂到 nextParentId（null = 解除挂载），世界位置不变；返回新的 parentId / position / rotation */
export const remountPose = (
  objects: readonly MountNode[],
  id: number,
  nextParentId: number | null,
): (MountPose & { parentId: number | null }) | null => {
  const world = objectWorldPose(objects, id);
  if (!world) return null;
  return { parentId: nextParentId, ...poseRelativeToParent(objects, nextParentId, world) };
};

/** 按挂载树排序（深度优先，同层保持原顺序），附带层级深度 */
export const orderByMountTree = <T extends Pick<MountNode, "id" | "parentId">>(
  objects: readonly T[],
): Array<{ object: T; depth: number }> => {
  const childrenOf = new Map<number | null, T[]>();
  for (const object of objects) {
    const parentId = resolveMountParentId(objects, object.id);
    const siblings = childrenOf.get(parentId) ?? [];
    siblings.push(object);
    childrenOf.set(parentId, siblings);
  }
  const ordered: Array<{ object: T; depth: number }> = [];
  const visit = (object: T, depth: number) => {
    ordered.push({ object, depth });
    for (const child of childrenOf.get(object.id) ?? []) visit(child, depth + 1);
  };
  for (const root of childrenOf.get(null) ?? []) visit(root, 0);
  // 成环的脏数据不会从根访问到，兜底按根显示
  if (ordered.length < objects.length) {
    const visited = new Set(ordered.map((entry) => entry.object.id));
    for (const object of objects) if (!visited.has(object.id)) ordered.push({ object, depth: 0 });
  }
  return ordered;
};
