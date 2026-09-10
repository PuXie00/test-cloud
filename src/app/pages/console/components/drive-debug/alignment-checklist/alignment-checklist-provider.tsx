import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "@/app/auth/use-auth";
import { useProject } from "@/app/project/use-project";
import {
  ALIGNMENT_ITEMS,
  confirmedCount,
  createEmptyChecklistState,
  invalidateAfterBuildApply,
  isAllConfirmed,
  type AlignmentChecklistState,
  type AlignmentItemId,
} from "./alignment-checklist-logic";

type AlignmentChecklistContextValue = {
  items: typeof ALIGNMENT_ITEMS;
  state: AlignmentChecklistState;
  allConfirmed: boolean;
  confirmedCount: number;
  totalCount: number;
  dialogOpen: boolean;
  openDialog: () => void;
  closeDialog: () => void;
  confirmItem: (id: AlignmentItemId) => void;
  unconfirmItem: (id: AlignmentItemId) => void;
  confirmAll: () => void;
  markBuildApplied: () => void;
};

const AlignmentChecklistContext = createContext<AlignmentChecklistContextValue | null>(null);

export const AlignmentChecklistProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();
  const { currentProject } = useProject();
  const projectId = currentProject?.id ?? null;

  const [state, setState] = useState<AlignmentChecklistState>(createEmptyChecklistState);
  const [dialogOpen, setDialogOpen] = useState(false);
  const hydratedProjectRef = useRef<string | null>(null);

  // 每次打开/切换工程都重置确认态，要求重新人工确认
  useEffect(() => {
    if (hydratedProjectRef.current === projectId) return;
    hydratedProjectRef.current = projectId;
    setState(createEmptyChecklistState());
  }, [projectId]);

  const confirmItem = useCallback(
    (id: AlignmentItemId) => {
      setState((prev) => ({
        ...prev,
        [id]: {
          confirmed: true,
          confirmedBy: user?.displayName ?? "未知用户",
          confirmedAt: new Date().toISOString(),
        },
      }));
    },
    [user?.displayName],
  );

  const unconfirmItem = useCallback((id: AlignmentItemId) => {
    setState((prev) => ({
      ...prev,
      [id]: { confirmed: false, confirmedBy: null, confirmedAt: null },
    }));
  }, []);

  const confirmAll = useCallback(() => {
    const now = new Date().toISOString();
    const by = user?.displayName ?? "未知用户";
    setState(() =>
      ALIGNMENT_ITEMS.reduce((acc, item) => {
        acc[item.id] = { confirmed: true, confirmedBy: by, confirmedAt: now };
        return acc;
      }, {} as AlignmentChecklistState),
    );
  }, [user?.displayName]);

  const markBuildApplied = useCallback(() => {
    setState((prev) => invalidateAfterBuildApply(prev));
    setDialogOpen(true);
  }, []);

  const value = useMemo<AlignmentChecklistContextValue>(
    () => ({
      items: ALIGNMENT_ITEMS,
      state,
      allConfirmed: isAllConfirmed(state),
      confirmedCount: confirmedCount(state),
      totalCount: ALIGNMENT_ITEMS.length,
      dialogOpen,
      openDialog: () => setDialogOpen(true),
      closeDialog: () => setDialogOpen(false),
      confirmItem,
      unconfirmItem,
      confirmAll,
      markBuildApplied,
    }),
    [state, dialogOpen, confirmItem, unconfirmItem, confirmAll, markBuildApplied],
  );

  return (
    <AlignmentChecklistContext.Provider value={value}>{children}</AlignmentChecklistContext.Provider>
  );
};

export const useAlignmentChecklist = (): AlignmentChecklistContextValue => {
  const ctx = useContext(AlignmentChecklistContext);
  if (!ctx) throw new Error("useAlignmentChecklist must be used inside AlignmentChecklistProvider");
  return ctx;
};
