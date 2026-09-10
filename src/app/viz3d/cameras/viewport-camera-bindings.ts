export type ViewportCameraMapEntry = {
  source?: string;
  button?: number;
  modifiers?: { ctrl?: boolean; shift?: boolean; alt?: boolean };
  interaction?: string;
};

const isPointer = (entry: ViewportCameraMapEntry): boolean => entry.source === "pointer";

const shouldDropPointerEntry = (entry: ViewportCameraMapEntry): boolean => {
  if (!isPointer(entry)) return false;
  const shift = Boolean(entry.modifiers?.shift);
  const ctrl = Boolean(entry.modifiers?.ctrl);
  if (entry.interaction === "rotate" && entry.button === 0 && !shift && !ctrl) return true;
  if (entry.interaction === "pan" && entry.button === 0 && ctrl) return true;
  if (entry.interaction === "pan" && entry.button === 2) return true;
  if (entry.button === 1 && (entry.interaction === "pan" || entry.interaction === "rotate")) {
    return true;
  }
  return false;
};

export const applyViewportCameraBindings = (inputMap: ViewportCameraMapEntry[]): void => {
  for (let index = inputMap.length - 1; index >= 0; index -= 1) {
    const entry = inputMap[index];
    if (entry && shouldDropPointerEntry(entry)) {
      inputMap.splice(index, 1);
    }
  }
  inputMap.unshift(
    { source: "pointer", button: 1, modifiers: { alt: true }, interaction: "rotate" },
    { source: "pointer", button: 1, interaction: "pan" },
  );
};
