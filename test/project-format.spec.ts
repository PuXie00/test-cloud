import { loadEnv } from 'vite'
import { describe, expect, it } from 'vitest'
import {
  migrateProjectDocument,
  parseProjectSchemaVersionSetting,
  PROJECT_FORMAT_VERSION,
  PROJECT_MIGRATIONS,
  readFormatVersion,
  toStoredSchemaVersion,
  type ProjectMigrationStep,
} from '../shared/project/project-format'
import { PROJECT_SCHEMA_VERSION } from '../src/app/project/project-document-types'

describe('project format version', () => {
  it('reads version numbers', () => {
    expect(readFormatVersion('2')).toBe(2)
    expect(readFormatVersion(3)).toBe(3)
    expect(readFormatVersion('1')).toBe(1)
  })

  it('rejects anything else', () => {
    for (const value of [undefined, null, '', '0', '01', '2.0', '1.4.0', '1.3.0-draft', 'v2', 0, -1, 1.5, {}]) {
      expect(readFormatVersion(value)).toBeNull()
    }
  })

  it('writes the plain version number', () => {
    expect(toStoredSchemaVersion(1)).toBe('1')
    expect(toStoredSchemaVersion(2)).toBe('2')
    for (const version of [1, 2, 7]) {
      expect(readFormatVersion(toStoredSchemaVersion(version))).toBe(version)
    }
  })

  it('takes the current version from .env and has an upgrade step for every older version', () => {
    expect(PROJECT_FORMAT_VERSION).toBe(Number(loadEnv('test', process.cwd(), 'YZ_').YZ_PROJECT_SCHEMA_VERSION ?? '1'))
    expect(PROJECT_SCHEMA_VERSION).toBe(toStoredSchemaVersion(PROJECT_FORMAT_VERSION))
    expect(PROJECT_MIGRATIONS).toHaveLength(PROJECT_FORMAT_VERSION - 1)
  })

  it('accepts only a positive integer in YZ_PROJECT_SCHEMA_VERSION', () => {
    expect(parseProjectSchemaVersionSetting(undefined)).toBe(1)
    expect(parseProjectSchemaVersionSetting(' 3 ')).toBe(3)
    for (const bad of ['0', '1.0', 'v2', 'abc']) {
      expect(() => parseProjectSchemaVersionSetting(bad)).toThrow('YZ_PROJECT_SCHEMA_VERSION')
    }
  })
})

describe('migrateProjectDocument', () => {
  const v1 = () => ({ schemaVersion: '1', meta: { name: 'a' }, setup: { objects: [1] } })
  // v1 → v2 renames setup.objects to setup.controlledObjects; v2 → v3 adds rules
  const chain: ProjectMigrationStep[] = [
    (doc) => {
      const setup = doc.setup as { objects: unknown[] }
      return { ...doc, setup: { controlledObjects: setup.objects } }
    },
    (doc) => ({ ...doc, rules: { rules: [] } }),
  ]

  it('returns the current version unchanged', () => {
    const result = migrateProjectDocument(v1())
    expect(result).toEqual({ ok: true, document: v1(), fromVersion: 1, migrated: false })
  })

  it('normalises a hand-written number to "1"', () => {
    const result = migrateProjectDocument({ ...v1(), schemaVersion: 1 })
    expect(result).toEqual({ ok: true, document: v1(), fromVersion: 1, migrated: false })
  })

  it('runs every step in order up to the current version', () => {
    const raw = v1()
    const result = migrateProjectDocument(raw, { current: 3, migrations: chain })
    expect(result).toEqual({
      ok: true,
      fromVersion: 1,
      migrated: true,
      document: {
        schemaVersion: '3',
        meta: { name: 'a' },
        setup: { controlledObjects: [1] },
        rules: { rules: [] },
      },
    })
    expect(raw).toEqual(v1())
  })

  it('starts from the file version', () => {
    const result = migrateProjectDocument(
      { schemaVersion: '2', setup: { controlledObjects: [] } },
      { current: 3, migrations: chain },
    )
    expect(result.ok && result.document).toEqual({
      schemaVersion: '3',
      setup: { controlledObjects: [] },
      rules: { rules: [] },
    })
  })

  it('refuses files from a newer version', () => {
    const result = migrateProjectDocument({ schemaVersion: '4' }, { current: 3, migrations: chain })
    expect(result).toMatchObject({ ok: false, code: 'TOO_NEW', version: 4 })
    expect(!result.ok && result.message).toContain('v4')
  })

  it('reports unknown versions and non-objects', () => {
    expect(migrateProjectDocument({ schemaVersion: '1.4.0' })).toMatchObject({
      ok: false,
      code: 'UNKNOWN_VERSION',
      version: null,
    })
    expect(migrateProjectDocument({})).toMatchObject({ ok: false, code: 'UNKNOWN_VERSION' })
    expect(migrateProjectDocument([])).toMatchObject({ ok: false, code: 'NOT_AN_OBJECT' })
    expect(migrateProjectDocument(null)).toMatchObject({ ok: false, code: 'NOT_AN_OBJECT' })
  })

  it('fails cleanly when a step is missing, throws or returns garbage', () => {
    expect(migrateProjectDocument(v1(), { current: 3, migrations: [chain[0]] })).toMatchObject({
      ok: false,
      code: 'MIGRATION_FAILED',
      version: 1,
    })
    const throwing: ProjectMigrationStep = () => {
      throw new Error('boom')
    }
    const failed = migrateProjectDocument(v1(), { current: 2, migrations: [throwing] })
    expect(failed).toMatchObject({ ok: false, code: 'MIGRATION_FAILED' })
    expect(!failed.ok && failed.message).toContain('boom')
    const garbage = (() => null) as unknown as ProjectMigrationStep
    expect(migrateProjectDocument(v1(), { current: 2, migrations: [garbage] })).toMatchObject({
      ok: false,
      code: 'MIGRATION_FAILED',
    })
  })
})
