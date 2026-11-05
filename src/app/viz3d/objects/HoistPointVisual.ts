import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Quaternion } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import "@babylonjs/core/Rendering/outlineRenderer";
import type { Disposable } from "../types";
import type { HoistTravel } from "../telemetry/hoist-travel";
import { hexToColor3, setNodeMetadata } from "../babylon/utils";
import { createMarkerMaterial, setMarkerMaterialColor } from "../materials/pbr-material";
import {
  DEFAULT_HOIST_LABEL_MODE,
  resolveHoistLabelText,
  type HoistLabelMode,
} from "../hoist-label-mode";
import { HoistPointLabel } from "./HoistPointLabel";

/** 吊环：已绑定用主色，未绑定用浅灰（和默认灰色物体拉开）；底座深色，在浅色物体上也看得清 */
const BOUND_COLOR = 0x4cd6fb;
const UNBOUND_COLOR = 0xc4ccd0;
const BASE_COLOR = 0x262d30;
const BOUND_GLOW = 0.35;
const UNBOUND_GLOW = 0.2;
const BASE_GLOW = 0.1;
/** 调试的电机实时位置用「实时」绿色，和吊点本身的青色分开；深色描边让它在绿色物体上也看得出 */
const LIVE_COLOR = 0x4ade80;
const LIVE_GLOW = 0.45;
const LIVE_OUTLINE = hexToColor3(0x0e1416);
/** 表盘 0° 刻度，与指针区分 */
const DIAL_ZERO_COLOR = 0xdee3e6;
const DIAL_ZERO_GLOW = 0.5;

/** 调试显示时整颗吊点置顶：细线穿进物体也可见，吊点各部件之间仍按深度遮挡 */
const TRAVEL_RENDERING_GROUP = 1;
const MIN_TRAVEL_M = 1e-4;

/**
 * 吊点几何以 scale = 1 建模，整体按 scale 缩放：深色底座贴在物体顶面，上面短杆 + 竖直吊环（环面朝 +Z）。
 */
const BASE_DIAMETER = 0.85;
const BASE_HEIGHT = 0.12;
const STEM_DIAMETER = 0.17;
const STEM_HEIGHT = 0.26;
const EYE_DIAMETER = 0.62;
const EYE_THICKNESS = 0.15;
const EYE_CENTER_Y = BASE_HEIGHT + STEM_HEIGHT + EYE_DIAMETER / 2;
const GEOMETRY_TOP = EYE_CENTER_Y + EYE_DIAMETER / 2 + EYE_THICKNESS / 2;
/** 编号标签在吊环之上的间隙 */
const LABEL_GAP = 0.62;
/** 实时位置往上走时，标签停在圆环之上这么高 */
const LABEL_ABOVE_LIVE = 0.75;

/** 实时位置：细线（直径）+ 端头圆环和中心点，scale = 1 时的尺寸 */
const LIVE_LINE_DIAMETER = 0.09;
const LIVE_RING_DIAMETER = 1.05;
const LIVE_RING_THICKNESS = 0.12;
const LIVE_DOT_DIAMETER = 0.34;
const LIVE_OUTLINE_WIDTH = 0.035;

/**
 * 无极旋转表盘（scale = 1）：圆环半径 1.5，在编号标签俯视范围（半对角线约 0.71）之外；
 * 指针从半径 0.8 起，0° 刻度朝物体正前方 +Z。
 */
const DIAL_RING_RADIUS = 1.5;
const DIAL_NEEDLE_START = 0.8;
const DIAL_ARROW_BASE = 1.3;
const DIAL_ARROW_LENGTH = 0.42;

const outlined = (mesh: Mesh, color: Color3, width: number): void => {
  mesh.renderOutline = true;
  mesh.outlineColor = color;
  mesh.outlineWidth = width;
};

export class HoistPointVisual implements Disposable {
  readonly root: TransformNode;
  /** 仅几何体（底座 + 杆 + 吊环）根节点，供选中框包围，排除随相机缩放的 billboard 标签 */
  readonly geometryRoot: TransformNode;
  private readonly baseMaterial: StandardMaterial;
  private readonly eyeMaterial: StandardMaterial;
  private readonly hoistLabel: HoistPointLabel;
  /** 线性：原位到实时位置的竖直细线，端头圆环标出实时位置 */
  private readonly liveRoot: TransformNode;
  private readonly liveLine: Mesh;
  private readonly liveMarker: TransformNode;
  private readonly liveMaterial: StandardMaterial;
  /** 无极旋转：外圈表盘 + 固定 0° 刻度 + 随位置旋转的指针 */
  private readonly dialRoot: TransformNode;
  private readonly dialPointer: TransformNode;
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

    this.baseMaterial = createMarkerMaterial(scene, "viz3d-hoist-base-mat", BASE_COLOR, BASE_GLOW);
    this.eyeMaterial = createMarkerMaterial(scene, "viz3d-hoist-eye-mat", UNBOUND_COLOR, UNBOUND_GLOW);
    this.buildGeometry(scene);

    this.hoistLabel = new HoistPointLabel(scene);
    this.hoistLabel.plane.parent = this.root;

    // 实时位置与表盘挂在 root 而非 geometryRoot：不进选中框
    this.liveMaterial = createMarkerMaterial(scene, "viz3d-hoist-live-mat", LIVE_COLOR, LIVE_GLOW);
    // 不写深度：编号标签（透明队列，晚于不透明绘制）始终盖在细线上
    this.liveMaterial.disableDepthWrite = true;
    this.liveRoot = new TransformNode("viz3d-hoist-live", scene);
    this.liveRoot.parent = this.root;
    this.liveLine = MeshBuilder.CreateCylinder(
      "viz3d-hoist-live-line",
      { diameter: 1, height: 1, tessellation: 12 },
      scene,
    );
    this.liveLine.material = this.liveMaterial;
    this.liveLine.parent = this.liveRoot;
    this.liveMarker = new TransformNode("viz3d-hoist-live-marker", scene);
    this.liveMarker.parent = this.liveRoot;
    this.buildLiveMarker(scene);

    this.dialZeroMaterial = createMarkerMaterial(
      scene,
      "viz3d-hoist-dial-zero-mat",
      DIAL_ZERO_COLOR,
      DIAL_ZERO_GLOW,
    );
    this.dialRoot = new TransformNode("viz3d-hoist-dial", scene);
    this.dialRoot.parent = this.root;
    this.dialPointer = new TransformNode("viz3d-hoist-dial-pointer", scene);
    this.dialPointer.parent = this.dialRoot;
    this.dialPointer.rotationQuaternion = Quaternion.Identity();
    this.buildDial(scene);

    for (const mesh of [...this.liveRoot.getChildMeshes(false), ...this.dialRoot.getChildMeshes(false)]) {
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

  /** 搭建调试：null 隐藏实时位置与表盘并恢复正常渲染层 */
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
    // 材质多个网格共用，单独各释放一次
    this.geometryRoot.dispose(false, false);
    this.liveRoot.dispose(false, false);
    this.dialRoot.dispose(false, false);
    this.baseMaterial.dispose();
    this.eyeMaterial.dispose();
    this.liveMaterial.dispose();
    this.dialZeroMaterial.dispose();
    this.root.dispose();
  }

  /** 底座、杆、吊环都以 scale = 1 建模，挂在 geometryRoot 下一起缩放 */
  private buildGeometry(scene: Scene): void {
    const base = MeshBuilder.CreateCylinder(
      "viz3d-hoist-base",
      { diameter: BASE_DIAMETER, height: BASE_HEIGHT, tessellation: 24 },
      scene,
    );
    base.material = this.baseMaterial;
    base.position.y = BASE_HEIGHT / 2;

    const stem = MeshBuilder.CreateCylinder(
      "viz3d-hoist-stem",
      { diameter: STEM_DIAMETER, height: STEM_HEIGHT, tessellation: 16 },
      scene,
    );
    stem.material = this.eyeMaterial;
    stem.position.y = BASE_HEIGHT + STEM_HEIGHT / 2;

    const eye = MeshBuilder.CreateTorus(
      "viz3d-hoist-eye",
      { diameter: EYE_DIAMETER, thickness: EYE_THICKNESS, tessellation: 24 },
      scene,
    );
    eye.material = this.eyeMaterial;
    // 环面竖起来，朝物体正前方 +Z
    eye.rotation.x = Math.PI / 2;
    eye.position.y = EYE_CENTER_Y;

    for (const mesh of [base, stem, eye]) {
      mesh.receiveShadows = false;
      mesh.isPickable = true;
      mesh.parent = this.geometryRoot;
    }
  }

  /** 实时位置端头：水平圆环 + 中心点（scale = 1，随 liveMarker 缩放） */
  private buildLiveMarker(scene: Scene): void {
    const ring = MeshBuilder.CreateTorus(
      "viz3d-hoist-live-ring",
      { diameter: LIVE_RING_DIAMETER, thickness: LIVE_RING_THICKNESS, tessellation: 32 },
      scene,
    );
    const dot = MeshBuilder.CreateSphere(
      "viz3d-hoist-live-dot",
      { diameter: LIVE_DOT_DIAMETER, segments: 12 },
      scene,
    );
    for (const mesh of [ring, dot]) {
      mesh.material = this.liveMaterial;
      mesh.parent = this.liveMarker;
      outlined(mesh, LIVE_OUTLINE, LIVE_OUTLINE_WIDTH);
    }
  }

  private rebuildGeometry(): void {
    const s = this.scale;
    this.geometryRoot.scaling.set(s, s, s);

    this.hoistLabel.setSpriteSize(s, s);
    this.liveMarker.scaling.set(s, s, s);
    this.dialRoot.position.set(0, BASE_HEIGHT * s, 0);
    this.dialRoot.scaling.set(s, s, s);
    this.applyBoundColors();
    this.applyTravel();
  }

  private buildDial(scene: Scene): void {
    const ring = MeshBuilder.CreateTorus(
      "viz3d-hoist-dial-ring",
      { diameter: DIAL_RING_RADIUS * 2, thickness: 0.1, tessellation: 48 },
      scene,
    );
    ring.material = this.liveMaterial;
    ring.parent = this.dialRoot;

    const zeroTick = MeshBuilder.CreateBox(
      "viz3d-hoist-dial-zero",
      { width: 0.1, height: 0.14, depth: 0.42 },
      scene,
    );
    zeroTick.material = this.dialZeroMaterial;
    zeroTick.position.set(0, 0, DIAL_RING_RADIUS);
    zeroTick.parent = this.dialRoot;

    const needleLength = DIAL_ARROW_BASE - DIAL_NEEDLE_START;
    const needle = MeshBuilder.CreateBox(
      "viz3d-hoist-dial-needle",
      { width: 0.12, height: 0.12, depth: needleLength },
      scene,
    );
    needle.material = this.liveMaterial;
    needle.position.set(0, 0, DIAL_NEEDLE_START + needleLength / 2);
    needle.parent = this.dialPointer;

    const arrow = MeshBuilder.CreateCylinder(
      "viz3d-hoist-dial-arrow",
      { diameterTop: 0, diameterBottom: 0.36, height: DIAL_ARROW_LENGTH, tessellation: 16 },
      scene,
    );
    arrow.material = this.liveMaterial;
    // 圆锥尖从 +Y 转到 +Z（径向朝外）
    arrow.rotation.x = Math.PI / 2;
    arrow.position.set(0, 0, DIAL_ARROW_BASE + DIAL_ARROW_LENGTH / 2);
    arrow.parent = this.dialPointer;

    for (const mesh of [ring, zeroTick, needle, arrow]) {
      outlined(mesh, LIVE_OUTLINE, LIVE_OUTLINE_WIDTH);
    }
  }

  private applyTravel(): void {
    const s = this.scale;
    const travel = this.travel;

    const lift = travel?.kind === "linear" ? travel.lift : 0;
    const showLive = Math.abs(lift) > MIN_TRAVEL_M;
    this.liveRoot.setEnabled(showLive);
    if (showLive) {
      const diameter = s * LIVE_LINE_DIAMETER;
      this.liveLine.scaling.set(diameter, Math.abs(lift), diameter);
      this.liveLine.position.set(0, lift / 2, 0);
      this.liveMarker.position.set(0, lift, 0);
    }
    // 实时位置在吊点上方时，标签升到圆环之上，不挡也不被挡
    const labelY = (GEOMETRY_TOP + LABEL_GAP) * s;
    this.hoistLabel.setOffsetY(showLive ? Math.max(labelY, lift + LABEL_ABOVE_LIVE * s) : labelY);

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
    setMarkerMaterialColor(
      this.eyeMaterial,
      this.bound ? BOUND_COLOR : UNBOUND_COLOR,
      this.bound ? BOUND_GLOW : UNBOUND_GLOW,
    );
  }
}
