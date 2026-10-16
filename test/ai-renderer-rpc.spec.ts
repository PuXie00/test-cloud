import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiWriteRequestMessage } from "../shared/ai-bridge/types";
import { AiRendererRpc } from "../electron/ai-server/renderer-rpc";

const portStub = () => {
  const sent: AiWriteRequestMessage[] = [];
  return { sent, postMessage: (message: AiWriteRequestMessage) => sent.push(message) };
};

const request = { kind: "upsert-sequence", sequence: { id: 1 } } as const;

describe("AiRendererRpc", () => {
  afterEach(() => vi.useRealTimers());

  it("answers unavailable without a renderer port", async () => {
    const rpc = new AiRendererRpc();
    await expect(rpc.request(request)).resolves.toMatchObject({ ok: false, code: "RENDERER_UNAVAILABLE" });
  });

  it("forwards the request and resolves with the matching response", async () => {
    const rpc = new AiRendererRpc();
    const port = portStub();
    rpc.attach(port);
    const pending = rpc.request(request);
    expect(port.sent).toEqual([{ type: "request", requestId: 1, request }]);

    // 不认识的 requestId 忽略
    rpc.settle({ type: "response", requestId: 99, result: { ok: false, code: "BUSY", message: "x" } });
    const result = { ok: true, created: true, changed: true, sequence: { id: 1 }, warnings: [] } as const;
    rpc.settle({ type: "response", requestId: 1, result });
    await expect(pending).resolves.toEqual(result);
  });

  it("times out when the renderer does not answer", async () => {
    vi.useFakeTimers();
    const rpc = new AiRendererRpc(500);
    rpc.attach(portStub());
    const pending = rpc.request(request);
    vi.advanceTimersByTime(500);
    await expect(pending).resolves.toMatchObject({ ok: false, code: "TIMEOUT" });
  });

  it("fails requests pending on a port that closes or is replaced", async () => {
    const rpc = new AiRendererRpc();
    const first = portStub();
    rpc.attach(first);
    const onReplaced = rpc.request(request);
    const second = portStub();
    rpc.attach(second);
    await expect(onReplaced).resolves.toMatchObject({ code: "RENDERER_UNAVAILABLE" });

    const onClosed = rpc.request(request);
    // 旧口迟到的 close 不影响新口
    rpc.detach(first);
    expect(rpc.connected).toBe(true);
    rpc.detach(second);
    await expect(onClosed).resolves.toMatchObject({ code: "RENDERER_UNAVAILABLE" });
    expect(rpc.connected).toBe(false);
  });
});
