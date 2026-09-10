export type KinematicsErrorCode =
  | 'EXE_NOT_FOUND'
  | 'SPAWN_FAILED'
  | 'START_TIMEOUT'
  | 'SOLVE_TIMEOUT'
  | 'PROTOCOL_ERROR'
  | 'SOLVE_ERROR'
  | 'INVALID_RESULT'

export type KinematicsSolveRequest = {
  items: unknown[]
}

export type KinematicsSolveOk = {
  ok: true
  data: unknown[]
}

export type KinematicsSolveErr = {
  ok: false
  code: KinematicsErrorCode
  message: string
}

export type KinematicsSolveResult = KinematicsSolveOk | KinematicsSolveErr
