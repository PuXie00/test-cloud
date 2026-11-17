import { describe, expect, it } from 'vitest'
import { buildBusyEntries, peerRunningSequenceIds, sequenceObjectIds } from '../src/app/hot-standby/ha-busy'

const setup = {
  motors: [
    { id: 61, controlledObjectId: 6 },
    { id: 62, controlledObjectId: 6 },
    { id: 90, controlledObjectId: null },
  ],
  controlledObjects: [{ id: 6, name: '吊杆' }, { id: 7, name: '' }],
} as never

describe('hot standby busy devices', () => {
  it('counts an object together with its motors, and loose motors on their own', () => {
    expect(buildBusyEntries([{ name: '控台-A', deviceIds: [61], sequenceIds: [] }], setup)).toEqual([
      { id: 6, label: '物体「吊杆」', by: '控台-A' },
      { id: 61, label: '物体「吊杆」', by: '控台-A' },
      { id: 62, label: '物体「吊杆」', by: '控台-A' },
    ])
    expect(buildBusyEntries([{ name: 'B', deviceIds: [7, 90], sequenceIds: [] }], setup)).toEqual([
      { id: 7, label: '物体 7', by: 'B' },
      { id: 90, label: '电机 90', by: 'B' },
    ])
  })

  it('lists sequence objects and the other side running sequences', () => {
    expect(
      sequenceObjectIds({
        id: 1,
        name: 's',
        trajectoryMode: 'forced',
        blocks: [
          { kind: 'pose', objectId: 6 },
          { kind: 'static-preset', orderedObjectIds: [7, 8] },
        ],
        segments: [],
      } as never),
    ).toEqual([6, 7, 8])
    expect(peerRunningSequenceIds([{ name: 'a', deviceIds: [], sequenceIds: [3, 1] }, { name: 'b', deviceIds: [], sequenceIds: [3] }])).toEqual([1, 3])
  })
})
