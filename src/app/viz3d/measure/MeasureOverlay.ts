import type { Camera } from "@babylonjs/core/Cameras/camera";
import type { Disposable, SlotRect, ViewportCellId } from "../types";
import type { MeasureDragSnap } from "./MeasureTool";
import type { MeasureRuler } from "./measure-rulers";
import { projectRulerToCell } from "./project-ruler";

const SVG_NS = "http://www.w3.org/2000/svg";

export type MeasureOverlayCell = { id: ViewportCellId; rect: SlotRect; camera: Camera };

type RulerElements = {
  group: SVGGElement;
  outline: SVGLineElement;
  line: SVGLineElement;
  a: SVGCircleElement;
  b: SVGCircleElement;
  label: HTMLDivElement;
};

type CellLayer = {
  root: HTMLDivElement;
  svg: SVGSVGElement;
  snapRing: SVGCircleElement;
  snapSquare: SVGRectElement;
  rulers: Map<string, RulerElements>;
};

const setAttr = (element: Element, name: string, value: string): void => {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
};

const setStyle = (element: HTMLElement | SVGElement, name: "left" | "top" | "width" | "height" | "display" | "color", value: string): void => {
  if (element.style[name] !== value) element.style[name] = value;
};

const px = (value: number): string => `${Math.round(value * 10) / 10}px`;
const num = (value: number): string => String(Math.round(value * 10) / 10);

const SNAP_RING_R = 9;

/**
 * 标尺叠加层：每个可见格各画一份（线、端点、长度标签），跟 Blender 一样不被物体遮挡。
 * DOM 按格 / 按标尺复用，只在值变了时写属性；不在测量模式时整层隐藏。
 */
export class MeasureOverlay implements Disposable {
  private readonly root: HTMLDivElement;
  private readonly cells = new Map<ViewportCellId, CellLayer>();
  private visible = true;

  constructor(host: HTMLElement) {
    this.root = document.createElement("div");
    this.root.dataset.testid = "measure-overlay";
    Object.assign(this.root.style, {
      position: "absolute",
      inset: "0",
      pointerEvents: "none",
      zIndex: "11",
      overflow: "hidden",
    });
    host.appendChild(this.root);
  }

  setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    setStyle(this.root, "display", visible ? "block" : "none");
  }

  render(
    cells: readonly MeasureOverlayCell[],
    rulers: readonly MeasureRuler[],
    selectedId: string | null,
    dragSnap: MeasureDragSnap | null,
    labelOf: (ruler: MeasureRuler) => string,
  ): void {
    const visibleIds = new Set(cells.map((cell) => cell.id));
    for (const [id, layer] of this.cells) {
      if (!visibleIds.has(id)) setStyle(layer.root, "display", "none");
    }

    for (const cell of cells) {
      const layer = this.ensureCell(cell.id);
      setStyle(layer.root, "display", "block");
      setStyle(layer.root, "left", px(cell.rect.left));
      setStyle(layer.root, "top", px(cell.rect.top));
      setStyle(layer.root, "width", px(cell.rect.width));
      setStyle(layer.root, "height", px(cell.rect.height));
      const local: SlotRect = { left: 0, top: 0, width: cell.rect.width, height: cell.rect.height };

      const liveIds = new Set<string>();
      for (const ruler of rulers) {
        liveIds.add(ruler.id);
        const elements = this.ensureRuler(layer, ruler.id);
        const projected = cell.rect.width > 0 && cell.rect.height > 0
          ? projectRulerToCell(ruler, cell.camera, local)
          : null;
        if (!projected) {
          setStyle(elements.group, "display", "none");
          setStyle(elements.label, "display", "none");
          continue;
        }
        const selected = ruler.id === selectedId;
        const color = selected ? "var(--primary)" : "var(--foreground)";
        setStyle(elements.group, "display", "inline");
        for (const line of [elements.outline, elements.line]) {
          setAttr(line, "x1", num(projected.a.x));
          setAttr(line, "y1", num(projected.a.y));
          setAttr(line, "x2", num(projected.b.x));
          setAttr(line, "y2", num(projected.b.y));
        }
        setAttr(elements.line, "stroke", color);
        setAttr(elements.line, "stroke-width", selected ? "2" : "1.5");
        for (const endpoint of ["a", "b"] as const) {
          const circle = elements[endpoint];
          const inFront = endpoint === "a" ? projected.aInFront : projected.bInFront;
          setStyle(circle, "display", inFront ? "inline" : "none");
          setAttr(circle, "cx", num(projected[endpoint].x));
          setAttr(circle, "cy", num(projected[endpoint].y));
          setAttr(circle, "r", selected ? "4.5" : "3.5");
          setAttr(circle, "fill", color);
        }
        // 选中的标尺画在最上面
        if (selected && elements.group.nextElementSibling !== layer.snapRing) {
          layer.svg.insertBefore(elements.group, layer.snapRing);
        }

        const label = elements.label;
        const text = labelOf(ruler);
        if (label.textContent !== text) label.textContent = text;
        setStyle(label, "display", "block");
        setStyle(label, "left", px((projected.a.x + projected.b.x) / 2));
        setStyle(label, "top", px((projected.a.y + projected.b.y) / 2));
        setStyle(label, "color", color);
        const z = selected ? "2" : "1";
        if (label.style.zIndex !== z) label.style.zIndex = z;
      }

      for (const [id, elements] of layer.rulers) {
        if (liveIds.has(id)) continue;
        elements.group.remove();
        elements.label.remove();
        layer.rulers.delete(id);
      }

      this.renderSnap(layer, rulers, dragSnap, cell, local);
    }
  }

  dispose(): void {
    this.cells.clear();
    this.root.remove();
  }

  private renderSnap(
    layer: CellLayer,
    rulers: readonly MeasureRuler[],
    dragSnap: MeasureDragSnap | null,
    cell: MeasureOverlayCell,
    local: SlotRect,
  ): void {
    const ruler = dragSnap && (dragSnap.kind === "hoist" || dragSnap.kind === "vertex")
      ? rulers.find((entry) => entry.id === dragSnap.rulerId)
      : undefined;
    const projected = ruler ? projectRulerToCell(ruler, cell.camera, local) : null;
    const inFront = projected && dragSnap
      ? dragSnap.endpoint === "a" ? projected.aInFront : projected.bInFront
      : false;
    const at = projected && dragSnap ? projected[dragSnap.endpoint] : null;
    const showRing = inFront && dragSnap?.kind === "hoist";
    const showSquare = inFront && dragSnap?.kind === "vertex";
    setStyle(layer.snapRing, "display", showRing ? "inline" : "none");
    setStyle(layer.snapSquare, "display", showSquare ? "inline" : "none");
    if (at && showRing) {
      setAttr(layer.snapRing, "cx", num(at.x));
      setAttr(layer.snapRing, "cy", num(at.y));
    }
    if (at && showSquare) {
      setAttr(layer.snapSquare, "x", num(at.x - SNAP_RING_R + 1));
      setAttr(layer.snapSquare, "y", num(at.y - SNAP_RING_R + 1));
    }
  }

  private ensureCell(id: ViewportCellId): CellLayer {
    const existing = this.cells.get(id);
    if (existing) return existing;
    const root = document.createElement("div");
    root.dataset.cellId = id;
    Object.assign(root.style, { position: "absolute", overflow: "hidden" });
    const svg = document.createElementNS(SVG_NS, "svg");
    Object.assign(svg.style, { position: "absolute", inset: "0", width: "100%", height: "100%", overflow: "visible" });

    // 吸附标记：吊点圆圈、顶点方框
    const snapRing = document.createElementNS(SVG_NS, "circle");
    snapRing.setAttribute("r", String(SNAP_RING_R));
    snapRing.setAttribute("fill", "none");
    snapRing.setAttribute("stroke", "var(--warning)");
    snapRing.setAttribute("stroke-width", "2");
    snapRing.style.display = "none";
    const snapSquare = document.createElementNS(SVG_NS, "rect");
    snapSquare.setAttribute("width", String((SNAP_RING_R - 1) * 2));
    snapSquare.setAttribute("height", String((SNAP_RING_R - 1) * 2));
    snapSquare.setAttribute("fill", "none");
    snapSquare.setAttribute("stroke", "var(--warning)");
    snapSquare.setAttribute("stroke-width", "2");
    snapSquare.style.display = "none";
    svg.append(snapRing, snapSquare);

    root.appendChild(svg);
    this.root.appendChild(root);
    const layer: CellLayer = { root, svg, snapRing, snapSquare, rulers: new Map() };
    this.cells.set(id, layer);
    return layer;
  }

  private ensureRuler(layer: CellLayer, id: string): RulerElements {
    const existing = layer.rulers.get(id);
    if (existing) return existing;
    const group = document.createElementNS(SVG_NS, "g");
    const outline = document.createElementNS(SVG_NS, "line");
    // 深色描边：浅色物体、网格上都看得清
    outline.setAttribute("stroke", "var(--background)");
    outline.setAttribute("stroke-opacity", "0.85");
    outline.setAttribute("stroke-width", "4.5");
    outline.setAttribute("stroke-linecap", "round");
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("stroke-linecap", "round");
    const endpoint = () => {
      const circle = document.createElementNS(SVG_NS, "circle");
      circle.setAttribute("stroke", "var(--background)");
      circle.setAttribute("stroke-width", "1.5");
      return circle;
    };
    const a = endpoint();
    const b = endpoint();
    group.append(outline, line, a, b);
    layer.svg.insertBefore(group, layer.snapRing);

    const label = document.createElement("div");
    Object.assign(label.style, {
      position: "absolute",
      transform: "translate(-50%, -50%)",
      padding: "1px 6px",
      borderRadius: "4px",
      background: "var(--muted)",
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: "12px",
      lineHeight: "18px",
      fontVariantNumeric: "tabular-nums",
      whiteSpace: "nowrap",
    });
    layer.root.appendChild(label);

    const elements: RulerElements = { group, outline, line, a, b, label };
    layer.rulers.set(id, elements);
    return elements;
  }
}
