// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { SceneGroupConfig } from "@/app/project/project-document-types";
import { QuickGroupMenu } from "./QuickGroupMenu";

const setup = {
  controlledObjects: [{ id: 3 }, { id: 7 }],
  scene: { groups: [] as SceneGroupConfig[] },
};
let document = { setup };
const replaceSelection = vi.fn();
vi.mock("@/app/project/use-project", () => ({
  useProject: () => ({
    currentProject: { document },
    runTrackedDocumentUpdate: (_label: string, update: (doc: typeof document) => typeof document) => {
      document = update(document);
      return { ok: true };
    },
  }),
}));
vi.mock("../../hooks/use-selection", () => ({
  useSelection: () => ({ selectedId: 3, multiSelectedIds: [3, 7], replaceSelection, setTreeFocus: vi.fn() }),
}));
vi.mock("../Viz3DProvider", () => ({ useViz3DContext: () => ({ clearMotorSelection: vi.fn() }) }));
afterEach(cleanup);

it("saves a named selection, recalls it in read-only mode and removes the group", () => {
  const view = render(<QuickGroupMenu canEdit />);
  const open = () => fireEvent.click(screen.getByRole("button", { name: "快捷分组" }));
  open();
  fireEvent.change(screen.getByRole("textbox", { name: "分组名称" }), { target: { value: "开场" } });
  fireEvent.click(screen.getByRole("button", { name: "保存（2）" }));
  expect(document.setup.scene.groups).toMatchObject([{ name: "开场", objectIds: [3, 7] }]);
  view.rerender(<QuickGroupMenu canEdit={false} />);
  expect(screen.queryByRole("button", { name: "删除分组 开场" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "开场（2）" }));
  expect(replaceSelection).toHaveBeenCalledWith([3, 7]);
  view.rerender(<QuickGroupMenu canEdit />);
  open();
  fireEvent.click(screen.getByRole("button", { name: "删除分组 开场" }));
  expect(document.setup.scene.groups).toEqual([]);
});
