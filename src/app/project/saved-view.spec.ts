import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "./project-document-empty";
import { assertProjectDocumentStructure } from "./project-document-assert";
import { createDefaultSavedView, normalizeSavedView } from "./saved-view";

const camera = {
  target: [0, 0, 0],
  alpha: 0.5,
  beta: 1,
  zoomRadius: 12,
  orthoHalfHeight: 6,
  preset: "top",
  focalLengthMm: 50,
};

describe("normalizeSavedView 多格视口", () => {
  it("旧视图（只有主格）原样保留，不补 cells / layout / split", () => {
    const view = normalizeSavedView({ ...createDefaultSavedView() });
    expect(view).toEqual(createDefaultSavedView());
    expect("cells" in view).toBe(false);
    expect("layout" in view).toBe(false);
    expect("split" in view).toBe(false);
  });

  it("保留合法的其余格和布局，分隔比例夹到 0.1–0.9", () => {
    const view = normalizeSavedView({
      ...createDefaultSavedView(),
      cells: { quadTopRight: camera, dualRight: { ...camera, preset: "front" } },
      layout: "quad",
      split: { x: 0.95, y: 0.3 },
    });
    expect(view.cells?.quadTopRight?.preset).toBe("top");
    expect(view.cells?.dualRight?.preset).toBe("front");
    expect(view.layout).toBe("quad");
    expect(view.split).toEqual({ x: 0.9, y: 0.3 });
  });

  it("丢掉不合法的格和布局，主格不受影响", () => {
    const view = normalizeSavedView({
      ...createDefaultSavedView(),
      cells: { quadTopRight: { ...camera, zoomRadius: -1 }, main: camera, unknown: camera },
      layout: "triple",
      split: { x: "a", y: 0.5 },
    });
    expect(view.cells).toBeUndefined();
    expect(view.layout).toBeUndefined();
    expect(view.split).toBeUndefined();
    expect(view.preset).toBe("persp");
  });
});

describe("工程文件结构校验：view.cells / layout / split", () => {
  it("可缺省，填了要合法", () => {
    const document = createEmptyDocument({ id: "p1", name: "测试", author: "admin" });
    expect(() => assertProjectDocumentStructure(document)).not.toThrow();

    document.view = {
      ...document.view,
      cells: { quadBottomLeft: { ...camera, target: [0, 0, 0], preset: "front" } },
      layout: "dual",
      split: { x: 0.5, y: 0.5 },
    };
    expect(() => assertProjectDocumentStructure(document)).not.toThrow();

    const broken = {
      ...document,
      view: { ...document.view, layout: "triple" },
    };
    expect(() => assertProjectDocumentStructure(broken)).toThrow(/view\.layout/);
  });
});
