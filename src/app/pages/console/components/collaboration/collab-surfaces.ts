/** Tonal layering for collaboration dialog — darkest → lightest */
export const COLLAB_SURFACES = {
  /** Dialog shell */
  shell: "bg-card",
  /** Header, footer chrome */
  chrome: "bg-muted",
  /** Tab strip — between chrome and content */
  tabBar: "bg-card border-b border-border",
  /** Main scroll canvas */
  content: "bg-background",
  /** Section panels (topology, host list, settings) */
  section: "bg-muted",
  /** Recessed rows, primary node, inline forms */
  recessed: "bg-input-background border border-border/60",
  /** Elevated chips, standby node, manual-control panel */
  elevated: "bg-accent border border-border/70",
} as const;
