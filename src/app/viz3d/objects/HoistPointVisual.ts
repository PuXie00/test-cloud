import { Quaternion } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import type { Disposable } from "../types";
import type { HoistTravel } from "../telemetry/hoist-travel";
import { setNodeMetadata } from "../babylon/utils";
import { createUnlitHexMaterial, setUnlitHexMaterialColor } from "../materials/pbr-material";
import {
  DEFAULT_HOIST_LABEL_MODE,
  resolveHoistLabelText,
  type HoistLabelMode,
} from "../hoist-label-mode";
import { HoistPointLabel } from "./HoistPointLabel";

const UNBOUND_COLOR = 0x869398;
const BOUND_COLOR = 0x4cd6fb;
/** 表盘 0° 刻度，与指针区分 */
const DIAL_ZERO_COLOR = 0xdee3e6;

/** 调试显示时整颗吊点置顶：粗线穿进物体也可见，吊点各部件之间仍按深度遮挡 */
const TRAVEL_RENDERING_GROUP = 1;
/** 粗线直径（相对 scale），略细于杆，向上时藏在杆和圆盘内不闪烁 */
const TRAVEL_LINE_DIAMETER = 0.22;
const MIN_TRAVEL_M = 1e-4;

/**
 * 表盘几何以 scale = 1 建模，整体按 scale 缩放：圆环半径 1.5，在编号标签俯视范围（半对角线约 0.71）之外；
 * 指针从半径 0.8 起，0° 刻度朝物体正前方 +Z。
 */
const DIAL_RING_RADIUS = 1.5;
const DIAL_NEEDLE_START = 0.8;
const DIAL_ARROW_BASE = 1.3;
const DIAL_ARROW_LENGTH = 0.42;

export class HoistPointVisual implements Disposable {
  readonly root: TransformNode;
  /** 仅几何体（圆盘+杆）根节点，供选中框包围，排除随相机缩放的 billboard 标签 */
  readonly geometryRoot: TransformNode;
  private readonly disk: Mesh;
  private readonly rod: Mesh;
  private readonly diskMaterial: StandardMaterial;
  private readonly rodMaterial: StandardMaterial;
  private readonly hoistLabel: HoistPointLabel;
  /** 线性：原位到当前位置的竖直粗线 */
  private readonly travelLine: Mesh;
  private readonly travelLineMaterial: StandardMaterial;
  /** 无极旋转：外圈表盘 + 固定 0° 刻度 + 随位置旋转的指针 */
  private readonly dialRoot: TransformNode;
  private readonly dialPointer: TransformNode;
  private readonly dialMaterial: StandardMaterial;
  private readonly dialZeroMaterial: StandardMaterial;
  private travel: HoistTravel | null = null;
  private scale = 0.18;
  private bound = false;
  private axisIndex = 0;
  private motorDisplayIndex: number | null = null;
  private labelMode: HoistLabelMode = DEFAULT_HOIST_LABEL_MODE;

  constructor(scene: Scene, scale?: number) {
    this.root = new TransformNode("viz3d-hoist-point", scene);
    this.geometryRoot = new TransformNode("viz3d-hoist-point-geometry", scene);
    this.geometryRoot.parent = this.root;

    this.diskMaterial = createUnlitHexMaterial(scene, "viz3d-hoist-disk-mat", UNBOUND_COLOR);
    this.rodMaterial = createUnlitHexMaterial(scene, "viz3d-hoist-rod-mat", UNBOUND_COLOR);

    this.disk = MeshBuilder.CreateCylinder(
      "viz3d-hoist-disk",
      { diameter: 1, height: 1, tessellation: 20 },
      scene,
    );
    this.rod = MeshBuilder.CreateCylinder(
      "viz3d-hoist-rod",
      { diameter: 1, height: 1, tessellation: 16 },
      scene,
    );

    for (const mesh of [this.disk, this.rod]) {
      mesh.receiveShadows = false;
      mesh.isPickable = true;
      mesh.parent = this.geometryRoot;
    }

    this.disk.material = this.diskMaterial;
    this.rod.material = this.rodMaterial;

    this.hoistLabel = new HoistPointLabel(scene);
    this.hoistLabel.plane.parent = this.root;

    // 粗线与表盘挂在 root 而非 geometryRoot：不进选中框
    this.travelLineMaterial = createUnlitHexMaterial(scene, "viz3d-hoist-travel-mat", BOUND_COLOR);
    // 不写深度：编号标签（透明队列，晚于不透明绘制）始终盖在粗线上
    this.travelLineMaterial.disableDepthWrite = true;
    this.travelLine = MeshBuilder.CreateCylinder(
      "viz3d-hoist-travel-line",
      { diameter: 1, height: 1, tessellation: 16 },
      scene,
    );
    this.travelLine.material = this.travelLineMaterial;
    this.travelLine.parent = this.root;

    this.dialMaterial = createUnlitHexMaterial(scene, "viz3d-hoist-dial-mat", BOUND_COLOR);
    this.dialZeroMaterial = createUnlitHexMaterial(scene, "viz3d-hoist-dial-zero-mat", DIAL_ZERO_COLOR);
    this.dialRoot = new TransformNode("viz3d-hoist-dial", scene);
    this.dialRoot.parent = this.root;
    this.dialPointer = new TransformNode("viz3d-hoist-dial-pointer", scene);
    this.dialPointer.parent = this.dialRoot;
    this.dialPointer.rotationQuaternion = Quaternion.Identity();
    this.buildDial(scene);

    for (const mesh of [this.travelLine, ...this.dialRoot.getChildMeshes(false)]) {
      mesh.receiveShadows = false;
      mesh.isPickable = false;
    }

    if (scale !== undefined) {
      this.setScale(scale);
    } else {
      this.rebuildGeometry();
    }
  }

  setScale(scale: number): void {
    this.scale = scale;
    this.rebuildGeometry();
  }

  get selectionBoundsTarget(): TransformNode {
    return this.geometryRoot;
  }

  setLabelSource(axisIndex: number, motorDisplayIndex: number | null): void {
    this.axisIndex = axisIndex;
    this.motorDisplayIndex = motorDisplayIndex;
    this.syncLabelText();
  }

  setLabelMode(mode: HoistLabelMode): void {
    this.labelMode = mode;
    this.syncLabelText();
  }

  private syncLabelText(): void {
    this.hoistLabel.setText(
      resolveHoistLabelText(this.labelMode, this.axisIndex, this.motorDisplayIndex),
    );
  }

  /** 搭建调试：null 隐藏粗线与表盘并恢复正常渲染层 */
  setTravel(travel: HoistTravel | null): void {
    if (travel === null && this.travel === null) return;
    this.travel = travel;
    this.applyTravel();
  }

  setBound(bound: boolean, selected: boolean): void {
    this.bound = bound;
    this.applyBoundColors();
    this.hoistLabel.setAppearance(bound, selected);
  }

  /** 吊点始终带 object/axis，便于拖放绑定；有电机时再写 motorId */
  setBindingIdentity(objectId: string, axisKey: string, motorId: string | null): void {
    setNodeMetadata(this.root, "viz3dObjectId", objectId);
    setNodeMetadata(this.root, "viz3dAxisKey", axisKey);
    setNodeMetadata(this.root, "viz3dMotorId", motorId ?? undefined);
  }

  dispose(): void {
    this.hoistLabel.dispose();
    this.disk.dispose(false, true);
    this.rod.dispose(false, true);
    this.diskMaterial.dispose();
    this.rodMaterial.dispose();
    this.travelLine.dispose(false, true);
    this.travelLineMaterial.dispose();
    this.dialRoot.dispose(false, true);
    this.dialMaterial.dispose();
    this.dialZeroMaterial.dispose();
    this.root.dispose();
  }

  private rebuildGeometry(): void {
    const diskRadius = this.scale * 0.55;
    const diskHeight = this.scale * 0.34;
    const rodRadius = this.scale * 0.14;
    const rodLength = this.scale * 0.75;

    this.rod.scaling.set(rodRadius * 2, rodLength, rodRadius * 2);
    this.rod.position.set(0, rodLength / 2, 0);

    this.disk.scaling.set(diskRadius * 2, diskHeight, diskRadius * 2);
    this.disk.position.set(0, rodLength + diskHeight / 2, 0);

    this.hoistLabel.setOffsetY(rodLength + diskHeight + this.scale * 0.6);
    this.hoistLabel.setSpriteSize(this.scale * 1, this.scale * 1);

    this.dialRoot.position.set(0, rodLength + diskHeight / 2, 0);
    this.dialRoot.scaling.set(this.scale, this.scale, this.scale);
    this.applyBoundColors();
    this.applyTravel();
  }

  private buildDial(scene: Scene): void {
    const ring = MeshBuilder.CreateTorus(
      "viz3d-hoist-dial-ring",
      { diameter: DIAL_RING_RADIUS * 2, thickness: 0.07, tessellation: 48 },
      scene,
    );
    ring.material = this.dialMaterial;
    ring.parent = this.dialRoot;

    const zeroTick = MeshBuilder.CreateBox(
      "viz3d-hoist-dial-zero",
      { width: 0.08, height: 0.12, depth: 0.36 },
      scene,
    );
    zeroTick.material = this.dialZeroMaterial;
    zeroTick.position.set(0, 0, DIAL_RING_RADIUS);
    zeroTick.parent = this.dialRoot;

    const needleLength = DIAL_ARROW_BASE - DIAL_NEEDLE_START;
    const needle = MeshBuilder.CreateBox(
      "viz3d-hoist-dial-needle",
      { width: 0.1, height: 0.1, depth: needleLength },
      scene,
    );
    needle.material = this.dialMaterial;
    needle.position.set(0, 0, DIAL_NEEDLE_START + needleLength / 2);
    needle.parent = this.dialPointer;

    const arrow = MeshBuilder.CreateCylinder(
      "viz3d-hoist-dial-arrow",
      { diameterTop: 0, diameterBottom: 0.32, height: DIAL_ARROW_LENGTH, tessellation: 16 },
      scene,
    );
    arrow.material = this.dialMaterial;
    // 圆锥尖从 +Y 转到 +Z（径向朝外）
    arrow.rotation.x = Math.PI / 2;
    arrow.position.set(0, 0, DIAL_ARROW_BASE + DIAL_ARROW_LENGTH / 2);
    arrow.parent = this.dialPointer;
  }

  private applyTravel(): void {
    const travel = this.travel;

    const lift = travel?.kind === "linear" ? travel.lift : 0;
    const showLine = Math.abs(lift) > MIN_TRAVEL_M;
    this.travelLine.setEnabled(showLine);
    if (showLine) {
      const diameter = this.scale * TRAVEL_LINE_DIAMETER;
      this.travelLine.scaling.set(diameter, Math.abs(lift), diameter);
      this.travelLine.position.set(0, lift / 2, 0);
    }

    const rotation = travel?.kind === "rotary" ? travel.rotation : null;
    this.dialRoot.setEnabled(rotation !== null);
    if (rotation) {
      this.dialPointer.rotationQuaternion!.set(rotation.x, rotation.y, rotation.z, rotation.w);
    }

    const group = travel ? TRAVEL_RENDERING_GROUP : 0;
    for (const mesh of this.root.getChildMeshes(false)) {
      mesh.renderingGroupId = group;
    }
  }

  private applyBoundColors(): void {
    const color = this.bound ? BOUND_COLOR : UNBOUND_COLOR;
    setUnlitHexMaterialColor(this.diskMaterial, color);
    setUnlitHexMaterialColor(this.rodMaterial, color);
  }
}
