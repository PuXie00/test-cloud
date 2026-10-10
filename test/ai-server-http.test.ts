import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AiConfigPayload } from "../shared/ai-bridge/types";
import type { ProjectDocumentLike } from "../shared/project/types";
import { createAiHttpServer } from "../electron/ai-server/http";
import { AiBridgeStore } from "../electron/ai-server/store";

type Reply = { status: number; headers: http.IncomingHttpHeaders; body: string };

const document: ProjectDocumentLike = {
  schemaVersion: "test",
  meta: {
    id: "p1",
    name: "演示",
    createdAt: "2026-01-01",
    modifiedAt: "2026-01-02",
    author: "me",
    wizard: { currentStep: "review" },
  },
  setup: {
    plcs: [{ id: 1, masterTypeId: "AC802_0", ip: "192.168.0.10" }],
    motors: [
      { id: 11, plcId: 1, controlledObjectId: 21, productModel: "HOIST" },
      { id: 12, plcId: 1, controlledObjectId: null, productModel: "HOIST" },
    ],
    controlledObjects: [
      { id: 21, name: "主幕", parentId: null },
      { id: 22, name: "侧幕", parentId: 21 },
    ],
  },
  motion: { actionSequences: [{ id: 5, name: "开场" }] },
  rules: { list: [] },
  view: { camera: { alpha: 1 } },
  snapshots: [{ big: true }],
};

const config: AiConfigPayload = {
  revision: 7,
  dirty: true,
  document,
  names: {
    plcs: { "1": "主控PLC-01" },
    motors: { "11": "Hoist-C-1", "12": "Hoist-C-2" },
    objects: { "21": "主幕", "22": "侧幕" },
    sequences: { "5": "开场" },
  },
};

describe("ai-server HTTP", () => {
  let store: AiBridgeStore;
  let server: http.Server;
  let port: number;

  const request = (
    path: string,
    options: { method?: string; headers?: http.OutgoingHttpHeaders } = {},
  ): Promise<Reply> =>
    new Promise((resolve, reject) => {
      const req = http.request(
        { host: "127.0.0.1", port, path, method: options.method ?? "GET", headers: options.headers },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () =>
            resolve({
              status: res.statusCode ?? 0,
              headers: res.headers,
              body: Buffer.concat(chunks).toString("utf8"),
            }),
          );
        },
      );
      req.on("error", reject);
      req.end();
    });

  const getJson = async (path: string) => {
    const reply = await request(path);
    expect(reply.status).toBe(200);
    return JSON.parse(reply.body);
  };

  beforeAll(async () => {
    store = new AiBridgeStore();
    server = createAiHttpServer(store);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    store.resetRenderer();
    store.applyStatus({ reset: true, connection: "idle" });
  });

  it("rejects a foreign Host header (DNS rebinding)", async () => {
    const reply = await request("/api/view", { headers: { Host: `evil.example:${port}` } });
    expect(reply.status).toBe(403);
    expect(JSON.parse(reply.body).code).toBe("FORBIDDEN_HOST");
    expect(reply.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("accepts localhost with the bound port", async () => {
    const reply = await request("/api/health", { headers: { Host: `localhost:${port}` } });
    expect(reply.status).toBe(200);
    expect(JSON.parse(reply.body).ok).toBe(true);
  });

  it("is read-only and 404s unknown paths", async () => {
    const post = await request("/api/view", { method: "POST" });
    expect(post.status).toBe(405);
    expect(post.headers.allow).toBe("GET, HEAD");
    expect((await request("/api/nope")).status).toBe(404);
  });

  it("serves the view pushed by the renderer", async () => {
    store.rendererConnected = true;
    store.applyRenderer({
      type: "page",
      data: {
        page: "console",
        path: "/console",
        ruleId: null,
        project: { id: "p1", name: "演示", folderName: "演示", dirty: true },
      },
    });
    store.applyRenderer({
      type: "console",
      data: {
        mode: "rehearsal",
        nav: "sequences",
        tab: "selection",
        selection: {
          objects: [{ id: 21, name: "主幕" }],
          primaryObjectId: 21,
          motors: [],
          treeFocus: null,
          sequence: { id: 5, name: "开场" },
        },
      },
    });

    const view = await getJson("/api/view");
    expect(view).toMatchObject({
      rendererConnected: true,
      page: "console",
      project: { name: "演示", dirty: true },
      console: { nav: "sequences", selection: { sequence: { id: 5, name: "开场" } } },
    });
  });

  it("strips view / snapshots / wizard from config by default", async () => {
    expect((await getJson("/api/config")).config).toBeNull();

    store.applyRenderer({ type: "config", data: config });
    const body = await getJson("/api/config");
    expect(body.revision).toBe(7);
    expect(body.dirty).toBe(true);
    expect(Object.keys(body.config).sort()).toEqual(["meta", "motion", "rules", "schemaVersion", "setup"]);
    expect(body.config.meta.wizard).toBeUndefined();
    expect(body.config.meta.name).toBe("演示");

    const sections = await getJson("/api/config?sections=setup,bogus");
    expect(Object.keys(sections.config).sort()).toEqual(["schemaVersion", "setup"]);

    const full = await getJson("/api/config?full=1");
    expect(full.config).toEqual(document);
  });

  it("joins live status with configured entities and names", async () => {
    store.applyRenderer({ type: "config", data: config });
    store.applyStatus({
      connection: "connected",
      upsert: {
        plcs: [
          {
            deviceId: 1,
            plcModel: 0,
            masterStatus: 1,
            simulationStatus: 0,
            busStatus: 1,
            ruleStartStatus: 0,
            ruleId: 0,
            autoRunStatus: 0,
            autoId: 0,
          },
        ],
        objects: [{ deviceId: 21, modelStatus: 17, virtualAxisHPosition: 1200 }],
        motors: [
          { deviceId: 11, axisStatus: 3, actualPosition: 10 },
          { deviceId: 99, axisStatus: 2 },
        ],
        actions: [{ actionId: 5, state: 3, loopCount: 1, loopCountSet: 3, runTime: 120 }],
      },
    });

    const status = await getJson("/api/status");
    expect(status.connection).toBe("connected");
    expect(status.plcs).toEqual([
      expect.objectContaining({ id: 1, name: "主控PLC-01", ip: "192.168.0.10", live: true, masterStatus: 1 }),
    ]);
    expect(status.objects).toEqual([
      expect.objectContaining({
        id: 21,
        name: "主幕",
        live: true,
        status: "running",
        statusLabel: "运动",
        modelStatus: 17,
        virtualAxisHPosition: 1200,
      }),
      expect.objectContaining({ id: 22, name: "侧幕", parentId: 21, live: false, status: "offline" }),
    ]);
    expect(status.motors).toEqual([
      expect.objectContaining({ id: 11, name: "Hoist-C-1", objectId: 21, plcId: 1, statusLabel: "运动" }),
      expect.objectContaining({ id: 12, live: false, status: "offline", statusLabel: "离线" }),
      // 只在实时数据里出现的设备追加在后
      expect.objectContaining({ id: 99, name: null, live: true, status: "ready" }),
    ]);
    expect(status.actions).toEqual([
      {
        sequenceId: 5,
        name: "开场",
        state: 3,
        stateLabel: "运行中",
        loopCount: 1,
        loopCountSet: 3,
        runTime: 120,
      },
    ]);
  });

  it("filters status by kind and id", async () => {
    store.applyRenderer({ type: "config", data: config });
    const status = await getJson("/api/status?kinds=motors,objects&objects=22&motors=11");
    expect(Object.keys(status).sort()).toEqual(["connection", "motors", "objects", "updatedAt", "version"]);
    expect(status.objects.map((item: { id: number }) => item.id)).toEqual([22]);
    expect(status.motors.map((item: { id: number }) => item.id)).toEqual([11]);
  });

  it("answers 304 while unchanged and a new ETag after a change", async () => {
    const first = await request("/api/status");
    const etag = first.headers.etag as string;
    expect(etag).toBeTruthy();

    const same = await request("/api/status", { headers: { "If-None-Match": etag } });
    expect(same.status).toBe(304);
    expect(same.body).toBe("");

    // 配置变化会改名称，状态版本也要跟着变
    store.applyRenderer({ type: "config", data: config });
    const changed = await request("/api/status", { headers: { "If-None-Match": etag } });
    expect(changed.status).toBe(200);
    expect(changed.headers.etag).not.toBe(etag);
  });

  it("does not bump the status version for an empty clear", async () => {
    const before = store.version("status");
    store.applyStatus({ clear: ["motors"], connection: "idle" });
    expect(store.version("status")).toBe(before);
  });
});
