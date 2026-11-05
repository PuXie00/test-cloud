// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SelectionProvider } from "./selection-provider";
import { useSelection } from "./use-selection";

afterEach(cleanup);

const renderSelection = () => renderHook(() => useSelection(), { wrapper: SelectionProvider });

describe("unselectable objects", () => {
  it("are skipped by every object selection entry", () => {
    const { result } = renderSelection();
    act(() => result.current.setUnselectableObjectIds(new Set([2])));

    act(() => result.current.select(2));
    expect(result.current.selectedId).toBeNull();
    act(() => result.current.replaceSelection([1, 2, 3]));
    expect(result.current.multiSelectedIds).toEqual([1, 3]);
    act(() => result.current.toggleMulti(2));
    expect(result.current.multiSelectedIds).toEqual([1, 3]);
  });

  it("are dropped from the current selection when they become unselectable", () => {
    const { result } = renderSelection();
    act(() => result.current.replaceSelection([2, 4]));
    act(() => result.current.setUnselectableObjectIds(new Set([2])));
    expect(result.current.multiSelectedIds).toEqual([4]);
    expect(result.current.selectedId).toBeNull();

    act(() => result.current.setUnselectableObjectIds(new Set()));
    act(() => result.current.select(2));
    expect(result.current.selectedId).toBe(2);
  });
});
