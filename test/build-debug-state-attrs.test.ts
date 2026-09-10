import { describe, expect, it } from "vitest";
import type { DisplayAttribute } from "@shared/config";
import {
  formatStateAttrDisplay,
  resolveStateAttrRawValue,
  stateAttrToneClass,
  variablevariableStateAttri,
} from "../src/app/pages/console/components/build-debug/build-debug-state-attrs";
import type { BuildMotorTelemetry } from "../src/app/pages/console/components/build-debug/build-debug-types";

const telemetry: BuildMotorTelemetry = {
  status: "idle",
  values: {
    actualPosition: 100,
    actualTemperature: 75,
    actualTorque: 40,
    actualWeight: 88,
  },
};

const attr = (
  partial: Partial<DisplayAttribute> & Pick<DisplayAttribute, "id" | "label">,
): DisplayAttribute => ({
  dataType: "uint16",
  display: true,
  ...partial,
});

describe("build-debug-state-attrs", () => {
  it("uses mock values by matching stateAttribute id", () => {
    expect(resolveStateAttrRawValue("actualPosition", telemetry, 10)).toBe(90);
    expect(resolveStateAttrRawValue("actualTemperature", telemetry)).toBe(75);
    expect(resolveStateAttrRawValue("actualTorque", telemetry)).toBe(40);
    expect(resolveStateAttrRawValue("actualWeight", telemetry)).toBe(88);
    expect(resolveStateAttrRawValue("driveAlarmCode", telemetry)).toBeNull();
  });

  it("formats units and enums", () => {
    expect(
      formatStateAttrDisplay(attr({ id: "actualPosition", label: "位置", unit: "mm" }), 120),
    ).toBe("120 mm");
    expect(
      formatStateAttrDisplay(attr({ id: "actualTemperature", label: "温度", unit: "degC" }), 36),
    ).toBe("36°");
    expect(
      formatStateAttrDisplay(
        attr({
          id: "axisStatus",
          label: "轴状态",
          dataType: "enum",
          values: [
            [0, "断电"],
            [2, "静止"],
          ],
        }),
        2,
      ),
    ).toBe("静止");
    expect(formatStateAttrDisplay(attr({ id: "missing", label: "缺" }), null)).toBe("—");
  });

  it("formats length-family state attrs with session display unit and mm/s2 alias", () => {
    expect(
      formatStateAttrDisplay(
        attr({ id: "actualPosition", label: "位置", unit: "mm" }),
        2000,
        "m",
      ),
    ).toBe("2 m");
    expect(
      formatStateAttrDisplay(
        attr({ id: "actualSpeed", label: "速度", unit: "mm/s" }),
        1500,
        "m",
      ),
    ).toBe("1.5 m/s");
    expect(
      formatStateAttrDisplay(
        attr({ id: "actualAccel", label: "加速度", unit: "mm/s2" }),
        1000,
        "m",
      ),
    ).toBe("1 m/s²");
  });

  it("applies alarm tones", () => {
    const alarms = { temperature: true, torqueImbalance: false, driveAlarm: false, any: true };
    expect(stateAttrToneClass("actualPosition", alarms)).toBe("text-foreground");
    expect(stateAttrToneClass("actualTemperature", alarms)).toBe("text-warning");
    expect(stateAttrToneClass("actualTorque", alarms)).toBe("text-muted-foreground");
  });

  it("filters variable display attrs", () => {
    expect(
      variablevariableStateAttri([
        attr({ id: "actualPosition", label: "位置", type: "basic" }),
        attr({ id: "actualWeight", label: "称重", type: "variable" }),
      ]).map((a) => a.id),
    ).toEqual(["actualWeight"]);
  });
});
