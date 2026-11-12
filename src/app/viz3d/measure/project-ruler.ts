import type { Camera } from "@babylonjs/core/Cameras/camera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { SlotRect, Vec3 } from "../types";
import { projectWorldToCell } from "../viewports/project-to-cell";
import type { ProjectedRuler } from "./measure-rulers";

const scratchA = new Vector3();
const scratchB = new Vector3();
const scratchViewA = new Vector3();
const scratchViewB = new Vector3();

/** 截断点稍微落在近裁剪面里面，避免投影的 z 刚好越界 */
const NEAR_EPSILON = 1e-4;

const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  z: a.z + (b.z - a.z) * t,
});

/**
 * 用这一格的相机把标尺投到格子坐标；穿过相机背面的一段按近裁剪面截掉，整段在背后返回 null。
 * cell 用格子自己的局部矩形（left/top=0）时得到格内坐标。
 */
export const projectRulerToCell = (
  ruler: { id: string; a: Vec3; b: Vec3 },
  camera: Camera,
  cell: SlotRect,
): ProjectedRuler | null => {
  const view = camera.getViewMatrix();
  scratchA.set(ruler.a.x, ruler.a.y, ruler.a.z);
  scratchB.set(ruler.b.x, ruler.b.y, ruler.b.z);
  // Babylon 视图空间：相机看向 +Z
  const za = Vector3.TransformCoordinatesToRef(scratchA, view, scratchViewA).z;
  const zb = Vector3.TransformCoordinatesToRef(scratchB, view, scratchViewB).z;
  const near = camera.minZ + NEAR_EPSILON;
  const aInFront = za >= near;
  const bInFront = zb >= near;
  if (!aInFront && !bInFront) return null;

  let a = ruler.a;
  let b = ruler.b;
  if (!aInFront) a = lerp(ruler.a, ruler.b, (near - za) / (zb - za));
  if (!bInFront) b = lerp(ruler.b, ruler.a, (near - zb) / (za - zb));

  const screenA = projectWorldToCell(a, camera, cell);
  const screenB = projectWorldToCell(b, camera, cell);
  return {
    id: ruler.id,
    a: { x: screenA.x, y: screenA.y },
    b: { x: screenB.x, y: screenB.y },
    aInFront,
    bInFront,
  };
};
