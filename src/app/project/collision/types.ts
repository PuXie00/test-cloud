import type { ActionSequenceConfig, ModelPose } from "../action-sequence/types";
import type { VirtualAxisId } from "../project-document-types";
import type { SceneObjectConfig } from "@/app/viz3d/types";

export type CollisionObject = {
  id: number;
  name: string;
  config: SceneObjectConfig;
  enabledAxes?: VirtualAxisId[];
  basePose: Partial<ModelPose>;
  modelKey?: string;
};

export type CollisionInput = { sequence: ActionSequenceConfig; objects: CollisionObject[] };
export type CollisionAsset = { format: "glb" | "obj"; bytes: Uint8Array };

export type CollisionEvent = {
  objectIds: [number, number];
  startMs: number;
  endMs: number;
  kind: "collision" | "review";
};

export type CollisionReport = { events: CollisionEvent[]; incomplete: string[] };

export type CollisionSaveBatch = { projectKey: string; sequences: ActionSequenceConfig[] };

export type ScanControl = { type: "pause" | "resume" | "cancel"; jobId: number };

export type ScanRequest = {
  jobId: number;
  input: CollisionInput;
  assets: Map<string, CollisionAsset>;
  full: boolean;
};

export type ScanReply =
  | { jobId: number; ok: true; report: CollisionReport; cachedAssets: string[] }
  | { jobId: number; ok: false; error: string };
