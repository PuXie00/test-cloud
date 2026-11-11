import { Camera } from "@babylonjs/core/Cameras/camera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SavedView } from "../types";
import { ViewportManager } from "./ViewportManager";

const SLOT = { left: 0, top: 0, width: 800, height: 600 };

describe("ViewportManager 单 / 双 / 四视图", () => {
  let babylon: NullEngine;
  let scene: Scene;
  let manager: ViewportManager;

  beforeEach(() => {
    babylon = new NullEngine();
    scene = new Scene(babylon);
    manager = new ViewportManager(scene);
  });

  afterEach(() => {
    manager.dispose();
    scene.dispose();
    babylon.dispose();
  });

  it("四视图主透视格在左上，其余右上顶、左下前、右下右", () => {
    manager.setLayout("quad");
    const cells = manager.getState().cells;
    expect(cells.map((cell) => [cell.id, cell.preset, cell.orthographic])).toEqual([
      ["main", "persp", false],
      ["quadTopRight", "top", true],
      ["quadBottomLeft", "front", true],
      ["quadBottomRight", "side", true],
    ]);
    expect(cells[0]!.rect).toEqual({ left: 0, top: 0, width: 0.5, height: 0.5 });
    expect(cells[1]!.rect).toEqual({ left: 0.5, top: 0, width: 0.5, height: 0.5 });
  });

  it("切布局不重置任何一格的相机", () => {
    const main = manager.getCell("main").camera;
    main.alpha = 1.1;
    main.radius = 33;
    manager.setLayout("quad");
    manager.getCell("quadTopRight").setFocalLength(85);
    manager.setLayout("dual");
    manager.setLayout("single");
    manager.setLayout("quad");
    expect(manager.getCell("main").camera).toBe(main);
    expect(main.alpha).toBeCloseTo(1.1);
    expect(main.radius).toBeCloseTo(33);
    expect(manager.getCell("quadTopRight").getFocalLength()).toBe(85);
  });

  it("每格自己切视角和透视 / 正交，互不影响", () => {
    manager.setLayout("quad");
    manager.setCellView("quadTopRight", "left");
    manager.setCellOrthographic("main", true);
    manager.setCellOrthographic("quadBottomLeft", false);

    const byId = new Map(manager.getState().cells.map((cell) => [cell.id, cell]));
    expect(byId.get("quadTopRight")).toMatchObject({ preset: "left", orthographic: true });
    expect(byId.get("main")).toMatchObject({ preset: "persp", orthographic: true });
    // 正交预设切成透视：保持角度，预设变回透视
    expect(byId.get("quadBottomLeft")).toMatchObject({ preset: "persp", orthographic: false });
    expect(byId.get("quadBottomRight")).toMatchObject({ preset: "side", orthographic: true });
    expect(manager.getCell("main").camera.mode).toBe(Camera.ORTHOGRAPHIC_CAMERA);
  });

  it("正交格之间切视角：旧视角的旋转锁不把新视角夹回去", () => {
    manager.setLayout("quad");
    manager.setCellView("quadBottomLeft", "side");
    manager.setActiveCell("quadBottomLeft");
    manager.render(scene, SLOT);
    const camera = manager.getCell("quadBottomLeft").camera;
    expect(camera.position.x).toBeCloseTo(14);
    expect(camera.position.z).toBeCloseTo(0);
    manager.setCellView("quadBottomLeft", "top");
    manager.render(scene, SLOT);
    expect(camera.position.y).toBeGreaterThan(13);
  });

  it("正交格锁旋转，透视格可转", () => {
    manager.setLayout("quad");
    const top = manager.getCell("quadTopRight").camera;
    expect(top.lowerAlphaLimit).toBe(top.upperAlphaLimit);
    const main = manager.getCell("main").camera;
    expect(main.lowerAlphaLimit).toBeNull();
  });

  it("按格找相机：拾取落在光标所在格", () => {
    manager.setLayout("quad");
    expect(manager.getCellIdAt(100, 100, SLOT)).toBe("main");
    expect(manager.getCellIdAt(700, 100, SLOT)).toBe("quadTopRight");
    expect(manager.getCellIdAt(100, 500, SLOT)).toBe("quadBottomLeft");
    const target = manager.getPickTarget(700, 500, SLOT);
    expect(target?.cellId).toBe("quadBottomRight");
    expect(target?.camera).toBe(manager.getCell("quadBottomRight").camera);
    expect(target?.screenRect).toEqual({ left: 400, top: 300, width: 400, height: 300 });
  });

  it("当前格最后渲染，其余可见格都画", () => {
    manager.setLayout("quad");
    manager.setActiveCell("quadBottomLeft");
    manager.render(scene, SLOT);
    const order = scene.activeCameras?.map((camera) => camera.name);
    expect(order).toHaveLength(4);
    expect(order?.at(-1)).toBe("viz3d-cell-quadBottomLeft");

    manager.setLayout("single");
    manager.render(scene, SLOT);
    expect(scene.activeCameras?.map((camera) => camera.name)).toEqual(["viz3d-cell-main"]);
    // 切到单视图，当前格不在其中就回到主格
    expect(manager.getActiveCellId()).toBe("main");
  });

  it("各格视口按格子位置设置（GL 坐标自下而上）", () => {
    manager.setLayout("quad");
    manager.setSplit({ x: 0.25, y: 0.5 });
    manager.render(scene, SLOT);
    const topLeft = manager.getCell("main").camera.viewport;
    expect([topLeft.x, topLeft.y, topLeft.width, topLeft.height]).toEqual([0, 0.5, 0.25, 0.5]);
    const bottomRight = manager.getCell("quadBottomRight").camera.viewport;
    expect([bottomRight.x, bottomRight.y, bottomRight.width, bottomRight.height]).toEqual([
      0.25, 0, 0.75, 0.5,
    ]);
  });

  it("最大化一格，再调一次还原；切布局也会还原", () => {
    manager.setLayout("quad");
    manager.toggleMaximize("quadBottomRight");
    expect(manager.getVisibleCellIds()).toEqual(["quadBottomRight"]);
    expect(manager.getActiveCellId()).toBe("quadBottomRight");
    expect(manager.getState().cells[0]!.rect).toEqual({ left: 0, top: 0, width: 1, height: 1 });
    manager.toggleMaximize("quadBottomRight");
    expect(manager.getVisibleCellIds()).toHaveLength(4);

    manager.toggleMaximize("quadTopRight");
    manager.setLayout("quad");
    expect(manager.getMaximizedCellId()).toBeNull();
  });

  it("屏幕标签固定在主透视格，不随当前格跳；最大化别的格时在放大的那格", () => {
    expect(manager.getLabelCellId()).toBe("main");
    manager.setLayout("dual");
    manager.setActiveCell("dualRight");
    expect(manager.getLabelCellId()).toBe("main");
    manager.setLayout("quad");
    manager.setActiveCell("quadBottomRight");
    expect(manager.getLabelCellId()).toBe("main");
    manager.toggleMaximize("quadBottomLeft");
    expect(manager.getLabelCellId()).toBe("quadBottomLeft");
    manager.toggleMaximize("quadBottomLeft");
    manager.toggleMaximize("main");
    expect(manager.getLabelCellId()).toBe("main");
  });

  it("单视图不能最大化", () => {
    manager.toggleMaximize("main");
    expect(manager.getMaximizedCellId()).toBeNull();
  });

  it("跟随按格设置，跟随时也锁旋转", () => {
    manager.setLayout("dual");
    manager.setCellFollowTarget("main", "7");
    const following: string[] = [];
    manager.forEachFollowingCell((cell, objectId) => following.push(`${cell.id}:${objectId}`));
    expect(following).toEqual(["main:7"]);
    const main = manager.getCell("main").camera;
    expect(main.lowerAlphaLimit).toBe(main.upperAlphaLimit);
    manager.setCellFollowTarget("main", null);
    expect(main.lowerAlphaLimit).toBeNull();
  });

  it("视图落盘再恢复：主格在顶层，其余格和布局、分隔都还原", () => {
    manager.setLayout("quad");
    manager.setSplit({ x: 0.4, y: 0.5 });
    manager.setCellView("quadTopRight", "back");
    manager.getCell("main").camera.alpha = 0.7;
    const saved: SavedView = { ...manager.getSavedView(), gridSize: 20 };
    expect(saved.preset).toBe("persp");
    expect(saved.alpha).toBeCloseTo(0.7);
    expect(saved.cells?.quadTopRight?.preset).toBe("back");
    expect(saved.layout).toBe("quad");
    expect(saved.split).toEqual({ x: 0.4, y: 0.5 });

    const restored = new ViewportManager(scene);
    restored.applySavedView(saved);
    expect(restored.getLayout()).toBe("quad");
    expect(restored.getSplit()).toEqual({ x: 0.4, y: 0.5 });
    expect(restored.getCell("quadTopRight").getPreset()).toBe("back");
    expect(restored.getCell("main").camera.alpha).toBeCloseTo(0.7);
    restored.dispose();
  });

  it("旧工程视图（只有主格）照常恢复，其余格保持默认", () => {
    const legacy: SavedView = {
      target: [1, 0, 2],
      alpha: 0.3,
      beta: 1,
      zoomRadius: 20,
      orthoHalfHeight: 10,
      preset: "top",
      focalLengthMm: 50,
      gridSize: 20,
    };
    manager.applySavedView(legacy);
    expect(manager.getLayout()).toBe("single");
    expect(manager.getCell("main").getPreset()).toBe("top");
    expect(manager.getCell("main").isOrthographic()).toBe(true);
    expect(manager.getCell("quadBottomLeft").getPreset()).toBe("front");
  });

  it("保存后再套同一份视图不打断最大化", () => {
    manager.setLayout("quad");
    manager.toggleMaximize("quadTopRight");
    const saved: SavedView = { ...manager.getSavedView(), gridSize: 20 };
    manager.applySavedView(saved);
    expect(manager.getMaximizedCellId()).toBe("quadTopRight");
  });
});
