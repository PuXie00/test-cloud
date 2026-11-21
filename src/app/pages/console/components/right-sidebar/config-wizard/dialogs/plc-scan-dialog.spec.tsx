// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScannedMaster } from "@/app/pages/console/hooks/plc-runtime-types";
import { PlcScanDialog } from "./plc-scan-dialog";

const addPlcsFromScan = vi.fn(async (results: unknown[]) => results.map((_, id) => ({ id })));
const scanInBackground = vi.fn();
let masters: ScannedMaster[];
let plcs: { id: number; ip: string }[];

vi.mock("@/app/pages/console/hooks/use-project-store", () => ({
  useProjectStore: () => ({ plcs, addPlcsFromScan }),
}));
vi.mock("@/app/pages/console/hooks/plc-runtime-provider", () => ({
  usePlcRuntime: () => ({
    scan: { masters, at: 1, scanning: false, error: null },
    scanAll: vi.fn(async () => masters),
    scanInBackground,
  }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const ax = (busNo: number, slaveNo: number) => ({ busNo, slaveNo, gourdNo: 253 });

beforeEach(() => {
  addPlcsFromScan.mockClear();
  scanInBackground.mockClear();
  plcs = [{ id: 1, ip: "192.168.1.30" }];
  masters = [
    { ip: "192.168.1.30", plcModel: 4, axis: [ax(0, 0)] },
    { ip: "192.168.1.40", plcModel: 4, axis: [ax(0, 0), ax(0, 1), ax(0, 2), ax(1, 3)] },
  ];
});

afterEach(cleanup);

const checkbox = (name: string) => screen.getByRole("checkbox", { name });
const isChecked = (name: string) => checkbox(name).getAttribute("data-state") === "checked";

describe("扫描主控弹窗", () => {
  it("只列工程里没有的主控，默认连同全部电机勾上", () => {
    render(<PlcScanDialog open onOpenChange={() => {}} />);
    expect(screen.queryByText("192.168.1.30")).toBeNull();
    expect(isChecked("添加 192.168.1.40")).toBe(true);
    expect(screen.getByText("4/4")).toBeTruthy();
  });

  it("电机可以不选；按口内顺序，取消一根会连同后面的一起取消、勾一根会连同前面的一起勾上", async () => {
    render(<PlcScanDialog open onOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "展开 192.168.1.40" }));

    fireEvent.click(checkbox("192.168.1.40 C-2"));
    expect(isChecked("192.168.1.40 C-1")).toBe(true);
    expect(isChecked("192.168.1.40 C-2")).toBe(false);
    expect(isChecked("192.168.1.40 C-3")).toBe(false);
    expect(isChecked("192.168.1.40 D-1")).toBe(true);

    fireEvent.click(checkbox("192.168.1.40 D-1"));
    fireEvent.click(checkbox("192.168.1.40 C-2"));
    expect(isChecked("192.168.1.40 C-2")).toBe(true);
    expect(isChecked("192.168.1.40 C-3")).toBe(false);
    expect(screen.getByText("2/4")).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "添加" }));
    });
    expect(addPlcsFromScan).toHaveBeenCalledWith([
      { id: "192.168.1.40", ip: "192.168.1.40", plcModel: 4, axis: [ax(0, 0), ax(0, 1)] },
    ]);
    // 新增主控后再扫描一次
    expect(scanInBackground).toHaveBeenCalledTimes(1);
  });

  it("可以全选 / 全不选主控下的电机，全不选时主控照样添加", async () => {
    render(<PlcScanDialog open onOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "展开 192.168.1.40" }));

    fireEvent.click(checkbox("192.168.1.40 全选电机"));
    expect(screen.getByText("0/4")).toBeTruthy();
    expect(isChecked("192.168.1.40 全选电机")).toBe(false);
    expect(isChecked("添加 192.168.1.40")).toBe(true);

    fireEvent.click(checkbox("192.168.1.40 C-1"));
    expect(isChecked("192.168.1.40 全选电机")).toBe(false);
    fireEvent.click(checkbox("192.168.1.40 全选电机"));
    expect(screen.getByText("4/4")).toBeTruthy();
    expect(isChecked("192.168.1.40 全选电机")).toBe(true);

    fireEvent.click(checkbox("添加 192.168.1.40"));
    fireEvent.click(checkbox("192.168.1.40 全选电机"));
    expect(isChecked("添加 192.168.1.40")).toBe(true);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "添加" }));
    });
    expect(addPlcsFromScan).toHaveBeenCalledWith([
      expect.objectContaining({ ip: "192.168.1.40", axis: [ax(0, 0), ax(0, 1), ax(0, 2), ax(1, 3)] }),
    ]);
  });

  it("取消主控就不添加它", () => {
    render(<PlcScanDialog open onOpenChange={() => {}} />);
    fireEvent.click(checkbox("添加 192.168.1.40"));
    expect(screen.getByText("0/4")).toBeTruthy();
    expect(screen.getByRole("button", { name: "添加" }).hasAttribute("disabled")).toBe(true);
  });
});
