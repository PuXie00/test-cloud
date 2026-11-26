// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { HaAppMessage } from "../shared/ha/protocol";
import { DEFAULT_HA_SYNC_SCOPE, type HaState } from "../shared/ha/types";
import { TestPermissionsProvider } from "../src/app/auth/permissions";
import { HaProjectSyncProvider } from "../src/app/hot-standby/ha-project-sync-provider";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock("@/app/viz3d", () => ({
  getViz3DEngine: () => ({ getSavedView: () => null, captureCoverPngBase64: () => "" }),
}));

const PROJECT = { id: "p-1", name: "演出", formatVersion: 1 };
const PRIMARY = "192.168.0.100";
const STANDBY = "192.168.0.101";

const document = {
  schemaVersion: "1",
  meta: { id: PROJECT.id, name: PROJECT.name, author: "a", wizard: {}, createdAt: "c", modifiedAt: "m" },
  setup: { plcs: [], motors: [], controlledObjects: [{ id: 6, name: "吊杆" }], alignment: {} },
  motion: { actionSequences: [], programs: [] },
  rules: { rules: [] },
  view: {},
  snapshots: [],
};

const project = {
  currentProject: { id: PROJECT.id, document },
  documentRevision: { value: 1, origin: "version-restore" },
  isTrackedEditActive: false,
  isSaving: false,
  isDirty: false,
  applyRemoteDocument: vi.fn(() => ({ ok: true, changed: true })),
  getCurrentDocument: () => document,
  markDocumentSaved: vi.fn(),
  saveCurrentProject: vi.fn(async () => undefined),
};

vi.mock("@/app/project/use-project", () => ({ useProject: () => project }));

beforeAll(() => {
  if (!globalThis.crypto?.subtle) {
    Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
  }
});

const standbyState: HaState = {
  enabled: true,
  role: "standby",
  hostName: "控台-B",
  localIp: STANDBY,
  primaryIp: PRIMARY,
  syncScope: DEFAULT_HA_SYNC_SCOPE,
  localProject: PROJECT,
  peers: [
    {
      ip: PRIMARY,
      link: "up",
      hostName: "控台-A",
      role: "primary",
      project: PROJECT,
      versionMismatch: false,
      closedByPeer: false,
    },
  ],
  deviceGate: "还没和主机核对完成，只能停止、总停止",
  error: null,
};

const installApi = () => {
  let stateListener: ((state: HaState) => void) | null = null;
  let messageListener: ((event: { from: string; message: HaAppMessage }) => void) | null = null;
  const posted: { to: string[] | "all"; message: HaAppMessage }[] = [];
  window.haAPI = {
    getSettings: vi.fn(),
    saveSettings: vi.fn(),
    listLocalIps: vi.fn(),
    getState: vi.fn(async () => ({ ...standbyState, enabled: false })),
    start: vi.fn(),
    stop: vi.fn(),
    onState: (listener: (state: HaState) => void) => {
      stateListener = listener;
      return () => {
        stateListener = null;
      };
    },
    post: vi.fn(async (to: string[] | "all", message: HaAppMessage) => {
      posted.push({ to, message });
      return true;
    }),
    onMessage: (listener: (event: { from: string; message: HaAppMessage }) => void) => {
      messageListener = listener;
      return () => {
        messageListener = null;
      };
    },
    setSynced: vi.fn(async () => undefined),
    setPeerBusy: vi.fn(async () => undefined),
    syncModels: vi.fn(async () => undefined),
    writeSynced: vi.fn(async () => ({ ok: true as const, data: null })),
    backup: vi.fn(async () => ({ ok: true as const, data: null })),
    getSyncRecord: vi.fn(async () => null),
    setSyncRecord: vi.fn(async () => undefined),
  } as unknown as NonNullable<Window["haAPI"]>;
  return {
    posted,
    pushState: (state: HaState) => act(() => stateListener?.(state)),
    pushMessage: (from: string, message: HaAppMessage) => act(() => messageListener?.({ from, message })),
  };
};

afterEach(() => {
  cleanup();
  delete window.haAPI;
});

describe("HaProjectSyncProvider", () => {
  it("starts the check when the primary is ready and asks which side to keep", async () => {
    const api = installApi();
    render(
      <TestPermissionsProvider permissions={["collab.manage"]}>
        <HaProjectSyncProvider>
          <div />
        </HaProjectSyncProvider>
      </TestPermissionsProvider>,
    );
    api.pushState(standbyState);
    await waitFor(() =>
      expect(api.posted).toContainEqual({
        to: [PRIMARY],
        message: { type: "sync-hello", projectId: PROJECT.id, digest: "", state: "checking" },
      }),
    );

    api.pushMessage(PRIMARY, {
      type: "sync-hello",
      projectId: PROJECT.id,
      digest: "different",
      scope: DEFAULT_HA_SYNC_SCOPE,
      reply: true,
    });
    const usePrimary = await screen.findByRole("button", { name: "用主机的" });
    expect(screen.getByText("和主机（控台-A）的工程不一样")).toBeTruthy();
    fireEvent.click(usePrimary);
    await waitFor(() =>
      expect(api.posted.at(-1)).toEqual({ to: [PRIMARY], message: { type: "pull", projectId: PROJECT.id } }),
    );
  });
});
