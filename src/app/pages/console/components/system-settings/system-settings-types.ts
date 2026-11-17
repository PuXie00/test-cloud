export type SettingsNavId =
  | "user"
  | "interface"
  | "calibration"
  | "network"
  | "notifications"
  | "update"
  | "about";

export type SettingsNavItem = {
  id: SettingsNavId;
  label: string;
};
