import type { LucideIcon } from "lucide-react";
import { Bell, Gamepad2, Globe, Info, Palette } from "lucide-react";
import { DEFAULT_LICENSE_META } from "@/app/license/license-constants";
import type { SettingsNavId, SettingsNavItem } from "./system-settings-types";

export const SETTINGS_NAV_ITEMS: (SettingsNavItem & { icon: LucideIcon })[] = [
  { id: "interface", label: "界面设置", icon: Palette },
  { id: "calibration", label: "控台校准", icon: Gamepad2 },
  { id: "network", label: "网络配置", icon: Globe },
  { id: "notifications", label: "通知与声音", icon: Bell },
  { id: "about", label: "关于软件", icon: Info },
];

export const DEFAULT_SETTINGS_NAV: SettingsNavId = "calibration";

export const LICENSE_DISPLAY = {
  ...DEFAULT_LICENSE_META,
  status: "已激活" as const,
  softwareName: "YZDITEC 舞台控制系统",
  version: "v1.0.0-demo",
  copyright: "© 2026 岳中数字科技有限公司",
};

export const NETWORK_PLACEHOLDER = {
  ip: "192.168.1.100",
  subnet: "255.255.255.0",
  gateway: "192.168.1.1",
  dns: "192.168.1.1",
  port: "502",
};

export const CALIBRATION_PLACEHOLDER = {
  brightness: 76,
  faderValue: 63,
  pressedKeys: ["E", "F", "B"] as const,
  systemTime: "2026-06-01 14:36:09",
};

export const KEYBOARD_ROWS = [
  ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
  ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
  ["Z", "X", "C", "V", "B", "N", "M"],
] as const;
