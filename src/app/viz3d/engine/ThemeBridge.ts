import type { Viz3DColorKey, Viz3DColorMap } from "../types";

export type GetCssVar = (cssVarName: string) => string;

export const THEME_FALLBACK: Viz3DColorMap = {
  canvas: 0x1b2023,
  background: 0x0e1416,
  muted: 0x252b2d,
  primary: 0x4cd6fb,
  show: 0x4ade80,
  secondary: 0xbac3ff,
  warning: 0xffb77d,
  destructive: 0xffb4ab,
  foreground: 0xdee3e6,
  mutedForeground: 0x869398,
  border: 0x3d494d,
};

const CSS_VAR_MAP: Record<Viz3DColorKey, string> = {
  canvas: "--canvas",
  background: "--background",
  muted: "--muted",
  primary: "--primary",
  show: "--show",
  secondary: "--secondary",
  warning: "--warning",
  destructive: "--destructive",
  foreground: "--foreground",
  mutedForeground: "--muted-foreground",
  border: "--border",
};

export const parseHex = (raw: string): number | null => {
  const trimmed = raw.trim();
  const value = trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;

  if (!/^[0-9a-fA-F]+$/.test(value)) return null;

  if (value.length === 3) {
    const expanded = value
      .split("")
      .map((part) => `${part}${part}`)
      .join("");
    return Number.parseInt(expanded, 16);
  }

  if (value.length === 6) {
    return Number.parseInt(value, 16);
  }

  return null;
};

export const readThemeColors = (getVar: GetCssVar): Viz3DColorMap => {
  const result = {} as Viz3DColorMap;

  (Object.keys(CSS_VAR_MAP) as Viz3DColorKey[]).forEach((key) => {
    const parsedColor = parseHex(getVar(CSS_VAR_MAP[key]));
    result[key] = parsedColor ?? THEME_FALLBACK[key];
  });

  return result;
};

export const domGetCssVar: GetCssVar = (cssVarName) => {
  if (typeof document === "undefined") return "";
  return getComputedStyle(document.documentElement).getPropertyValue(cssVarName);
};
