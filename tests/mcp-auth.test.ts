import { afterEach, describe, expect, it } from 'vitest'

// lib/mcp/auth.ts: the per-person bearer tokens for /api/mcp. Pins the
// MCP_KEYS format (label:token, comma separated), what gets dropped (blank
// entries, bad labels, short tokens, duplicate labels), that an unset env
// means nobody gets in, and that a presented token resolves to exactly its
// label.

import { getMcpKeys, parseMcpKeys, resolveMcpToken } from '@/lib/mcp/auth'

const MITCH = 'mitch-token-0123456789abcdef'
const MOM = 'mom-token-0123456789abcdefgh'

afterEach(() => {
  delete process.env.MCP_KEYS
})

describe('parseMcpKeys', () => {
  it('parses label:token pairs and normalises the label', () => {
    expect(parseMcpKeys(` Mitch:${MITCH} , mom:${MOM} `)).toEqual([
      { label: 'mitch', token: MITCH },
      { label: 'mom', token: MOM },
    ])
  })

  it('drops blanks, entries without a colon, bad labels, short tokens and duplicate labels', () => {
    expect(
      parseMcpKeys(`,,nocolon,bad label:${MITCH},mitch:short,mitch:${MITCH},mitch:${MOM}`),
    ).toEqual([{ label: 'mitch', token: MITCH }])
  })

  it('keeps colons inside the token', () => {
    expect(parseMcpKeys('mitch:abc:def:0123456789abcdef')).toEqual([{ label: 'mitch', token: 'abc:def:0123456789abcdef' }])
  })

  it('is empty when unset', () => {
    expect(parseMcpKeys(undefined)).toEqual([])
    expect(getMcpKeys()).toEqual([])
  })
})

describe('resolveMcpToken', () => {
  const keys = parseMcpKeys(`mitch:${MITCH},mom:${MOM}`)

  it('returns the label for a known token', () => {
    expect(resolveMcpToken(MITCH, keys)).toBe('mitch')
    expect(resolveMcpToken(` ${MOM} `, keys)).toBe('mom')
  })

  it('rejects unknown, blank and near-miss tokens', () => {
    expect(resolveMcpToken('nope', keys)).toBeNull()
    expect(resolveMcpToken('', keys)).toBeNull()
    expect(resolveMcpToken(undefined, keys)).toBeNull()
    expect(resolveMcpToken(MITCH.slice(0, -1), keys)).toBeNull()
    expect(resolveMcpToken(MITCH + 'x', keys)).toBeNull()
  })

  it('rejects everything when no keys are configured', () => {
    expect(resolveMcpToken(MITCH, [])).toBeNull()
    expect(resolveMcpToken(MITCH)).toBeNull()
  })

  it('reads MCP_KEYS from the environment by default', () => {
    process.env.MCP_KEYS = `mom:${MOM}`
    expect(resolveMcpToken(MOM)).toBe('mom')
    expect(resolveMcpToken(MITCH)).toBeNull()
  })
})
