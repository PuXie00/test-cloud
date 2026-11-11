import type { Camera } from "@babylonjs/core/Cameras/camera";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Viewport } from "@babylonjs/core/Maths/math.viewport";
import type { SlotRect, Vec3 } from "../types";

const IDENTITY = Matrix.Identity();
const scratchWorld = new Vector3();
const scratchOut = new Vector3();
const scratchViewport = new Viewport(0, 0, 1, 1);

export type CellProjection = {
  /** 画布坐标（CSS px，左上为原点） */
  x: number;
  y: number;
  /** 在相机前方（近远裁剪面之间） */
  inFront: boolean;
  /** 在相机前方且落在格子里 */
  visible: boolean;
};

/**
 * 用这一格自己的相机把世界坐标投到画布坐标。
 * 不用 scene.activeCamera / getTransformMatrix：多格时那是最后渲染的那一格。
 */
export const projectWorldToCell = (world: Vec3, camera: Camera, cell: SlotRect): CellProjection => {
  // 每帧每个标签都会调，复用临时对象
  scratchWorld.set(world.x, world.y, world.z);
  scratchViewport.width = cell.width;
  scratchViewport.height = cell.height;
  const projected = Vector3.ProjectToRef(
    scratchWorld,
    IDENTITY,
    camera.getTransformationMatrix(),
    scratchViewport,
    scratchOut,
  );
  const inFront = projected.z >= 0 && projected.z <= 1;
  const visible =
    inFront &&
    projected.x >= 0 &&
    projected.x <= cell.width &&
    projected.y >= 0 &&
    projected.y <= cell.height;
  return {
    x: projected.x + cell.left,
    y: projected.y + cell.top,
    inFront,
    visible,
  };
};
