// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiWriteRequest, AiWriteResult } from "../shared/ai-bridge/types";
import { TestPermissionsProvider } from "../src/app/auth/permissions";
import { useAiWriteHandler } from "../src/app/ai-bridge/use-ai-write-handler";

const updateCurrentDocument = vi.fn();
vi.mock("@/app/project/use-project", () => ({
  useProject: () => ({ currentProject: null, updateCurrentDocument }),
}));

afterEach(() => {
  cleanup();
  delete window.aiBridgeApi;
  updateCurrentDocument.mockReset();
});

const Host = () => {
  useAiWriteHandler();
  return null;
};

const captureHandler = () => {
  let handler: ((request: AiWriteRequest) => AiWriteResult | Promise<AiWriteResult>) | null = null;
  window.aiBridgeApi = {
    publish: vi.fn(),
    onWriteRequest: (next) => {
      handler = next;
      return () => undefined;
    },
  };
  return () => handler!;
};

const request = { kind: "upsert-sequence", sequence: {} } as AiWriteRequest;

describe("本地 AI 写入按当前用户权限", () => {
  it("没有「编辑动作序列」时拒绝（FORBIDDEN），不碰工程", async () => {
    const handler = captureHandler();
    render(
      <TestPermissionsProvider permissions={["action.view"]}>
        <Host />
      </TestPermissionsProvider>,
    );
    const result = await handler()(request);
    expect(result).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(updateCurrentDocument).not.toHaveBeenCalled();
  });

  it("有权限时照常往下走（这里没打开工程 → NO_PROJECT）", async () => {
    const handler = captureHandler();
    render(
      <TestPermissionsProvider permissions={["action.view", "action.edit"]}>
        <Host />
      </TestPermissionsProvider>,
    );
    expect(await handler()(request)).toMatchObject({ ok: false, code: "NO_PROJECT" });
  });
});
