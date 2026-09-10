export type SettingsNavId =
  | "interface"
  | "calibration"
  | "network"
  | "notifications"
  | "about";

export type SettingsNavItem = {
  id: SettingsNavId;
  label: string;
};
