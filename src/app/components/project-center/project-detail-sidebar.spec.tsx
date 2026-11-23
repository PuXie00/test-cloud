// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GZ_2025_RECORD } from "@/app/project/test-fixtures";
import type { ProjectRecord } from "@/app/project/project-types";
import { ProjectCard } from "./project-card";
import { ProjectDetailSidebar } from "./project-detail-sidebar";

afterEach(() => cleanup());

const record = (patch: Partial<ProjectRecord>): ProjectRecord => ({
  ...GZ_2025_RECORD,
  versionHistory: [{ version: "升级前自动备份（工程格式 v1）", date: "2026-11-16", historyId: "h1" }],
  ...patch,
});

const renderSidebar = (project: ProjectRecord) => {
  const handlers = { onOpen: vi.fn(), onSaveAs: vi.fn(), onExport: vi.fn(), onRestore: vi.fn() };
  render(<ProjectDetailSidebar project={project} {...handlers} />);
  return handlers;
};

describe("工程格式版本", () => {
  it("当前格式：能打开，不提示", () => {
    renderSidebar(record({ compat: "ok", formatVersion: 1 }));
    expect(screen.getByText("v1")).toBeTruthy();
    expect((screen.getByRole("button", { name: "打开工程" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole("button", { name: "另存为副本" })).toBeTruthy();
  });

  it("旧格式：能打开，提示保存时会升级", () => {
    renderSidebar(
      record({ compat: "upgrade", formatVersion: 1, compatMessage: "旧格式工程（v1）。打开后保存会升级到 v2" }),
    );
    expect(screen.getByText(/打开后保存会升级/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "打开工程" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("版本过高：不能打开、不能另存为，但能导出和恢复历史版本", () => {
    const handlers = renderSidebar(
      record({ compat: "too-new", formatVersion: 3, compatMessage: "此工程由更高版本的软件保存" }),
    );
    expect(screen.getByText("v3")).toBeTruthy();
    expect(screen.getByText(/此工程由更高版本的软件保存.*从下面的版本历史恢复/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "打开工程" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "另存为副本" })).toBeNull();
    expect(screen.getByRole("button", { name: "导出备份" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "恢复 升级前自动备份（工程格式 v1）" }));
    expect(handlers.onRestore).toHaveBeenCalledWith(expect.objectContaining({ historyId: "h1" }));
  });

  it("读不了：格式显示未知", () => {
    renderSidebar(record({ compat: "invalid", formatVersion: null, compatMessage: "此工程无法读取：工程配置结构无效" }));
    expect(screen.getByText("未知")).toBeTruthy();
    expect((screen.getByRole("button", { name: "打开工程" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("当前打开的工程不能删除，其它工程可以", () => {
    const onDelete = vi.fn();
    const { rerender } = render(
      <ProjectDetailSidebar
        project={record({})}
        onOpen={vi.fn()}
        onDelete={onDelete}
        deleteDisabled
      />,
    );
    const blocked = screen.getByRole("button", { name: "删除工程" }) as HTMLButtonElement;
    expect(blocked.disabled).toBe(true);
    expect(blocked.title).toBe("当前打开的工程不能删除");
    fireEvent.click(blocked);
    expect(onDelete).not.toHaveBeenCalled();

    rerender(
      <ProjectDetailSidebar project={record({})} onOpen={vi.fn()} onDelete={onDelete} />,
    );
    const allowed = screen.getByRole("button", { name: "删除工程" }) as HTMLButtonElement;
    expect(allowed.disabled).toBe(false);
    fireEvent.click(allowed);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("卡片角标", () => {
    const { rerender } = render(
      <ProjectCard project={record({ compat: "too-new" })} selected={false} onSelect={vi.fn()} />,
    );
    expect(screen.getByText("版本过高")).toBeTruthy();
    rerender(<ProjectCard project={record({ compat: "upgrade" })} selected={false} onSelect={vi.fn()} />);
    expect(screen.getByText("旧格式")).toBeTruthy();
    rerender(<ProjectCard project={record({ compat: "ok" })} selected={false} onSelect={vi.fn()} />);
    expect(screen.queryByText("旧格式")).toBeNull();
    expect(screen.queryByText("版本过高")).toBeNull();
  });
});
