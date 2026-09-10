const RAD_TO_DEG = 180 / Math.PI;

export const FOCAL_LENGTH_MIN_MM = 18;
export const FOCAL_LENGTH_MAX_MM = 135;
export const DEFAULT_FOCAL_LENGTH_MM = 50;
export const SENSOR_HEIGHT_MM = 24;

export const clampFocalLengthMm = (mm: number): number =>
  Math.min(FOCAL_LENGTH_MAX_MM, Math.max(FOCAL_LENGTH_MIN_MM, mm));

export const focalLengthToFov = (mm: number, sensorHeightMm = SENSOR_HEIGHT_MM): number => {
  const clamped = clampFocalLengthMm(mm);
  return RAD_TO_DEG * 2 * Math.atan(sensorHeightMm / (2 * clamped));
};
