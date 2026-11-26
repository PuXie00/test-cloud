import { describe, expect, it } from 'vitest'
import {
  applySyncChange,
  canonicalJson,
  changeTouchesSetup,
  describeSyncKey,
  diffSyncItems,
  extractSyncItems,
  filterSyncChange,
  isEmptySyncChange,
  replaceSyncScope,
  syncDigestSource,
} from '../shared/ha/sync-items'
import { DEFAULT_HA_SYNC_SCOPE } from '../shared/ha/types'

const doc = () => ({
  schemaVersion: '1',
  meta: { id: 'p-1', name: '演出', author: '张三', status: 'active', wizard: { currentStep: 'review' }, createdAt: 'a', modifiedAt: 'b' },
  setup: {
    plcs: [{ id: 1, ip: '192.168.1.10' }],
    motors: [{ id: 61, plcId: 1 }, { id: 62, plcId: 1 }],
    controlledObjects: [{ id: 6, name: '吊杆' }, { id: 7, name: '升降台' }],
    alignment: { '6': { status: 'aligned' } },
    scene: { groups: [] },
    manualJog: { v1: { velocity: 100, accelDecelTime: 1 } },
  },
  motion: {
    actionSequences: [{ id: 12, name: '开场' }, { id: 13, name: '谢幕' }],
    programs: [{ id: 'p', chapters: [] }],
  },
  rules: { rules: [{ id: 'r1', name: '限位', enabled: true }] },
  view: { camera: 1 },
  snapshots: [],
})

describe('sync items', () => {
  it('splits a document into items', () => {
    const items = extractSyncItems(doc(), DEFAULT_HA_SYNC_SCOPE)
    expect([...items.keys()]).toEqual([
      'setup:plc:1',
      'setup:motor:61',
      'setup:motor:62',
      'setup:object:6',
      'setup:object:7',
      'setup:scene',
      'setup:manualJog',
      'motion:sequence:12',
      'motion:sequence:13',
      'motion:programs',
      'rules:rule:r1',
      'meta',
    ])
    expect(items.get('setup:object:6')).toEqual({ object: { id: 6, name: '吊杆' }, alignment: { status: 'aligned' } })
    expect(items.get('setup:object:7')).toEqual({ object: { id: 7, name: '升降台' }, alignment: null })
    expect(items.get('meta')).toEqual({ author: '张三', status: 'active', wizard: { currentStep: 'review' } })
  })

  it('leaves out parts that are not in scope (setup always syncs)', () => {
    const items = extractSyncItems(doc(), { motion: false, rules: false, meta: false, models: true })
    expect([...items.keys()].every((key) => key.startsWith('setup:'))).toBe(true)
  })

  it('finds what changed, including deletes, and ignores unchanged items', () => {
    const before = doc()
    const after = {
      ...before,
      setup: {
        ...before.setup,
        motors: [before.setup.motors[0]],
        controlledObjects: [{ id: 6, name: '吊杆 A' }, before.setup.controlledObjects[1]],
      },
    }
    const change = diffSyncItems(
      extractSyncItems(before, DEFAULT_HA_SYNC_SCOPE),
      extractSyncItems(after, DEFAULT_HA_SYNC_SCOPE),
    )
    expect(change.del).toEqual(['setup:motor:62'])
    expect(Object.keys(change.put)).toEqual(['setup:object:6'])
    expect(changeTouchesSetup(change)).toBe(true)
    expect(isEmptySyncChange(diffSyncItems(extractSyncItems(before, DEFAULT_HA_SYNC_SCOPE), extractSyncItems(doc(), DEFAULT_HA_SYNC_SCOPE)))).toBe(true)
  })

  it('syncs an object color / model tint change as that object item', () => {
    const before = doc()
    const after = doc()
    after.setup.controlledObjects[1] = { ...after.setup.controlledObjects[1]!, color: '#123abc', tintModel: true } as never
    const change = diffSyncItems(
      extractSyncItems(before, DEFAULT_HA_SYNC_SCOPE),
      extractSyncItems(after, DEFAULT_HA_SYNC_SCOPE),
    )
    expect(Object.keys(change.put)).toEqual(['setup:object:7'])
    const applied = applySyncChange(before, change)
    expect(applied.setup.controlledObjects[1]).toMatchObject({ color: '#123abc', tintModel: true })
  })

  it('applies a change on another copy and ends with the same items', () => {
    const source = doc()
    const edited = {
      ...source,
      meta: { ...source.meta, note: '加了备注' },
      setup: {
        ...source.setup,
        motors: [...source.setup.motors, { id: 63, plcId: 1 }],
        controlledObjects: [source.setup.controlledObjects[1]],
        alignment: {},
      },
      motion: { ...source.motion, actionSequences: [{ id: 12, name: '开场（新）' }, source.motion.actionSequences[1]] },
    }
    const change = diffSyncItems(
      extractSyncItems(source, DEFAULT_HA_SYNC_SCOPE),
      extractSyncItems(edited, DEFAULT_HA_SYNC_SCOPE),
    )
    const replica = applySyncChange(doc(), change)
    expect(syncDigestSource(extractSyncItems(replica, DEFAULT_HA_SYNC_SCOPE))).toBe(
      syncDigestSource(extractSyncItems(edited, DEFAULT_HA_SYNC_SCOPE)),
    )
    expect(replica.setup.alignment).toEqual({})
    expect(replica.setup.motors.map((motor) => motor.id)).toEqual([61, 62, 63])
    expect(replica.meta).toMatchObject({ id: 'p-1', name: '演出', note: '加了备注', createdAt: 'a' })
    expect(replica.view).toEqual({ camera: 1 })
  })

  it('keeps untouched parts as the same objects', () => {
    const source = doc()
    const next = applySyncChange(source, { put: { 'motion:sequence:12': { id: 12, name: 'x' } }, del: [] })
    expect(next.setup).toBe(source.setup)
    expect(next.rules).toBe(source.rules)
    expect(next.motion).not.toBe(source.motion)
    expect(applySyncChange(source, { put: {}, del: [] })).toBe(source)
  })

  it('replaces the whole scope with the other side, in its order', () => {
    const theirs = doc()
    theirs.setup.controlledObjects = [{ id: 7, name: '升降台' }, { id: 9, name: '新' }]
    theirs.motion.actionSequences = [{ id: 13, name: '谢幕' }]
    const items = extractSyncItems(theirs, DEFAULT_HA_SYNC_SCOPE)
    const mine = replaceSyncScope(doc(), items, DEFAULT_HA_SYNC_SCOPE)
    expect(mine.setup.controlledObjects).toEqual([{ id: 7, name: '升降台' }, { id: 9, name: '新' }])
    expect(mine.motion.actionSequences).toEqual([{ id: 13, name: '谢幕' }])
    expect(syncDigestSource(extractSyncItems(mine, DEFAULT_HA_SYNC_SCOPE))).toBe(syncDigestSource(items))
  })

  it('drops out-of-scope items from a change', () => {
    const change = filterSyncChange(
      { put: { 'setup:plc:1': {}, 'motion:sequence:1': {}, meta: {} }, del: ['rules:rule:r1', 'setup:motor:2'] },
      { motion: false, rules: false, meta: true, models: true },
    )
    expect(change).toEqual({ put: { 'setup:plc:1': {}, meta: {} }, del: ['setup:motor:2'] })
  })

  it('serializes with sorted keys and names items for people', () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: undefined }] })).toBe('{"a":[{"d":2}],"b":1}')
    expect(describeSyncKey('motion:sequence:12', { name: '开场' })).toBe('「开场」')
    expect(describeSyncKey('setup:object:6', { object: { name: '吊杆' } })).toBe('「吊杆」')
    expect(describeSyncKey('setup:motor:61')).toBe('电机 61')
    expect(describeSyncKey('motion:programs')).toBe('节目单')
  })
})
