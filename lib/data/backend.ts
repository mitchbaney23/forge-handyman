export type DataBackend = 'sheet' | 'postgres'

// Resolve the active data backend from DATA_BACKEND, read PER CALL (no
// module-level caching) so the cutover flip takes effect without a process
// restart and tests can toggle it freely.
//
//   unset / '' / 'sheet' -> 'sheet'   (default)
//   'postgres'           -> 'postgres'
//   anything else        -> throws (fail-loud tier: a typo here must never
//                           silently fall back to the wrong datastore)
//
// Matching is exact on purpose — no trim, no case-folding — so a malformed
// value is surfaced at the first data access instead of being guessed at.
export function getBackend(): DataBackend {
  const raw = process.env.DATA_BACKEND
  if (raw === undefined || raw === '' || raw === 'sheet') return 'sheet'
  if (raw === 'postgres') return 'postgres'
  throw new Error(
    `DATA_BACKEND is set to ${JSON.stringify(raw)} — expected unset, 'sheet', or 'postgres' (exact, lowercase). ` +
      'Fix the env var (Vercel project settings or .env.local) and redeploy. See docs/stage-13-postgres-design.md.',
  )
}
