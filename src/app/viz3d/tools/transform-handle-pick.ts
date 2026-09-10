export const shouldYieldPointerToTransformHandle = (input: {
  dragging: boolean;
  enabled: boolean;
  helperVisible: boolean;
  attached: boolean;
  hovered: boolean;
}): boolean => {
  if (input.dragging) return true;
  if (!input.enabled || !input.helperVisible || !input.attached) return false;
  return input.hovered;
};
