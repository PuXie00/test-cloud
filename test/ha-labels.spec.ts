import { describe, expect, it } from 'vitest'
import type { HaPeerView, HaState } from '../shared/ha/types'
import { describePeer, summarizeHa } from '../src/app/pages/console/components/hot-standby/hot-standby-labels'

const project = { id: 'p-1', name: '演出', formatVersion: 1 }

const peer = (patch: Partial<HaPeerView> = {}): HaPeerView => ({
  ip: '192.168.0.100',
  link: 'up',
  hostName: '控台-A',
  role: 'primary',
  project,
  versionMismatch: false,
  closedByPeer: false,
  ...patch,
})

const state = (patch: Partial<HaState> = {}): HaState => ({
  enabled: true,
  role: 'standby',
  hostName: '控台-B',
  localIp: '192.168.0.101',
  primaryIp: '192.168.0.100',
  localProject: project,
  peers: [peer()],
  deviceGate: null,
  error: null,
  ...patch,
})

describe('hot standby labels', () => {
  it('describes the peer row', () => {
    expect(describePeer(peer(), project)).toEqual({ text: '同一个工程「演出」', tone: 'ok' })
    expect(describePeer(peer({ link: 'connecting' }), project)).toEqual({ text: '连接中', tone: 'idle' })
    expect(describePeer(peer({ link: 'down' }), project)).toEqual({ text: '已断开', tone: 'warn' })
    expect(describePeer(peer({ closedByPeer: true, link: 'down' }), project).text).toBe('对方已关闭热备')
    expect(describePeer(peer({ versionMismatch: true }), project).text).toContain('版本不一致')
    expect(describePeer(peer({ project: null }), project).text).toBe('对方没有打开工程')
    expect(describePeer(peer({ project: { ...project, id: 'x', name: '彩排' } }), project).text).toBe(
      '对方打开的是「彩排」，不是同一个工程',
    )
    expect(describePeer(peer(), null).text).toBe('对方打开的是「演出」，本机没有打开工程')
  })

  it('summarizes for the top bar', () => {
    expect(summarizeHa(state({ enabled: false }))).toEqual({ label: '热备未开启', tone: 'idle' })
    expect(summarizeHa(state())).toEqual({ label: '备机 · 已同步', tone: 'ok' })
    expect(summarizeHa(state({ deviceGate: '还没和主机核对完成，只能停止、总停止' }))).toEqual({
      label: '备机 · 未同步',
      tone: 'warn',
    })
    expect(summarizeHa(state({ peers: [peer({ link: 'down' })] })).label).toBe('备机 · 与主机断开')
    expect(summarizeHa(state({ peers: [peer({ link: 'down', closedByPeer: true })] })).label).toBe(
      '备机 · 主机已关闭热备',
    )
    expect(summarizeHa(state({ role: 'primary', peers: [] }))).toEqual({ label: '主机 · 等待备机', tone: 'warn' })
    expect(summarizeHa(state({ role: 'primary', peers: [peer({ role: 'standby' })] }))).toEqual({
      label: '主机 · 1 台备机',
      tone: 'ok',
    })
  })
})
