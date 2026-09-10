import type { ProjectDocumentLike } from './types'

const PROJECT_SCHEMA_VERSION = '1.3.0-draft'

export const createEmptyDocument = (meta: {
  id: string
  name: string
  author: string
}): ProjectDocumentLike => {
  const now = new Date().toISOString()
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    meta: {
      id: meta.id,
      name: meta.name,
      createdAt: now,
      modifiedAt: now,
      author: meta.author,
      status: 'draft',
      wizard: {
        currentStep: 'objects',
        completedSteps: [],
        skippedSteps: [],
        simulationOnly: true,
        wizardCompleted: false,
      },
    },
    setup: { plcs: [], motors: [], controlledObjects: [], alignment: {} },
    motion: { positionCues: [], actionSequences: [], programs: [] },
    rules: { rules: [] },
    view: {
      target: [0, 0, 0],
      alpha: -Math.PI / 4,
      beta: Math.PI / 3,
      zoomRadius: 14,
      orthoHalfHeight: 7,
      preset: 'persp',
      focalLengthMm: 50,
      gridSize: 20,
    },
    snapshots: [],
  }
}

export const isProjectDocumentLike = (value: unknown): value is ProjectDocumentLike => {
  if (!value || typeof value !== 'object') return false
  const doc = value as Record<string, unknown>
  if (doc.schemaVersion !== PROJECT_SCHEMA_VERSION) return false
  if (!doc.meta || typeof doc.meta !== 'object') return false
  const meta = doc.meta as Record<string, unknown>
  if (typeof meta.id !== 'string' || typeof meta.name !== 'string') return false
  if (typeof meta.createdAt !== 'string' || typeof meta.modifiedAt !== 'string') return false
  if (typeof meta.author !== 'string') return false
  if (!doc.setup || typeof doc.setup !== 'object') return false
  if (!doc.motion || typeof doc.motion !== 'object') return false
  if (!doc.rules || typeof doc.rules !== 'object') return false
  if (!doc.view || typeof doc.view !== 'object') return false
  if (!Array.isArray(doc.snapshots)) return false
  return true
}
