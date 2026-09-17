import { constantTimeEqual } from '@/lib/webhooks/verify'

// Bearer tokens for /api/mcp, one per person so every action Claude takes is
// attributed (the actor on the activity timeline is `claude:<label>`).
//
// MCP_KEYS is a comma-separated list of label:token pairs, e.g.
//   MCP_KEYS=mitch:xxxxxxxx,mom:yyyyyyyy
// Labels are lowercase letters, digits and dashes. Tokens are whatever
// `openssl rand -base64 32` produced. Rotate one person by replacing their
// token; remove a person by deleting their entry. Unset means the MCP is off
// (every request gets 401), which is the safe default.

export interface McpKey {
  label: string
  token: string
}

const LABEL_RE = /^[a-z0-9][a-z0-9-]{0,31}$/

export function parseMcpKeys(raw: string | undefined): McpKey[] {
  const out: McpKey[] = []
  const seen = new Set<string>()
  for (const entry of (raw || '').split(',')) {
    const trimmed = entry.trim()
    if (!trimmed) continue
    const idx = trimmed.indexOf(':')
    if (idx <= 0) continue
    const label = trimmed.slice(0, idx).trim().toLowerCase()
    const token = trimmed.slice(idx + 1).trim()
    if (!LABEL_RE.test(label) || token.length < 16 || seen.has(label)) continue
    seen.add(label)
    out.push({ label, token })
  }
  return out
}

export function getMcpKeys(): McpKey[] {
  return parseMcpKeys(process.env.MCP_KEYS)
}

// Returns the label for a presented bearer token, or null. Every configured
// token is compared in constant time, and the loop does not stop at the first
// match, so timing does not reveal which entry matched.
export function resolveMcpToken(bearer: string | null | undefined, keys: McpKey[] = getMcpKeys()): string | null {
  const presented = (bearer || '').trim()
  if (!presented) return null
  let matched: string | null = null
  for (const key of keys) {
    if (constantTimeEqual(presented, key.token)) matched = key.label
  }
  return matched
}
