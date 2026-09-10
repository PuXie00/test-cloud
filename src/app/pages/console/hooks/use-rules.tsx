import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { INITIAL_RULES, type Rule } from "@/app/pages/console/components/right-sidebar/rules-data";

type RulesContextValue = {
  rules: Rule[];
  selectedIds: Set<string>;
  setEnabled: (id: string, enabled: boolean) => void;
  toggleSelect: (id: string) => void;
  clearSelection: () => void;
  setBatchEnabled: (enabled: boolean) => void;
  removeSelected: () => void;
};

const RulesContext = createContext<RulesContextValue | null>(null);

export const RulesProvider = ({ children }: { children: ReactNode }) => {
  const [rules, setRules] = useState<Rule[]>(INITIAL_RULES);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const setEnabled = useCallback((id: string, enabled: boolean) => {
    setRules((c) => c.map((r) => (r.id === id ? { ...r, enabled } : r)));
  }, []);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((c) => {
      const next = new Set(c);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const setBatchEnabled = useCallback(
    (enabled: boolean) => {
      setRules((c) => c.map((r) => (selectedIds.has(r.id) ? { ...r, enabled } : r)));
    },
    [selectedIds]
  );

  const removeSelected = useCallback(() => {
    setRules((c) => c.filter((r) => !selectedIds.has(r.id)));
    setSelectedIds(new Set());
  }, [selectedIds]);

  const value = useMemo<RulesContextValue>(
    () => ({ rules, selectedIds, setEnabled, toggleSelect, clearSelection, setBatchEnabled, removeSelected }),
    [rules, selectedIds, setEnabled, toggleSelect, clearSelection, setBatchEnabled, removeSelected]
  );

  return <RulesContext.Provider value={value}>{children}</RulesContext.Provider>;
};

export const useRules = () => {
  const ctx = useContext(RulesContext);
  if (!ctx) throw new Error("useRules must be used inside RulesProvider");
  return ctx;
};
