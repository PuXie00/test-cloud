import type { Disposable, SlotRect, ViewportCellId } from "../types";
import type { MotionPathLayout } from "./motion-path-layout";
import type { Pt } from "./pose-handle-math";
import {
  circlePath,
  LABEL_STYLE,
  polylinePath,
  px,
  setAttr,
  setStyle,
  SVG_NS,
  svgPath,
} from "./overlay-svg";

/** 悬停在位姿点 / 轨迹线上：圈出那一点，旁边写时刻 */
export type MotionPathHover = { at: Pt; text: string; warning: boolean };

export type MotionPathOverlayCell = {
  id: ViewportCellId;
  /** 画布坐标 */
  rect: SlotRect;
  paths: MotionPathLayout[];
  hover: MotionPathHover | null;
};

type PathElements = {
  group: SVGGElement;
  halo: SVGPathElement;
  path: SVGPathElement;
  issue: SVGPathElement;
  ring: SVGPathElement;
  issueOutline: SVGPathElement;
  ticks: SVGPathElement;
  selectedTicks: SVGPathElement;
  invalidTicks: SVGPathElement;
  dots: SVGPathElement;
  selectedDots: SVGPathElement;
  invalidDots: SVGPathElement;
  cursor: SVGPathElement;
};

type CellLayer = {
  root: HTMLDivElement;
  svg: SVGSVGElement;
  hoverRing: SVGPathElement;
  paths: Map<string, PathElements>;
  label: HTMLDivElement;
};

const DOT_R = 3.5;
const SELECTED_DOT_R = 5;
const CURSOR_R = 4.5;

const joinPaths = (parts: readonly string[]): string => parts.filter(Boolean).join(" ");

/**
 * 动作页 3D 轨迹叠加层（画在位姿手柄下面）：轨迹线、位姿点、旋转环刻点、游标亮点、
 * 上一个 / 下一个位姿的线框、有问题的段和物体标红。
 */
export class MotionPathOverlay implements Disposable {
  private readonly root: HTMLDivElement;
  private readonly cells = new Map<ViewportCellId, CellLayer>();

  constructor(host: HTMLElement) {
    this.root = document.createElement("div");
    this.root.dataset.testid = "motion-path-overlay";
    Object.assign(this.root.style, {
      position: "absolute",
      inset: "0",
      pointerEvents: "none",
      zIndex: "9",
      overflow: "hidden",
    });
    host.appendChild(this.root);
  }

  render(cells: readonly MotionPathOverlayCell[]): void {
    const visible = new Set(cells.map((cell) => cell.id));
    for (const [id, layer] of this.cells) {
      if (!visible.has(id)) setStyle(layer.root, "display", "none");
    }
    for (const cell of cells) this.renderCell(cell);
  }

  dispose(): void {
    this.cells.clear();
    this.root.remove();
  }

  private renderCell(cell: MotionPathOverlayCell): void {
    const layer = this.ensureCell(cell.id);
    const show = cell.paths.length > 0;
    setStyle(layer.root, "display", show ? "block" : "none");
    if (!show) {
      for (const elements of layer.paths.values()) elements.group.remove();
      layer.paths.clear();
      return;
    }
    setStyle(layer.root, "left", px(cell.rect.left));
    setStyle(layer.root, "top", px(cell.rect.top));
    setStyle(layer.root, "width", px(cell.rect.width));
    setStyle(layer.root, "height", px(cell.rect.height));
    const offset: Pt = { x: cell.rect.left, y: cell.rect.top };

    const live = new Set<string>();
    for (const path of cell.paths) {
      live.add(path.objectId);
      this.renderPath(this.ensurePath(layer, path.objectId), path, offset);
    }
    for (const [id, elements] of layer.paths) {
      if (live.has(id)) continue;
      elements.group.remove();
      layer.paths.delete(id);
    }

    const hover = cell.hover;
    setAttr(layer.hoverRing, "d", hover ? circlePath(hover.at, 7, offset) : "");
    if (!hover) {
      setStyle(layer.label, "display", "none");
      return;
    }
    if (layer.label.textContent !== hover.text) layer.label.textContent = hover.text;
    setStyle(layer.label, "display", "block");
    const width = layer.label.offsetWidth;
    const left = Math.min(hover.at.x - offset.x + 12, cell.rect.width - width - 4);
    setStyle(layer.label, "left", px(Math.max(4, left)));
    setStyle(layer.label, "top", px(Math.max(12, hover.at.y - offset.y - 14)));
    setStyle(layer.label, "color", hover.warning ? "var(--destructive)" : "var(--foreground)");
  }

  private renderPath(elements: PathElements, layout: MotionPathLayout, offset: Pt): void {
    const color = layout.selected ? "var(--primary)" : "var(--muted-foreground)";
    const runs = joinPaths(layout.runs.map((run) => polylinePath(run.points, offset)));
    setAttr(elements.halo, "d", runs);
    setAttr(elements.halo, "stroke-width", layout.selected ? "4.5" : "3");
    setAttr(elements.path, "d", runs);
    setAttr(elements.path, "stroke", color);
    setAttr(elements.path, "stroke-width", layout.selected ? "2" : "1.3");
    setAttr(elements.path, "stroke-opacity", layout.selected ? "0.9" : "0.6");
    setAttr(elements.issue, "d", joinPaths(layout.issueRuns.map((run) => polylinePath(run, offset))));
    setAttr(elements.issue, "stroke-width", layout.selected ? "3" : "2.2");
    setAttr(elements.ring, "d", joinPaths(layout.ring.map((run) => polylinePath(run, offset))));

    setAttr(
      elements.issueOutline,
      "d",
      joinPaths(layout.outlines.flatMap((entry) => entry.edges.map((edge) => polylinePath(edge, offset)))),
    );

    const tickPath = (filter: (tick: MotionPathLayout["ticks"][number]) => boolean) =>
      joinPaths(layout.ticks.filter(filter).map((tick) => polylinePath([tick.from, tick.to], offset)));
    setAttr(elements.ticks, "d", tickPath((tick) => !tick.selected && !tick.invalid));
    setAttr(elements.ticks, "stroke", color);
    setAttr(elements.selectedTicks, "d", tickPath((tick) => tick.selected));
    setAttr(elements.invalidTicks, "d", tickPath((tick) => tick.invalid && !tick.selected));

    const dotPath = (filter: (dot: MotionPathLayout["keyframes"][number]) => boolean, radius: number) =>
      joinPaths(layout.keyframes.filter(filter).map((dot) => circlePath(dot.at, radius, offset)));
    setAttr(elements.dots, "d", dotPath((dot) => !dot.selected && !dot.invalid, DOT_R));
    setAttr(elements.dots, "stroke", color);
    setAttr(elements.selectedDots, "d", dotPath((dot) => dot.selected, SELECTED_DOT_R));
    setAttr(elements.invalidDots, "d", dotPath((dot) => dot.invalid && !dot.selected, DOT_R));
    setAttr(elements.cursor, "d", layout.cursor ? circlePath(layout.cursor, CURSOR_R, offset) : "");
    elements.group.dataset.selected = layout.selected ? "true" : "false";
  }

  private ensureCell(id: ViewportCellId): CellLayer {
    const existing = this.cells.get(id);
    if (existing) return existing;
    const root = document.createElement("div");
    root.dataset.cellId = id;
    Object.assign(root.style, { position: "absolute", overflow: "hidden" });
    const svg = document.createElementNS(SVG_NS, "svg");
    Object.assign(svg.style, { position: "absolute", inset: "0", width: "100%", height: "100%", overflow: "visible" });
    const hoverRing = svgPath({ fill: "none", stroke: "var(--foreground)", "stroke-width": "1.5" });
    svg.append(hoverRing);
    const label = document.createElement("div");
    Object.assign(label.style, LABEL_STYLE, { background: "var(--muted)", display: "none" });
    label.dataset.testid = "motion-path-hover";
    root.append(svg, label);
    this.root.appendChild(root);
    const layer: CellLayer = { root, svg, hoverRing, paths: new Map(), label };
    this.cells.set(id, layer);
    return layer;
  }

  private ensurePath(layer: CellLayer, objectId: string): PathElements {
    const existing = layer.paths.get(objectId);
    if (existing) return existing;
    const group = document.createElementNS(SVG_NS, "g");
    group.dataset.motionPath = objectId;
    const elements: PathElements = {
      group,
      // 深色描边：浅色模型、网格上都看得清
      halo: svgPath({ fill: "none", stroke: "var(--background)", "stroke-opacity": "0.55", "stroke-linecap": "round", "stroke-linejoin": "round" }),
      path: svgPath({ fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round" }),
      issue: svgPath({ fill: "none", stroke: "var(--destructive)", "stroke-linecap": "round", "stroke-linejoin": "round" }),
      ring: svgPath({ fill: "none", stroke: "var(--muted-foreground)", "stroke-width": "1", "stroke-opacity": "0.5" }),
      issueOutline: svgPath({ fill: "none", stroke: "var(--destructive)", "stroke-width": "1.6" }),
      ticks: svgPath({ fill: "none", "stroke-width": "2", "stroke-linecap": "round" }),
      selectedTicks: svgPath({ fill: "none", stroke: "var(--primary)", "stroke-width": "3.5", "stroke-linecap": "round" }),
      invalidTicks: svgPath({ fill: "none", stroke: "var(--destructive)", "stroke-width": "2.5", "stroke-linecap": "round" }),
      dots: svgPath({ fill: "var(--background)", "stroke-width": "1.5" }),
      selectedDots: svgPath({ fill: "var(--primary)", stroke: "var(--background)", "stroke-width": "1.5" }),
      invalidDots: svgPath({ fill: "var(--destructive)", stroke: "var(--background)", "stroke-width": "1.2" }),
      cursor: svgPath({ fill: "var(--foreground)", stroke: "var(--primary)", "stroke-width": "2" }),
    };
    group.append(
      elements.issueOutline,
      elements.ring,
      elements.halo,
      elements.path,
      elements.issue,
      elements.ticks,
      elements.invalidTicks,
      elements.selectedTicks,
      elements.dots,
      elements.invalidDots,
      elements.selectedDots,
      elements.cursor,
    );
    layer.svg.insertBefore(group, layer.hoverRing);
    layer.paths.set(objectId, elements);
    return elements;
  }
}
