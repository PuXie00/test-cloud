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
    data: [{ ip: "10.0.0.1", plcModel: 1, axisCount: 4 }],
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

    await act(async () => {
      await result.current.plc.scanAll();
    });
    await waitFor(() => expect(result.current.plc.scannedMasters).toHaveLength(1));

    await act(async () => {
      await result.current.project.openProject(SH_BALLET_RECORD.folderName);
    });
    await waitFor(() =>
      expect(result.current.project.currentProject?.id).toBe("sh-ballet"),
    );
    expect(result.current.plc.scannedMasters).toEqual([]);

    await act(async () => {
      await result.current.project.openProject(GZ_2025_RECORD.folderName);
    });
    await waitFor(() =>
      expect(result.current.project.currentProject?.id).toBe("gz-2025"),
    );
    expect(result.current.plc.getPlcRuntime(1).lifecycle).toBe("disconnected");
  });
});
