export type SettingsNavId =
  | "user"
  | "interface"
  | "calibration"
  | "network"
  | "notifications"
  | "about";

export type SettingsNavItem = {
  id: SettingsNavId;
  label: string;
};
