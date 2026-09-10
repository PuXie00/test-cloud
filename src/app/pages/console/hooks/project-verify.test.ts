import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION } from "@shared/csocket/protocol";
import { createDisconnectedPlcRuntime, type PlcRuntimeState } from "./plc-runtime-types";
import {
  ingestProjectVerifyFrame,
  isFailedOpenProjectVerifyAck,
  parseProjectVerifyItem,
  plcVerifyStatusLabel,
  runtimeProjectMismatch,
  runtimeVersionMismatch,
  shouldShowProjectMismatchDialog,
  toOpenProjectCppAck,
} from "./project-verify";

const reported = (
  plcId: number,
  version: number,
  proVerify: number,
): PlcRuntimeState => ({
  ...createDisconnectedPlcRuntime(plcId),
  protocolVersion: version,
  proVerify,
});

describe("PROTOCOL_VERSION", () => {
  it("is a finite number", () => {
    expect(Number.isFinite(PROTOCOL_VERSION)).toBe(true);
  });
});

describe("parseProjectVerifyItem", () => {
  it("parses a complete item", () => {
    expect(parseProjectVerifyItem({ deviceId: 4, version: 1, proVerify: 1 })).toEqual({
      deviceId: 4,
      version: 1,
      proVerify: 1,
    });
  });

  it("drops incomplete or non-object items", () => {
    expect(parseProjectVerifyItem(null)).toBeNull();
    expect(parseProjectVerifyItem({ deviceId: 4, version: 1 })).toBeNull();
    expect(parseProjectVerifyItem({ deviceId: "4", version: 1, proVerify: 0 })).toBeNull();
  });
});

describe("ingestProjectVerifyFrame", () => {
  it("upserts known ids and drops unknown ids", () => {
    const known = new Set([1, 2]);
    const next = ingestProjectVerifyFrame(
      new Map([[1, { version: 1, proVerify: 0 }]]),
      [
        { deviceId: 1, version: 1, proVerify: 1 },
        { deviceId: 99, version: 1, proVerify: 1 },
        { deviceId: 2, version: 2, proVerify: 0 },
      ],
      known,
    );
    expect(next.get(1)).toEqual({ version: 1, proVerify: 1 });
    expect(next.get(2)).toEqual({ version: 2, proVerify: 0 });
    expect(next.has(99)).toBe(false);
  });

  it("prunes records for PLCs that left the project", () => {
    const next = ingestProjectVerifyFrame(
      new Map([
        [1, { version: 1, proVerify: 1 }],
        [2, { version: 1, proVerify: 0 }],
      ]),
      [],
      new Set([1]),
    );
    expect([...next.keys()]).toEqual([1]);
  });
});

describe("runtime mismatch flags", () => {
  it("treats equal PROTOCOL_VERSION as not a version mismatch", () => {
    const runtime = reported(1, PROTOCOL_VERSION, 1);
    expect(runtimeVersionMismatch(runtime)).toBe(false);
    expect(runtimeProjectMismatch(runtime)).toBe(true);
  });

  it("temporarily treats a different version as matching", () => {
    expect(runtimeVersionMismatch(reported(1, 2, 0))).toBe(false);
  });

  it("ignores PLCs that have not reported", () => {
    const runtime = createDisconnectedPlcRuntime(1);
    expect(runtimeVersionMismatch(runtime)).toBe(false);
    expect(runtimeProjectMismatch(runtime)).toBe(false);
  });
});

describe("toOpenProjectCppAck", () => {
  it("reads a direct CppAckResult", () => {
    const ack = { success: false, data: [{ deviceId: 1, version: 1, proVerify: 1 }] };
    expect(toOpenProjectCppAck(ack)).toEqual(ack);
  });

  it("unwraps CsocketResult wrapping a CppAckResult", () => {
    const inner = { success: false, data: [{ deviceId: 1, version: 1, proVerify: 1 }] };
    expect(toOpenProjectCppAck({ ok: true, data: inner })).toEqual(inner);
  });
});

describe("isFailedOpenProjectVerifyAck", () => {
  it("is true only when open ACK success is false", () => {
    expect(
      isFailedOpenProjectVerifyAck({
        success: false,
        data: [{ deviceId: 1, version: 1, proVerify: 1 }],
      }),
    ).toBe(true);
    expect(isFailedOpenProjectVerifyAck({ success: true, data: [] })).toBe(false);
    expect(isFailedOpenProjectVerifyAck({ ok: true, data: { success: true } })).toBe(false);
    expect(isFailedOpenProjectVerifyAck(null)).toBe(false);
  });
});

describe("shouldShowProjectMismatchDialog", () => {
  it("does not show without verify data", () => {
    expect(
      shouldShowProjectMismatchDialog([createDisconnectedPlcRuntime(1)], false),
    ).toBe(false);
  });

  it("does not block the project-mismatch dialog on a different protocol version", () => {
    expect(
      shouldShowProjectMismatchDialog(
        [reported(1, 2, 1), reported(2, PROTOCOL_VERSION, 0)],
        false,
      ),
    ).toBe(true);
  });

  it("shows when versions match and any project mismatches", () => {
    expect(
      shouldShowProjectMismatchDialog(
        [reported(1, PROTOCOL_VERSION, 1), createDisconnectedPlcRuntime(2)],
        false,
      ),
    ).toBe(true);
  });

  it("does not show after consumed", () => {
    expect(
      shouldShowProjectMismatchDialog([reported(1, PROTOCOL_VERSION, 1)], true),
    ).toBe(false);
  });
});

describe("plcVerifyStatusLabel", () => {
  it("does not label a different protocol version as version mismatch", () => {
    expect(plcVerifyStatusLabel(reported(1, 2, 1))).toBe("工程不匹配");
  });

  it("returns project mismatch when version matches", () => {
    expect(plcVerifyStatusLabel(reported(1, PROTOCOL_VERSION, 1))).toBe("工程不匹配");
  });

  it("returns undefined when unreported or matched", () => {
    expect(plcVerifyStatusLabel(createDisconnectedPlcRuntime(1))).toBeUndefined();
    expect(plcVerifyStatusLabel(reported(1, PROTOCOL_VERSION, 0))).toBeUndefined();
  });
});
