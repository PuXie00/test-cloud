import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import type { ProjectSelection } from "../components/right-sidebar/project-data";
import {
  SelectionContext,
  type ControlledObjectId,
  type MotorId,
} from "./selection-context";

type SelectionProviderProps = { children: ReactNode };

const isSameProjectSelection = (a: ProjectSelection, b: ProjectSelection): boolean => {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return a.kind === b.kind && a.id === b.id;
};

const sameIdList = (a: number[], b: number[]): boolean =>
  a.length === b.length && a.every((id, index) => id === b[index]);

export const SelectionProvider = ({ children }: SelectionProviderProps) => {
  const [selectedId, setSelectedId] = useState<ControlledObjectId | null>(null);
  const [multiSelectedIds, setMultiSelectedIds] = useState<ControlledObjectId[]>([]);
  const [multiSelectedMotorIds, setMultiSelectedMotorIds] = useState<MotorId[]>([]);
  const [treeFocus, setTreeFocusState] = useState<ProjectSelection>(null);
  const [objectSelectGeneration, setObjectSelectGeneration] = useState(0);
  // 选不中的物体（控制页、动作页的占位物体）；所有选中入口都在这里过滤
  const unselectableRef = useRef<ReadonlySet<ControlledObjectId>>(new Set());

  const touchObjectSelection = useCallback(() => {
    setObjectSelectGeneration((current) => current + 1);
  }, []);

  const select = useCallback((id: ControlledObjectId | null) => {
    if (id !== null && unselectableRef.current.has(id)) return;
    setSelectedId(id);
    setMultiSelectedIds(id ? [id] : []);
    setMultiSelectedMotorIds([]);
    setObjectSelectGeneration((current) => current + 1);
  }, []);

  const toggleMulti = useCallback((id: ControlledObjectId) => {
    if (unselectableRef.current.has(id)) return;
    setMultiSelectedMotorIds([]);
    setMultiSelectedIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
    setSelectedId(id);
    setObjectSelectGeneration((current) => current + 1);
  }, []);

  const replaceMotorSelection = useCallback((ids: MotorId[]) => {
    const unique = [...new Set(ids)];
    setSelectedId(null);
    setMultiSelectedIds([]);
    setMultiSelectedMotorIds((prev) => (sameIdList(prev, unique) ? prev : unique));
  }, []);

  const toggleMultiMotor = useCallback((id: MotorId) => {
    setSelectedId(null);
    setMultiSelectedIds([]);
    setMultiSelectedMotorIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedId(null);
    setMultiSelectedIds([]);
    setMultiSelectedMotorIds([]);
  }, []);

  const replaceSelection = useCallback((ids: ControlledObjectId[]) => {
    const unique = [...new Set(ids)].filter((id) => !unselectableRef.current.has(id));
    setMultiSelectedMotorIds([]);
    setSelectedId((prev) => {
      const nextSelected = unique[0] ?? null;
      return prev === nextSelected ? prev : nextSelected;
    });
    setMultiSelectedIds((prev) => (sameIdList(prev, unique) ? prev : unique));
    setObjectSelectGeneration((current) => current + 1);
  }, []);

  const setTreeFocus = useCallback((selection: ProjectSelection) => {
    setTreeFocusState((prev) => (isSameProjectSelection(prev, selection) ? prev : selection));
  }, []);

  const setUnselectableObjectIds = useCallback((ids: ReadonlySet<ControlledObjectId>) => {
    unselectableRef.current = ids;
    if (ids.size === 0) return;
    setMultiSelectedIds((prev) => {
      const kept = prev.filter((id) => !ids.has(id));
      return kept.length === prev.length ? prev : kept;
    });
    setSelectedId((prev) => (prev !== null && ids.has(prev) ? null : prev));
  }, []);

  const value = useMemo(
    () => ({
      selectedId,
      select,
      toggleMulti,
      multiSelectedIds,
      multiSelectedMotorIds,
      toggleMultiMotor,
      replaceMotorSelection,
      clearSelection,
      replaceSelection,
      objectSelectGeneration,
      touchObjectSelection,
      treeFocus,
      setTreeFocus,
      setUnselectableObjectIds,
    }),
    [
      selectedId,
      select,
      toggleMulti,
      multiSelectedIds,
      multiSelectedMotorIds,
      toggleMultiMotor,
      replaceMotorSelection,
      clearSelection,
      replaceSelection,
      objectSelectGeneration,
      touchObjectSelection,
      treeFocus,
      setTreeFocus,
      setUnselectableObjectIds,
    ],
  );

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
};
