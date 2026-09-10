export const TRAJECTORY_MODES = ["forced", "non-forced"] as const;
export type TrajectoryMode = (typeof TRAJECTORY_MODES)[number];
