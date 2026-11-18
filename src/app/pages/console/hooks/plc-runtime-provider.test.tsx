// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { ProjectProvider } from "@/app/project/project-provider";
import {
  installMemoryProjectAPI,
  uninstallMemoryProjectAPI,
} from "@/app/project/install-memory-project-api";
import {
  GZ_2025_RECORD,
  SH_BALLET_RECORD,
} from "@/app/project/test-fixtures";
import { useProject } from "@/app/project/use-project";
import { PlcRuntimeProvider, usePlcRuntime } from "./plc-runtime-provider";
import { ProjectStoreProvider } from "./use-project-store";

beforeEach(() => {
  installMemoryProjectAPI();
});

afterEach(() => {
  cleanup();
  uninstallMemoryProjectAPI();
  delete window.csocketApi;
});

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(
    ProjectProvider,
    null,
    createElement(ProjectStoreProvider, null, createElement(PlcRuntimeProvider, null, children)),
  );

const installMasterStatusMocks = () => {
  let pollingApply: ((msg: unknown) => void) | undefined;
  const getMasterStatusSnapshot = vi.fn(async () => ({ success: true, data: [] }));
  const onReadMasterStatusPolling = vi.fn((apply: (msg: unknown) => void) => {
    pollingApply = apply;
    return () => {
      pollingApply = undefined;
    };
  });
  const openProject = vi.fn(async () => ({ success: true, data: [] }));
  const scanAllMaster = vi.fn(async () => ({
    success: true,
    data: [{ ip: "10.0.0.1", plcModel: 1, axis: [] }],
  }));
  window.csocketApi = {
    onReadMasterStatusPolling,
    getMasterStatusSnapshot,
    onVerifyProject: () => () => {},
    openProject,
    scanAllMaster,
  } as unknown as Window["csocketApi"];
  return {
    getMasterStatusSnapshot,
    onReadMasterStatusPolling,
    openProject,
    scanAllMaster,
    applyPolling: (msg: unknown) => pollingApply?.(msg),
  };
};

describe("PlcRuntimeProvider master status", () => {
  it("subscribes then requests snapshot", async () => {
    const getMasterStatusSnapshot = vi.fn(async () => ({ success: true, data: [] }));
    const onReadMasterStatusPolling = vi.fn(() => () => {});
    window.csocketApi = {
      onReadMasterStatusPolling,
      getMasterStatusSnapshot,
      onVerifyProject: () => () => {},
    } as unknown as Window["csocketApi"];

    renderHook(() => usePlcRuntime(), { wrapper });

    await waitFor(() => {
      expect(onReadMasterStatusPolling).toHaveBeenCalled();
      expect(getMasterStatusSnapshot).toHaveBeenCalled();
    });
  });

  it("clears master status and scan results when project id changes", async () => {
    const mocks = installMasterStatusMocks();

    const { result } = renderHook(
      () => ({
        plc: usePlcRuntime(),
        project: useProject(),
      }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.project.loading).toBe(false));

    await act(async () => {
      await result.current.project.openProject(GZ_2025_RECORD.folderName);
    });
    await waitFor(() => expect(result.current.project.currentProject?.id).toBe("gz-2025"));

    await act(async () => {
      mocks.applyPolling({
        success: true,
        data: [
          {
            deviceId: 1,
            plcModel: 1,
            masterStatus: 1,
            simulationStatus: 0,
            busStatus: 0,
            ruleStartStatus: 0,
            ruleId: 0,
            autoRunStatus: 0,
            autoId: 0,
          },
        ],
      });
    });
    await waitFor(() =>
      expect(result.current.plc.getPlcRuntime(1).lifecycle).toBe("normal"),
    );

    // 打开有主控的工程自动扫描一次
    await waitFor(() => expect(result.current.plc.scan.masters).toHaveLength(1));
    expect(mocks.scanAllMaster).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.project.openProject(SH_BALLET_RECORD.folderName);
    });
    await waitFor(() =>
      expect(result.current.project.currentProject?.id).toBe("sh-ballet"),
    );
    await waitFor(() => expect(result.current.plc.scan.masters).toBeNull());
    // 没有主控的工程不扫描（换工程那一刻手里还是上个工程的主控，也不能拿来触发）
    expect(mocks.scanAllMaster).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.project.openProject(GZ_2025_RECORD.folderName);
    });
    await waitFor(() =>
      expect(result.current.project.currentProject?.id).toBe("gz-2025"),
    );
    await waitFor(() =>
      expect(result.current.plc.getPlcRuntime(1).connection).toBe("disconnected"),
    );
    // 再打开有主控的工程又扫描一次
    await waitFor(() => expect(mocks.scanAllMaster).toHaveBeenCalledTimes(2));
  });

  it("rescans when a monitored master's master, simulation or bus status changes", async () => {
    const mocks = installMasterStatusMocks();
    const { result } = renderHook(
      () => ({
        plc: usePlcRuntime(),
        project: useProject(),
      }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.project.loading).toBe(false));
    await act(async () => {
      await result.current.project.openProject(GZ_2025_RECORD.folderName);
    });
    await waitFor(() => expect(result.current.project.currentProject?.id).toBe("gz-2025"));

    let status = {
      deviceId: 1,
      plcModel: 1,
      masterStatus: 1,
      simulationStatus: 0,
      busStatus: 0,
      ruleStartStatus: 0,
      ruleId: 0,
      autoRunStatus: 0,
      autoId: 0,
    };
    const push = async (overrides: Partial<typeof status>) => {
      status = { ...status, ...overrides };
      await act(async () => {
        mocks.applyPolling({ success: true, data: [status] });
      });
    };

    // 首次收到状态只记下，扫描只有打开工程的那一次
    await push({});
    await waitFor(() => expect(result.current.plc.scan.masters).toHaveLength(1));
    expect(mocks.scanAllMaster).toHaveBeenCalledTimes(1);

    await push({ ruleId: 5, autoRunStatus: 1 });
    expect(mocks.scanAllMaster).toHaveBeenCalledTimes(1);

    const changes: Partial<typeof status>[] = [
      { busStatus: 1 },
      { simulationStatus: 1 },
      { masterStatus: 2 },
    ];
    for (const [offset, change] of changes.entries()) {
      await push(change);
      await waitFor(() => expect(mocks.scanAllMaster).toHaveBeenCalledTimes(offset + 2));
      await waitFor(() => expect(result.current.plc.scan.scanning).toBe(false));
    }
  });

  it("re-pulls the snapshot after a project switch when the main process sends no new frame", async () => {
    const mocks = installMasterStatusMocks();
    mocks.getMasterStatusSnapshot.mockResolvedValue({
      success: true,
      data: [
        {
          deviceId: 1,
          plcModel: 1,
          masterStatus: 1,
          simulationStatus: 0,
          busStatus: 0,
          ruleStartStatus: 0,
          ruleId: 0,
          autoRunStatus: 0,
          autoId: 0,
        },
      ],
    } as never);

    const { result } = renderHook(
      () => ({
        plc: usePlcRuntime(),
        project: useProject(),
      }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.project.loading).toBe(false));
    await act(async () => {
      await result.current.project.openProject(GZ_2025_RECORD.folderName);
    });
    await waitFor(() =>
      expect(result.current.plc.getPlcRuntime(1).lifecycle).toBe("normal"),
    );
    const callsBeforeSwitch = mocks.getMasterStatusSnapshot.mock.calls.length;

    await act(async () => {
      await result.current.project.openProject(SH_BALLET_RECORD.folderName);
    });
    await waitFor(() =>
      expect(result.current.project.currentProject?.id).toBe("sh-ballet"),
    );
    await waitFor(() =>
      expect(mocks.getMasterStatusSnapshot.mock.calls.length).toBeGreaterThan(callsBeforeSwitch),
    );
    await waitFor(() =>
      expect(result.current.plc.getPlcRuntime(1).lifecycle).toBe("normal"),
    );
  });
});
