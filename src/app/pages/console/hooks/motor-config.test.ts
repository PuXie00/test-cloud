import { describe, expect, it } from "vitest";
import {
  GOURD_NO_TO_PRODUCT_MODEL,
  PLC_MODEL_TO_MASTER_TYPE,
  resolveMasterTypeIdByPlcModel,
  resolveProductModelByGourdNo,
} from "./motor-config";

describe("plcModel → masterTypeId 映射", () => {
  it("命中映射表返回对应型号", () => {
    expect(PLC_MODEL_TO_MASTER_TYPE[4]).toBe("AC802_0");
    expect(resolveMasterTypeIdByPlcModel(4)).toBe("AC802_0");
  });

  it("未命中映射表回退默认型号", () => {
    expect(resolveMasterTypeIdByPlcModel(999)).toBe("AC810_1");
  });
});

describe("gourdNo → productModel 映射", () => {
  it("命中映射表返回对应型号", () => {
    expect(GOURD_NO_TO_PRODUCT_MODEL[253]).toBe("YZ_AXIS_HOIST_500KG");
    expect(resolveProductModelByGourdNo(253)).toBe("YZ_AXIS_HOIST_500KG");
  });

  it("未命中映射表回退默认型号", () => {
    expect(resolveProductModelByGourdNo(999)).toBe("YZ_AXIS_HOIST_500KG");
  });
});
