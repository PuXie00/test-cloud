import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/opt/yzapp/yzapp' } }))

import { cppRuntimeExeName } from '../electron/main/cSocket/process'
import { toCppRelativeProjectPath } from '../electron/main/cSocket/project-path'

describe('发给 C++ 的工程路径', () => {
  it('Windows 照旧：.\\Project\\<工程名>', () => {
    expect(toCppRelativeProjectPath('C:\\Program Files\\yzapp\\Project\\演出A\\', 'win32')).toBe('.\\Project\\演出A')
    expect(toCppRelativeProjectPath('D:/yzapp/Project/演出A', 'win32')).toBe('.\\Project\\演出A')
    expect(toCppRelativeProjectPath('演出A', 'win32')).toBe('.\\Project\\演出A')
  })

  it('Linux 用 ./Project/<工程名>', () => {
    expect(toCppRelativeProjectPath('/opt/yzapp/Project/演出A/', 'linux')).toBe('./Project/演出A')
    expect(toCppRelativeProjectPath('演出A', 'linux')).toBe('./Project/演出A')
  })
})

describe('C++ 运行时程序名', () => {
  it('Windows 带 .exe，Linux 版没有扩展名', () => {
    expect(cppRuntimeExeName('win32')).toBe('YzRuntime.exe')
    expect(cppRuntimeExeName('linux')).toBe('YzRuntime')
  })
})
