/** 工程文件坐标 / 毫米量：最多保留的小数位数（整数不补 .0） */
export const MAX_PROJECT_COORDINATE_DECIMALS = 1;

const FACTOR = 10 ** MAX_PROJECT_COORDINATE_DECIMALS;

/** 收敛到最多一位小数；整数值保持为整数 */
export const roundProjectCoordinate = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  const rounded = Math.round(value * FACTOR) / FACTOR;
  return Object.is(rounded, -0) ? 0 : rounded;
};

export const roundProjectVec3 = (value: {
  x: number;
  y: number;
  z: number;
}): { x: number; y: number; z: number } => ({
  x: roundProjectCoordinate(value.x),
  y: roundProjectCoordinate(value.y),
  z: roundProjectCoordinate(value.z),
});

export const roundProjectMount = (value: {
  x: number;
  z: number;
}): { x: number; z: number } => ({
  x: roundProjectCoordinate(value.x),
  z: roundProjectCoordinate(value.z),
});
