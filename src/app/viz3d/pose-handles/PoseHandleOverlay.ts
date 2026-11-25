import type { Disposable, SlotRect, ViewportCellId, VirtualAxisId } from "../types";
import { viz3dAxisCssColor } from "../helpers/axes-config";
import type { HandleLayout } from "./pose-handle-layout";
import type { Pt } from "./pose-handle-math";
import type { PoseHandleKind } from "./pose-handle-types";
import {
  circlePath,
  LABEL_STYLE,
  num,
  polylinePath,
  px,
  setAttr,
  setStyle,
  SVG_NS,
  svgPath,
} from "./overlay-svg";

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

/** 手柄旁的虚轴切换的一格（画布坐标） */
export type OverlaySwitchChip = {
  axis: VirtualAxisId;
  text: string;
  /** 正出着这根轴的手柄 */
  active: boolean;
  hover: boolean;
  rect: SlotRect;
};

export type OverlayCell = {
  id: ViewportCellId;
  /** 画布坐标 */
  rect: SlotRect;
  handles: OverlayHandle[];
  drag: OverlayDrag | null;
  switcher: OverlaySwitchChip[];
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
  switcher: HTMLDivElement;
};

const SWITCH_STYLE: Partial<CSSStyleDeclaration> = {
  position: "absolute",
  boxSizing: "border-box",
  borderRadius: "4px",
  fontSize: "11px",
  lineHeight: "18px",
  textAlign: "center",
  whiteSpace: "nowrap",
  overflow: "hidden",
  pointerEvents: "none",
  boxShadow: "0 1px 3px rgba(0, 0, 0, 0.35)",
};

/** 手柄颜色：摆动弧按它摆动的世界轴着色（和坐标轴一致），升降、旋转、偏转用主题主色 */
const handleColor = (kind: PoseHandleKind): string => {
  if (kind === "tiltX") return viz3dAxisCssColor("x");
  if (kind === "tiltY") return viz3dAxisCssColor("z");
  return "var(--primary)";
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
    this.renderSwitcher(layer.switcher, show ? cell.switcher : [], { x: cell.rect.left, y: cell.rect.top });
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

  /** 手柄旁的虚轴切换：一格一个 div，按下标复用 */
  private renderSwitcher(container: HTMLDivElement, chips: readonly OverlaySwitchChip[], offset: Pt): void {
    while (container.children.length > chips.length) container.lastElementChild?.remove();
    chips.forEach((chip, index) => {
      let element = container.children[index] as HTMLDivElement | undefined;
      if (!element) {
        element = document.createElement("div");
        Object.assign(element.style, SWITCH_STYLE);
        element.dataset.testid = "pose-handle-switch";
        container.appendChild(element);
      }
      if (element.textContent !== chip.text) element.textContent = chip.text;
      element.dataset.axis = chip.axis;
      element.dataset.active = String(chip.active);
      setStyle(element, "left", px(chip.rect.left - offset.x));
      setStyle(element, "top", px(chip.rect.top - offset.y));
      setStyle(element, "width", px(chip.rect.width));
      setStyle(element, "height", px(chip.rect.height));
      setStyle(element, "color", chip.active ? "var(--primary-foreground)" : "var(--foreground)");
      setStyle(
        element,
        "background",
        chip.active ? "var(--primary)" : chip.hover ? "var(--accent)" : "var(--muted)",
      );
    });
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

    const switcher = document.createElement("div");
    switcher.dataset.testid = "pose-handle-switcher";

    root.append(svg, label, snapLabel, switcher);
    this.root.appendChild(root);
    const layer: CellLayer = { root, svg, sweep, snap, handles: new Map(), label, snapLabel, switcher };
    this.cells.set(id, layer);
    return layer;
  }

  private ensureHandle(layer: CellLayer, key: string): HandleElements {
    const existing = layer.handles.get(key);
    if (existing) return existing;
    const group = document.createElementNS(SVG_NS, "g");
    group.dataset.handle = key;
    const path = svgPath;
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
