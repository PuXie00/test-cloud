// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import type { LogQueryParams, LogRecord } from "@shared/csocket/operation-log";
import { DisplayLengthUnitProvider } from "@/app/project/display-length-unit-provider";
import { OperationLogDialog } from "./operation-log-dialog";

const STORAGE_KEY = "yz.operationLog.pageSize";

let total = 120;
let hasProject = true;
const logExport = vi.fn<() => Promise<{ canceled: boolean }>>();

vi.mock("@/app/project/use-project", () => ({
  useProject: () => ({ currentProject: hasProject ? { folderName: "test-project" } : null }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const recordAt = (n: number): LogRecord => ({
  id: `r-${n}`,
  timestamp: 10_000_000 - n * 1000,
  category: "optRet",
  level: "info",
  message: `记录 ${n}`,
  opGroup: "device",
  result: 0,
});

const logQuery = vi.fn(async ([params]: LogQueryParams[]) => {
  const offset = params?.offset ?? 0;
  const limit = params?.limit ?? 50;
  const count = Math.max(0, Math.min(limit, total - offset));
  return {
    success: true,
    data: [{ total, records: Array.from({ length: count }, (_, i) => recordAt(offset + i)) }],
  };
});

const lastQuery = (): LogQueryParams => logQuery.mock.calls.at(-1)![0][0]!;

const renderDialog = () =>
  render(
    <DisplayLengthUnitProvider initialUnit="mm">
      <OperationLogDialog open onOpenChange={() => {}} />
    </DisplayLengthUnitProvider>,
  );

beforeEach(() => {
  total = 120;
  hasProject = true;
  logExport.mockReset();
  vi.clearAllMocks();
  window.localStorage.clear();
  (window as unknown as { csocketApi: unknown }).csocketApi = {
    logQuery,
    logExport,
    logFilterOptions: async () => ({
      success: true,
      data: [{ users: [], timeRange: null }],
    }),
    logAlarmReview: vi.fn(),
  };
});

afterEach(() => cleanup());

describe("OperationLogDialog 分页", () => {
  it("默认每页 50 条，取最新的第一页", async () => {
    renderDialog();
    expect(await screen.findByText("共 120 条")).not.toBeNull();
    expect(lastQuery()).toMatchObject({ order: "desc", offset: 0, limit: 50 });
    expect(screen.getByText("第 1 / 3 页")).not.toBeNull();
    expect((screen.getByRole("button", { name: "上一页" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByRole("row")).toHaveLength(51);
  });

  it("下一页按 offset 取下一页，到最后一页时不能再往后", async () => {
    renderDialog();
    await screen.findByText("共 120 条");
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() => expect(lastQuery()).toMatchObject({ offset: 50, limit: 50 }));
    expect(screen.getByText("第 2 / 3 页")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() => expect(lastQuery()).toMatchObject({ offset: 100, limit: 50 }));
    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(21));
    expect((screen.getByRole("button", { name: "下一页" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "上一页" }));
    await waitFor(() => expect(lastQuery()).toMatchObject({ offset: 50 }));
  });

  it("改每页条数回到第一页，并记住选择", async () => {
    renderDialog();
    await screen.findByText("共 120 条");
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() => expect(lastQuery()).toMatchObject({ offset: 50 }));
    fireEvent.change(screen.getByRole("combobox", { name: "每页条数" }), { target: { value: "100" } });
    await waitFor(() => expect(lastQuery()).toMatchObject({ offset: 0, limit: 100 }));
    expect(screen.getByText("第 1 / 2 页")).not.toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("100");
  });

  it("打开时用上次选的每页条数，不合法的值回到 50", async () => {
    window.localStorage.setItem(STORAGE_KEY, "500");
    const { unmount } = renderDialog();
    await screen.findByText("共 120 条");
    expect(lastQuery()).toMatchObject({ limit: 500 });
    unmount();

    window.localStorage.setItem(STORAGE_KEY, "2000");
    renderDialog();
    await screen.findByText("共 120 条");
    expect(lastQuery()).toMatchObject({ limit: 50 });
  });

  it("每页条数只能选 50 / 100 / 500", async () => {
    renderDialog();
    await screen.findByText("共 120 条");
    const options = Array.from(
      (screen.getByRole("combobox", { name: "每页条数" }) as HTMLSelectElement).options,
    ).map((option) => option.value);
    expect(options).toEqual(["50", "100", "500"]);
  });

  it("改筛选条件回到第一页", async () => {
    renderDialog();
    await screen.findByText("共 120 条");
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() => expect(lastQuery()).toMatchObject({ offset: 50 }));
    fireEvent.change(screen.getByRole("combobox", { name: "时间范围" }), { target: { value: "1h" } });
    await waitFor(() => expect(lastQuery()).toMatchObject({ offset: 0, limit: 50 }));
    expect(lastQuery().startTime).toBeDefined();
  });

  it("刷新后总数变少时停在最后一页", async () => {
    renderDialog();
    await screen.findByText("共 120 条");
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() => expect(screen.getByText("第 3 / 3 页")).not.toBeNull());
    total = 60;
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    await waitFor(() => expect(screen.getByText("第 2 / 2 页")).not.toBeNull());
    await waitFor(() => expect(lastQuery()).toMatchObject({ offset: 50 }));
  });

  it("不再提示「请缩小筛选范围」", async () => {
    total = 5000;
    renderDialog();
    expect(await screen.findByText("共 5000 条")).not.toBeNull();
    expect(screen.queryByText(/请缩小筛选范围/)).toBeNull();
  });
});

describe("OperationLogDialog 导出", () => {
  it("请求完整工程日志，导出期间防止重复点击，完成后显示成功提示", async () => {
    let finish!: (result: { canceled: boolean }) => void;
    logExport.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    renderDialog();
    await screen.findByText("共 120 条");
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    await screen.findByText("第 2 / 3 页");
    fireEvent.click(screen.getByRole("button", { name: "导出日志" }));
    const pending = screen.getByRole("button", { name: "导出中…" }) as HTMLButtonElement;
    expect(pending.disabled).toBe(true);
    fireEvent.click(pending);
    expect(logExport.mock.calls).toEqual([[]]);
    await act(async () => { finish({ canceled: false }); });
    expect(toast.success).toHaveBeenCalledWith("日志已导出");
    expect((screen.getByRole("button", { name: "导出日志" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("取消保存时安静返回，失败时说明原因并允许重试", async () => {
    logExport.mockResolvedValueOnce({ canceled: true }).mockRejectedValueOnce(new Error("磁盘空间不足"));
    renderDialog();
    await screen.findByText("共 120 条");
    fireEvent.click(screen.getByRole("button", { name: "导出日志" }));
    fireEvent.click(await screen.findByRole("button", { name: "导出日志" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("磁盘空间不足")));
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.success).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "导出日志" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("未打开工程时禁用导出", async () => {
    hasProject = false;
    renderDialog();
    await screen.findByText("共 120 条");
    const button = screen.getByRole("button", { name: "导出日志" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toContain("打开工程");
    fireEvent.click(button);
    expect(logExport).not.toHaveBeenCalled();
  });
});
