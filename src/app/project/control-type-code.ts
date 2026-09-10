import type { ControlType } from "./configuration-types";

/** 工程文件落盘的 controlType 数字码 */
export type ControlTypeCode = 0 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export const CONTROL_TYPE_CODES = [0, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

const CODE_TO_CONTROL_TYPE = {
  0: "staticProp",
  2: "singlePointMove",
  3: "multiLevelHoist",
  4: "continuousRotation",
  5: "railCar",
  6: "twoPointSwing",
  7: "multiPointSwing",
  8: "dualTiltFourPointSwing",
  9: "fourPointSwing",
  10: "singlePointRotation",
} as const satisfies Record<ControlTypeCode, ControlType>;

const CONTROL_TYPE_TO_CODE: Record<ControlType, ControlTypeCode> = {
  staticProp: 0,
  singlePointMove: 2,
  multiLevelHoist: 3,
  continuousRotation: 4,
  railCar: 5,
  twoPointSwing: 6,
  multiPointSwing: 7,
  dualTiltFourPointSwing: 8,
  fourPointSwing: 9,
  singlePointRotation: 10,
};

export const isControlTypeCode = (value: unknown): value is ControlTypeCode =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  (CONTROL_TYPE_CODES as readonly number[]).includes(value);

/** 运行时字符串 → 工程文件数字码 */
export const encodeControlType = (controlType: ControlType): ControlTypeCode =>
  CONTROL_TYPE_TO_CODE[controlType];

/** 工程文件数字码 → 运行时字符串 */
export const decodeControlType = (code: ControlTypeCode): ControlType =>
  CODE_TO_CONTROL_TYPE[code];
