import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import type { Disposable } from "../types";
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

export class HoistPointVisual implements Disposable {
  readonly root: TransformNode;
  /** 仅几何体（圆盘+杆）根节点，供选中框包围，排除随相机缩放的 billboard 标签 */
  readonly geometryRoot: TransformNode;
  private readonly disk: Mesh;
  private readonly rod: Mesh;
  private readonly diskMaterial: StandardMaterial;
  private readonly rodMaterial: StandardMaterial;
  private readonly hoistLabel: HoistPointLabel;
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
    this.applyBoundColors();
  }

  private applyBoundColors(): void {
    const color = this.bound ? BOUND_COLOR : UNBOUND_COLOR;
    setUnlitHexMaterialColor(this.diskMaterial, color);
    setUnlitHexMaterialColor(this.rodMaterial, color);
  }
}
