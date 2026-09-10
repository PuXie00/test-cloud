import {
  useEffect,
  useRef,
  type ChangeEvent,
  type FocusEvent,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { isEditableHistoryTarget } from "@/app/project/project-history-shortcuts";
import { useProject } from "@/app/project/use-project";

export type ProjectEditBoundaryProps = {
  ownerPrefix: string;
  label: string;
  children: ReactNode;
};

type EditSession = {
  owner: string;
  source: "pointer" | "focus";
};

const resolveNumericOwner = (
  ownerPrefix: string,
  target: EventTarget | null,
): string | null => {
  if (!(target instanceof Element)) {
    return null;
  }
  const numeric = target.closest<HTMLElement>(
    "[data-history-interaction='numeric']",
  );
  if (!numeric) {
    return null;
  }
  return `${ownerPrefix}:${numeric.dataset.historyField ?? "numeric"}`;
};

const resolveFocusOwner = (
  ownerPrefix: string,
  target: EventTarget | null,
): string | null => {
  if (!isEditableHistoryTarget(target) || !(target instanceof HTMLElement)) {
    return null;
  }
  const field =
    target.getAttribute("name") ??
    target.getAttribute("aria-label") ??
    "field";
  return `${ownerPrefix}:${field}`;
};

const isInsideNextNumeric = (
  focused: HTMLElement,
  nextTarget: EventTarget | null,
): boolean => {
  if (!(nextTarget instanceof Element)) {
    return false;
  }
  const nextNumeric = nextTarget.closest<HTMLElement>(
    "[data-history-interaction='numeric']",
  );
  return Boolean(nextNumeric?.contains(focused));
};

export const ProjectEditBoundary = ({
  ownerPrefix,
  label,
  children,
}: ProjectEditBoundaryProps) => {
  const { beginTrackedEdit, commitTrackedEdit, cancelTrackedEdit } =
    useProject();
  const rootRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<EditSession | null>(null);
  const apiRef = useRef({
    beginTrackedEdit,
    commitTrackedEdit,
    cancelTrackedEdit,
    label,
    ownerPrefix,
  });
  apiRef.current = {
    beginTrackedEdit,
    commitTrackedEdit,
    cancelTrackedEdit,
    label,
    ownerPrefix,
  };

  /**
   * Before switching owners on pointer/mouse down, force the focused editable
   * (e.g. NumericInput draft) to commit inside the current session via blur.
   * Never blur the control that is about to receive the gesture.
   */
  const flushFocusedEditable = (nextTarget: EventTarget | null) => {
    const focused = document.activeElement;
    if (!(focused instanceof HTMLElement)) {
      return;
    }
    if (!isEditableHistoryTarget(focused)) {
      return;
    }
    const root = rootRef.current;
    if (!root?.contains(focused)) {
      return;
    }
    if (isInsideNextNumeric(focused, nextTarget)) {
      return;
    }
    if (nextTarget instanceof Node) {
      if (focused === nextTarget || focused.contains(nextTarget)) {
        return;
      }
    }

    focused.blur();
  };

  const beginOwner = (
    owner: string,
    source: EditSession["source"],
    nextTarget: EventTarget | null = null,
  ) => {
    const active = sessionRef.current;
    // Same gesture may synthesize pointer + mouse; keep one session.
    if (active?.owner === owner && active.source === source) {
      return;
    }
    if (active?.owner === owner) {
      return;
    }
    if (active) {
      // Flush draft/onChange into A, then settle A before beginning B.
      flushFocusedEditable(nextTarget);
      const remaining = sessionRef.current;
      if (remaining) {
        commitTrackedEdit(remaining.owner);
        sessionRef.current = null;
      }
    }
    if (beginTrackedEdit(owner, label)) {
      sessionRef.current = { owner, source };
    }
  };

  const commitSession = (source: EditSession["source"]) => {
    const active = sessionRef.current;
    if (!active || active.source !== source) {
      return;
    }
    commitTrackedEdit(active.owner);
    sessionRef.current = null;
  };

  const cancelSession = () => {
    const active = sessionRef.current;
    if (!active) {
      return;
    }
    cancelTrackedEdit(active.owner);
    sessionRef.current = null;
  };

  useEffect(() => {
    return () => {
      const active = sessionRef.current;
      if (!active) {
        return;
      }
      apiRef.current.cancelTrackedEdit(active.owner);
      sessionRef.current = null;
    };
  }, []);

  // Release outside the boundary must still settle pointer sessions.
  useEffect(() => {
    const settlePointerUp = () => {
      const active = sessionRef.current;
      if (!active || active.source !== "pointer") {
        return;
      }
      apiRef.current.commitTrackedEdit(active.owner);
      sessionRef.current = null;
    };

    const settlePointerCancel = () => {
      const active = sessionRef.current;
      if (!active || active.source !== "pointer") {
        return;
      }
      apiRef.current.cancelTrackedEdit(active.owner);
      sessionRef.current = null;
    };

    window.addEventListener("pointerup", settlePointerUp);
    window.addEventListener("mouseup", settlePointerUp);
    window.addEventListener("pointercancel", settlePointerCancel);
    return () => {
      window.removeEventListener("pointerup", settlePointerUp);
      window.removeEventListener("mouseup", settlePointerUp);
      window.removeEventListener("pointercancel", settlePointerCancel);
    };
  }, []);

  const handleFocusCapture = (event: FocusEvent<HTMLElement>) => {
    const owner = resolveFocusOwner(ownerPrefix, event.target);
    if (!owner) {
      return;
    }
    beginOwner(owner, "focus", event.target);
  };

  // Bubble: after the control's own blur/commit handlers.
  const handleBlur = (event: FocusEvent<HTMLElement>) => {
    if (!isEditableHistoryTarget(event.target)) {
      return;
    }
    commitSession("focus");
  };

  // After Enter commit while still focused, rearm before the next child onChange.
  const handleEditableRearmCapture = (
    event: FormEvent<HTMLElement> | ChangeEvent<HTMLElement>,
  ) => {
    if (sessionRef.current) {
      return;
    }
    if (!isEditableHistoryTarget(event.target)) {
      return;
    }
    const owner = resolveFocusOwner(ownerPrefix, event.target);
    if (!owner) {
      return;
    }
    beginOwner(owner, "focus", event.target);
  };

  // Bubble: after NumericInput / native handlers discard or submit.
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!sessionRef.current) {
      return;
    }
    if (event.key === "Escape") {
      cancelSession();
      return;
    }
    if (event.key === "Enter" && isEditableHistoryTarget(event.target)) {
      commitSession("focus");
    }
  };

  const handlePointerDownCapture = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) {
      return;
    }
    const owner = resolveNumericOwner(ownerPrefix, event.target);
    if (!owner) {
      return;
    }
    beginOwner(owner, "pointer", event.target);
  };

  const handleMouseDownCapture = (event: MouseEvent<HTMLElement>) => {
    if (event.button !== 0) {
      return;
    }
    const owner = resolveNumericOwner(ownerPrefix, event.target);
    if (!owner) {
      return;
    }
    beginOwner(owner, "pointer", event.target);
  };

  // Bubble: after NumericInput onCommit / step onChange. Window listeners
  // dedupe via sessionRef once this clears the active pointer session.
  const handlePointerUp = () => {
    commitSession("pointer");
  };

  const handleMouseUp = () => {
    commitSession("pointer");
  };

  const handlePointerCancel = () => {
    if (sessionRef.current?.source !== "pointer") {
      return;
    }
    cancelSession();
  };

  return (
    <div
      ref={rootRef}
      data-project-edit-boundary={ownerPrefix}
      onFocusCapture={handleFocusCapture}
      onBlur={handleBlur}
      onInputCapture={handleEditableRearmCapture}
      onChangeCapture={handleEditableRearmCapture}
      onKeyDown={handleKeyDown}
      onPointerDownCapture={handlePointerDownCapture}
      onMouseDownCapture={handleMouseDownCapture}
      onPointerUp={handlePointerUp}
      onMouseUp={handleMouseUp}
      onPointerCancel={handlePointerCancel}
    >
      {children}
    </div>
  );
};
