// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyCouplePreview } from "../../../hooks/couple-preview";
import { CouplePreviewDialog } from "./couple-preview-dialog";

afterEach(() => cleanup());

/** 一次耦合很多物体：每个物体 4 根轴 */
const manyAxes = (objects: number) =>
  classifyCouplePreview(
    Array.from({ length: objects * 4 }, (_, index) => ({
      objectId: Math.floor(index / 4) + 1,
      objectName: `升降灯架-${Math.floor(index / 4) + 1}`,
      motorId: index + 1,
      currentMm: 1000 + index,
      targetMm: 1000 + index,
    })),
  );

const classesOf = (element: Element) => element.className.split(/\s+/);

describe("CouplePreviewDialog 高度限制", () => {
  it("轴很多时弹窗高度限制在窗口内，只有对照表滚动，取消/确认在滚动区外", () => {
    const onConfirm = vi.fn();
    const preview = manyAxes(20);
    render(
      <CouplePreviewDialog open preview={preview} onCancel={() => {}} onConfirm={onConfirm} />,
    );

    const dialog = screen.getByRole("dialog");
    expect(classesOf(dialog)).toEqual(
      expect.arrayContaining(["flex", "flex-col", "overflow-hidden", "max-h-[min(640px,calc(100vh-2rem))]"]),
    );

    const table = screen.getByRole("table");
    const scroll = table.closest('[data-slot="couple-preview-scroll"]');
    expect(scroll).not.toBeNull();
    expect(classesOf(scroll!)).toEqual(expect.arrayContaining(["min-h-0", "overflow-auto"]));
    // 滚动区所在的内容区可以被压缩，标题和底部不行
    expect(classesOf(scroll!.parentElement!)).toEqual(
      expect.arrayContaining(["min-h-0", "flex-auto", "flex-col"]),
    );
    expect(screen.getAllByRole("row")).toHaveLength(preview.rows.length + 1);

    const confirm = screen.getByRole("button", { name: "确认" });
    const cancel = screen.getByRole("button", { name: "取消" });
    expect(scroll!.contains(confirm)).toBe(false);
    expect(scroll!.contains(cancel)).toBe(false);
    expect(classesOf(dialog.querySelector('[data-slot="dialog-footer"]')!)).toContain("shrink-0");
    expect(classesOf(dialog.querySelector('[data-slot="dialog-header"]')!)).toContain("shrink-0");

    // 列头钉在滚动区顶部
    for (const header of screen.getAllByRole("columnheader")) {
      expect(classesOf(header)).toEqual(expect.arrayContaining(["sticky", "top-0"]));
    }

    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
