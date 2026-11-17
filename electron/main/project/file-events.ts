/** 工程目录里的文件变了（导入、删除模型，保存写了封面）：主备热备据此把文件发给另一台 */
export type ProjectFileEvent =
  | { kind: 'model-import'; projectName: string; fileName: string }
  | { kind: 'model-delete'; projectName: string; fileName: string }
  | { kind: 'saved'; projectName: string; coverWritten: boolean }

const listeners = new Set<(event: ProjectFileEvent) => void>()

export const onProjectFileEvent = (listener: (event: ProjectFileEvent) => void): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const emitProjectFileEvent = (event: ProjectFileEvent): void => {
  for (const listener of listeners) {
    try {
      listener(event)
    } catch (err) {
      console.error('[project] file event listener failed', err)
    }
  }
}
