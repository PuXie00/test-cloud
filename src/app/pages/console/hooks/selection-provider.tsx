import { useCallback, useMemo, useState, type ReactNode } from "react";
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

  const touchObjectSelection = useCallback(() => {
    setObjectSelectGeneration((current) => current + 1);
  }, []);

  const select = useCallback((id: ControlledObjectId | null) => {
    setSelectedId(id);
    setMultiSelectedIds(id ? [id] : []);
    setMultiSelectedMotorIds([]);
    setObjectSelectGeneration((current) => current + 1);
  }, []);

  const toggleMulti = useCallback((id: ControlledObjectId) => {
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
    const unique = [...new Set(ids)];
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
    ],
  );

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
};
