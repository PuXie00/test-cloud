/** Pure abort predicates used by Viz3DEngine transform commit paths. */

export const shouldAbortFailedTransformCommit = (input: {
  mode: "single" | "multi";
  targetId: string | null;
  canEdit: boolean;
  hasHandle: boolean;
  payloadCount: number;
}): boolean => {
  if (input.mode === "multi") {
    return input.payloadCount === 0;
  }
  return !input.targetId || !input.canEdit || !input.hasHandle;
};
