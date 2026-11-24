import type { Disposable, SlotRect, ViewportCellId } from "../types";
import { viz3dAxisCssColor } from "../helpers/axes-config";
import type { HandleLayout } from "./pose-handle-layout";
import type { Pt } from "./pose-handle-math";
import type { PoseHandleKind } from "./pose-handle-types";

const SVG_NS = "http://www.w3.org/2000/svg";

export type HandleVisualState = "idle" | "hover" | "active" | "blocked";

export type OverlayHandle = {
  layout: HandleLayout;
  state: HandleVisualState;
  /** 拖到行程头上：这一端的短横和手柄变色 */
  atLimit: "min" | "max" | null;
};

export type OverlayDrag = {
  /** 拖动那台旁边的数值 */
  label: { at: Pt; text: string; warning: boolean } | null;
  /** 吸附参考线（画布坐标）和说明 */
  snapLines: Pt[][];
  snapLabel: { at: Pt; text: string } | null;
  /** 转过的扇形 */
  sweep: Pt[] | null;
};

export type OverlayCell = {
  id: ViewportCellId;
  /** 画布坐标 */
  rect: SlotRect;
  handles: OverlayHandle[];
  drag: OverlayDrag | null;
};

type HandleElements = {
  group: SVGGElement;
  guide: SVGPathElement;
  outline: SVGPathElement;
  stroke: SVGPathElement;
  fill: SVGPathElement;
  limitMin: SVGPathElement;
  limitMax: SVGPathElement;
};

type CellLayer = {
  root: HTMLDivElement;
  svg: SVGSVGElement;
  sweep: SVGPathElement;
  snap: SVGPathElement;
  handles: Map<string, HandleElements>;
  label: HTMLDivElement;
  snapLabel: HTMLDivElement;
};

const setAttr = (element: Element, name: string, value: string): void => {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
};

const setStyle = (
  element: HTMLElement | SVGElement,
  name: "left" | "top" | "width" | "height" | "display" | "color" | "background",
  value: string,
): void => {
  if (element.style[name] !== value) element.style[name] = value;
};

const px = (value: number): string => `${Math.round(value * 10) / 10}px`;
const num = (value: number): string => String(Math.round(value * 10) / 10);

const polylinePath = (points: readonly Pt[], offset: Pt, closed = false): string => {
  if (points.length === 0) return "";
  const body = points
    .map((point, index) => `${index === 0 ? "M" : "L"}${num(point.x - offset.x)} ${num(point.y - offset.y)}`)
    .join(" ");
  return closed ? `${body} Z` : body;
};

const circlePath = (center: Pt, radius: number, offset: Pt): string => {
  const x = center.x - offset.x;
  const y = center.y - offset.y;
  return `M${num(x - radius)} ${num(y)} a${num(radius)} ${num(radius)} 0 1 0 ${num(radius * 2)} 0 a${num(radius)} ${num(radius)} 0 1 0 ${num(-radius * 2)} 0 Z`;
};

/** 手柄颜色：倾斜弧按它摆动的世界轴着色（和坐标轴一致），其余用主题主色 */
const handleColor = (kind: PoseHandleKind): string => {
  if (kind === "tiltX") return viz3dAxisCssColor("x");
  if (kind === "tiltY") return viz3dAxisCssColor("z");
  return "var(--primary)";
};

const LABEL_STYLE: Partial<CSSStyleDeclaration> = {
  position: "absolute",
  transform: "translate(0, -50%)",
  padding: "1px 6px",
  borderRadius: "4px",
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: "12px",
  lineHeight: "18px",
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
  pointerEvents: "none",
};

/**
 * 位姿手柄叠加层：每个可见格各画一份，和测量标尺一样画在模型上面、不被遮挡，
 * DOM 按格 / 按手柄复用，只在值变了时写属性。
 */
export class PoseHandleOverlay implements Disposable {
  private readonly root: HTMLDivElement;
  private readonly cells = new Map<ViewportCellId, CellLayer>();

  constructor(host: HTMLElement) {
    this.root = document.createElement("div");
    this.root.dataset.testid = "pose-handle-overlay";
    Object.assign(this.root.style, {
      position: "absolute",
      inset: "0",
      pointerEvents: "none",
      zIndex: "10",
      overflow: "hidden",
    });
    host.appendChild(this.root);
  }

  render(cells: readonly OverlayCell[]): void {
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

  private renderCell(cell: OverlayCell): void {
    const layer = this.ensureCell(cell.id);
    const show = cell.handles.length > 0 || cell.drag !== null;
    setStyle(layer.root, "display", show ? "block" : "none");
    if (!show) {
      // 收起时把手柄也去掉：下次出来的是新的一组，不留旧的
      for (const elements of layer.handles.values()) elements.group.remove();
      layer.handles.clear();
      return;
    }
    setStyle(layer.root, "left", px(cell.rect.left));
    setStyle(layer.root, "top", px(cell.rect.top));
    setStyle(layer.root, "width", px(cell.rect.width));
    setStyle(layer.root, "height", px(cell.rect.height));
    const offset: Pt = { x: cell.rect.left, y: cell.rect.top };

    const live = new Set<string>();
    for (const handle of cell.handles) {
      live.add(handle.layout.key);
      this.renderHandle(layer, handle, offset);
    }
    for (const [key, elements] of layer.handles) {
      if (live.has(key)) continue;
      elements.group.remove();
      layer.handles.delete(key);
    }

    const drag = cell.drag;
    setAttr(layer.sweep, "d", drag?.sweep ? polylinePath(drag.sweep, offset, true) : "");
    setAttr(layer.snap, "d", drag ? drag.snapLines.map((line) => polylinePath(line, offset)).join(" ") : "");
    const labelColor = drag?.label?.warning ? "var(--warning)" : "var(--foreground)";
    this.renderLabel(layer.label, drag?.label ?? null, offset, cell.rect, labelColor);
    this.renderLabel(layer.snapLabel, drag?.snapLabel ?? null, offset, cell.rect, "var(--warning)");
  }

  /** 标签放在手柄旁边；快出格子时往回收，整段文字都看得见 */
  private renderLabel(
    element: HTMLDivElement,
    label: { at: Pt; text: string } | null,
    offset: Pt,
    rect: SlotRect,
    color: string,
  ): void {
    if (!label) {
      setStyle(element, "display", "none");
      return;
    }
    if (element.textContent !== label.text) element.textContent = label.text;
    setStyle(element, "display", "block");
    const margin = 4;
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    const left = Math.min(Math.max(label.at.x - offset.x, margin), rect.width - width - margin);
    const top = Math.min(Math.max(label.at.y - offset.y, height / 2 + margin), rect.height - height / 2 - margin);
    setStyle(element, "left", px(Math.max(margin, left)));
    setStyle(element, "top", px(top));
    setStyle(element, "color", color);
  }

  private renderHandle(layer: CellLayer, handle: OverlayHandle, offset: Pt): void {
    const elements = this.ensureHandle(layer, handle.layout.key);
    const { layout, state, atLimit } = handle;
    const blocked = state === "blocked";
    const color = blocked ? "var(--muted-foreground)" : atLimit ? "var(--warning)" : handleColor(layout.kind);
    const width = state === "active" ? 3.5 : state === "hover" ? 3.2 : 2.4;

    const strokes = [...layout.strokes.map((points) => polylinePath(points, offset))].join(" ");
    const fills = [
      ...layout.fills.map((points) => polylinePath(points, offset, true)),
      ...layout.knobs.map((knob) => circlePath(knob, knob.r, offset)),
    ].join(" ");
    setAttr(elements.guide, "d", layout.guides.map((points) => polylinePath(points, offset)).join(" "));
    setAttr(elements.guide, "stroke", color);
    setAttr(elements.outline, "d", `${strokes} ${fills}`.trim());
    setAttr(elements.outline, "stroke-width", num(width + 3));
    setAttr(elements.stroke, "d", strokes);
    setAttr(elements.stroke, "stroke", color);
    setAttr(elements.stroke, "stroke-width", num(width));
    setAttr(elements.stroke, "stroke-dasharray", blocked ? "5 4" : "none");
    setAttr(elements.fill, "d", fills);
    setAttr(elements.fill, "fill", color);
    for (const end of ["min", "max"] as const) {
      const tick = layout.limits.find((limit) => limit.end === end);
      const path = end === "min" ? elements.limitMin : elements.limitMax;
      setAttr(path, "d", tick ? polylinePath(tick.points, offset) : "");
      setAttr(path, "stroke", atLimit === end ? "var(--warning)" : color);
    }
    const opacity = blocked ? "0.75" : state === "idle" ? "0.92" : "1";
    if (elements.group.getAttribute("opacity") !== opacity) elements.group.setAttribute("opacity", opacity);
    elements.group.dataset.kind = layout.kind;
    elements.group.dataset.state = state;
  }

  private ensureCell(id: ViewportCellId): CellLayer {
    const existing = this.cells.get(id);
    if (existing) return existing;
    const root = document.createElement("div");
    root.dataset.cellId = id;
    Object.assign(root.style, { position: "absolute", overflow: "hidden" });
    const svg = document.createElementNS(SVG_NS, "svg");
    Object.assign(svg.style, { position: "absolute", inset: "0", width: "100%", height: "100%", overflow: "visible" });

    const sweep = document.createElementNS(SVG_NS, "path");
    sweep.setAttribute("fill", "var(--primary)");
    sweep.setAttribute("fill-opacity", "0.16");
    sweep.setAttribute("stroke", "var(--primary)");
    sweep.setAttribute("stroke-opacity", "0.5");
    sweep.setAttribute("stroke-width", "1");
    const snap = document.createElementNS(SVG_NS, "path");
    snap.setAttribute("fill", "none");
    snap.setAttribute("stroke", "var(--warning)");
    snap.setAttribute("stroke-width", "1.5");
    snap.setAttribute("stroke-dasharray", "6 4");
    svg.append(sweep, snap);

    const label = document.createElement("div");
    Object.assign(label.style, LABEL_STYLE, { background: "var(--muted)", display: "none" });
    label.dataset.testid = "pose-handle-value";
    const snapLabel = document.createElement("div");
    Object.assign(snapLabel.style, LABEL_STYLE, { background: "var(--muted)", display: "none" });
    snapLabel.dataset.testid = "pose-handle-snap";

    root.append(svg, label, snapLabel);
    this.root.appendChild(root);
    const layer: CellLayer = { root, svg, sweep, snap, handles: new Map(), label, snapLabel };
    this.cells.set(id, layer);
    return layer;
  }

  private ensureHandle(layer: CellLayer, key: string): HandleElements {
    const existing = layer.handles.get(key);
    if (existing) return existing;
    const group = document.createElementNS(SVG_NS, "g");
    group.dataset.handle = key;
    const path = (attributes: Record<string, string>) => {
      const element = document.createElementNS(SVG_NS, "path");
      for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
      return element;
    };
    const guide = path({ fill: "none", "stroke-width": "1.2", "stroke-dasharray": "3 4", "stroke-opacity": "0.7" });
    // 深色描边：浅色模型、网格上都看得清
    const outline = path({
      fill: "var(--background)",
      stroke: "var(--background)",
      "stroke-opacity": "0.8",
      "fill-opacity": "0.8",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    });
    const stroke = path({ fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round" });
    const fill = path({ stroke: "none" });
    const limitMin = path({ fill: "none", "stroke-width": "2", "stroke-linecap": "round" });
    const limitMax = path({ fill: "none", "stroke-width": "2", "stroke-linecap": "round" });
    group.append(guide, limitMin, limitMax, outline, stroke, fill);
    layer.svg.insertBefore(group, layer.snap);
    const elements: HandleElements = { group, guide, outline, stroke, fill, limitMin, limitMax };
    layer.handles.set(key, elements);
    return elements;
  }
}
