import { describe, expect, it } from 'vitest'
import { commandActionIds, commandDeviceIds } from '../shared/ha/device-ids'

describe('command device and action ids', () => {
  it('finds ids at any depth, as numbers or lists', () => {
    expect(commandDeviceIds([{ deviceId: 6, direction: 1 }, { deviceId: 7 }])).toEqual([6, 7])
    expect(commandDeviceIds([{ actionId: 1, deviceId: [9, 8] }])).toEqual([8, 9])
    expect(commandDeviceIds([{ actionId: 1, modelList: [{ deviceId: 5, frames: [{ t: 0 }] }] }])).toEqual([5])
    expect(commandActionIds([{ deviceId: 5 }], [{ actionId: 12, deviceCount: 2 }])).toEqual([12])
    expect(commandDeviceIds([])).toEqual([])
  })
})
