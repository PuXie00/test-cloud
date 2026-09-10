import { describe, expect, it } from "vitest";
import type { Motor } from "../components/right-sidebar/config-wizard/config-wizard-types";
import { reconcileMotorsByOrder } from "./plc-reconciliation";

const motor = (id: number, busNo: 0 | 1): Motor =>
  ({
    id,
    productModel: "YZ_AXIS_HOIST_500KG",
    plcId: 1,
    busNo,
    axisType: 0,
    nodeAddress: null,
    discoveryId: null,
    selected: true,
    controlledObjectId: null,
    axisKey: null,
    params: {},
  }) as Motor;

describe("reconcileMotorsByOrder", () => {
  it("busNo 与型号一致判在线", () => {
    const result = reconcileMotorsByOrder(
      [motor(10, 0), motor(11, 1)],
      [
        { busNo: 0, slaveNo: 0, gourdNo: 253 },
        { busNo: 1, slaveNo: 1, gourdNo: 253 },
      ],
    );
    expect(result.online.map((i) => i.motor.id)).toEqual([10, 11]);
    expect(result.modelMismatch).toEqual([]);
    expect(result.portMismatch).toEqual([]);
    expect(result.offline).toEqual([]);
    expect(result.discoveredOnly).toEqual([]);
  });

  it("扫描电机型号与配置不一致判型号不匹配（优先于端口）", () => {
    const mismatchMotor: Motor = { ...motor(10, 0), productModel: "YZ_AXIS_HOIST_2000KG" };
    const result = reconcileMotorsByOrder(
      [mismatchMotor],
      [{ busNo: 1, slaveNo: 0, gourdNo: 253 }],
    );
    expect(result.modelMismatch.map((i) => i.motor.id)).toEqual([10]);
    expect(result.portMismatch).toEqual([]);
    expect(result.online).toEqual([]);
  });

  it("busNo 不一致判从站口不匹配", () => {
    const result = reconcileMotorsByOrder(
      [motor(10, 0)],
      [{ busNo: 1, slaveNo: 0, gourdNo: 253 }],
    );
    expect(result.portMismatch.map((i) => i.motor.id)).toEqual([10]);
    expect(result.modelMismatch).toEqual([]);
    expect(result.online).toEqual([]);
  });

  it("配置多出判离线，扫描多出判待加入（按 slaveNo 排序）", () => {
    const offlineCase = reconcileMotorsByOrder(
      [motor(10, 0), motor(11, 0)],
      [{ busNo: 0, slaveNo: 1, gourdNo: 253 }],
    );
    expect(offlineCase.online.map((i) => i.motor.id)).toEqual([10]);
    expect(offlineCase.offline.map((i) => i.id)).toEqual([11]);
    expect(offlineCase.discoveredOnly).toEqual([]);

    const discoveredCase = reconcileMotorsByOrder(
      [motor(10, 0)],
      [
        { busNo: 0, slaveNo: 2, gourdNo: 253 },
        { busNo: 0, slaveNo: 1, gourdNo: 253 },
      ],
    );
    expect(discoveredCase.online.map((i) => i.motor.id)).toEqual([10]);
    expect(discoveredCase.offline).toEqual([]);
    expect(discoveredCase.discoveredOnly).toEqual([{ busNo: 0, slaveNo: 2, gourdNo: 253 }]);
  });
});
