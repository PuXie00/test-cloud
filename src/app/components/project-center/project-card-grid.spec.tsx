// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { GZ_2025_RECORD } from "@/app/project/test-fixtures";
import { ProjectCardGrid } from "./project-card-grid";

afterEach(cleanup);

it("当前工程标识随打开的工程更新，浏览其他工程时保留", () => {
  const first = { ...GZ_2025_RECORD, id: "first", folderName: "first", name: "工程甲" };
  const second = { ...GZ_2025_RECORD, id: "second", folderName: "second", name: "工程乙" };
  const projects = [first, second];
  const onSelect = vi.fn();
  const { rerender } = render(
    <ProjectCardGrid projects={projects} selectedId={first.id} currentProjectFolderName={first.folderName} onSelect={onSelect} />,
  );
  const firstCard = screen.getByRole("button", { name: /工程甲/ });
  const secondCard = screen.getByRole("button", { name: /工程乙/ });

  fireEvent.click(secondCard);
  expect(onSelect).toHaveBeenCalledWith(second.id);
  rerender(
    <ProjectCardGrid projects={projects} selectedId={second.id} currentProjectFolderName={first.folderName} onSelect={onSelect} />,
  );
  expect(within(firstCard).getByText("当前工程")).toBeTruthy();
  expect(within(secondCard).queryByText("当前工程")).toBeNull();

  rerender(
    <ProjectCardGrid projects={projects} selectedId={second.id} currentProjectFolderName={second.folderName} onSelect={onSelect} />,
  );
  expect(within(firstCard).queryByText("当前工程")).toBeNull();
  expect(within(secondCard).getByText("当前工程")).toBeTruthy();

  rerender(
    <ProjectCardGrid projects={projects} selectedId={second.id} currentProjectFolderName={null} onSelect={onSelect} />,
  );
  expect(screen.queryByText("当前工程")).toBeNull();
});
