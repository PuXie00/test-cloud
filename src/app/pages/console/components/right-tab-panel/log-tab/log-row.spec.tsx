// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { LogRecord } from "@shared/csocket/operation-log";
import { LogRow } from "./log-row";

afterEach(() => cleanup());

describe("LogRow", () => {
  it("shows a failed or timed-out op call's message as is, without a result suffix", () => {
    const message = "指令[模型点动]执行失败：当前状态无法执行操作(0x0009):{设备:6~8,12}";
    for (const result of [0, 2] as const) {
      const entry: LogRecord = {
        id: `r${result}`,
        timestamp: 0,
        category: "optRet",
        level: "warning",
        message,
        opGroup: "device",
        result,
      };
      const { container } = render(<LogRow entry={entry} />);
      expect(screen.getByText(message)).toBeTruthy();
      expect(container.textContent).not.toMatch(/· (失败|超时)/);
      cleanup();
    }
  });
});
