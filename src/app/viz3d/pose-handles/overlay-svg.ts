import type { Pt } from "./pose-handle-math";

/** 叠加层共用：只在值变了时写属性 / 样式，每帧重画也不折腾 DOM */
export const SVG_NS = "http://www.w3.org/2000/svg";

export const setAttr = (element: Element, name: string, value: string): void => {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
};

export const setStyle = (
  element: HTMLElement | SVGElement,
  name: "left" | "top" | "width" | "height" | "display" | "color" | "background",
  value: string,
): void => {
  if (element.style[name] !== value) element.style[name] = value;
};

export const px = (value: number): string => `${Math.round(value * 10) / 10}px`;
export const num = (value: number): string => String(Math.round(value * 10) / 10);

export const polylinePath = (points: readonly Pt[], offset: Pt, closed = false): string => {
  if (points.length === 0) return "";
  const body = points
    .map((point, index) => `${index === 0 ? "M" : "L"}${num(point.x - offset.x)} ${num(point.y - offset.y)}`)
    .join(" ");
  return closed ? `${body} Z` : body;
};

export const circlePath = (center: Pt, radius: number, offset: Pt): string => {
  const x = center.x - offset.x;
  const y = center.y - offset.y;
  return `M${num(x - radius)} ${num(y)} a${num(radius)} ${num(radius)} 0 1 0 ${num(radius * 2)} 0 a${num(radius)} ${num(radius)} 0 1 0 ${num(-radius * 2)} 0 Z`;
};

export const svgPath = (attributes: Record<string, string>): SVGPathElement => {
  const element = document.createElementNS(SVG_NS, "path");
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  return element;
};

export const LABEL_STYLE: Partial<CSSStyleDeclaration> = {
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
