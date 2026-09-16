#!/usr/bin/env -S npx tsx
/**
 * One-time backfill of existing customers and jobs into the Twenty handyman
 * workspace (forge-platform businesses/forge-handyman/SYNC.md, "Backfill").
 *
 * Walks customers (people first, so a customer with no job still lands), then
 * jobs in submitted_at order, through the SAME upsert code the live hook uses
 * (lib/twenty/sync.ts). Idempotent by the same keys (email, websiteJobId), so
 * it can be re-run; anonymized rows sync as unlinked jobs and never as people.
 *
 * Modes:
 *   (default)   dry-run: reads Supabase and asks Twenty what already exists,
 *               prints create/update per record, writes nothing.
 *   --execute   do it.
 *   --limit N   stop after N jobs (smoke test on a handful first).
 *
 * Run with: npx tsx scripts/backfill-twenty.ts [--execute] [--limit N]
 *
 * Required env (from .env.local or the shell): DATA_BACKEND=postgres,
 * SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TWENTY_API_URL, TWENTY_API_KEY.
 * TWENTY_SYNC_DISABLED must not be true.
 *
 * This is a CLI: console output IS the report (the one sanctioned exception
 * to the shared pino logger rule).
 */

import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import { getBackend } from '@/lib/data/backend'
import { getAppointmentByJobId, listCustomers, listJobs, type ContactRow } from '@/lib/data'
import {
  buildPersonFields,
  findTwentyJobId,
  findTwentyPersonId,
  getTwentyConfig,
  isSentinelEmail,
  syncJobToTwenty,
  type TwentyConfig,
} from '@/lib/twenty/sync'

interface Args {
  execute: boolean
  limit: number
}

function parseArgs(argv: string[]): Args {
  const args: Args = { execute: false, limit: Number.POSITIVE_INFINITY }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--execute') args.execute = true
    else if (a === '--limit') {
      const n = Number(argv[++i])
      if (!Number.isFinite(n) || n <= 0) throw new Error('--limit needs a positive number')
      args.limit = n
    } else throw new Error(`Unknown argument: ${a}`)
  }
  return args
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (getBackend() !== 'postgres') {
    throw new Error('DATA_BACKEND must be postgres; the backfill reads Supabase directly')
  }
  const cfg = getTwentyConfig()
  if (!cfg) {
    throw new Error('TWENTY_API_URL and TWENTY_API_KEY must be set, and TWENTY_SYNC_DISABLED must not be true')
  }
  console.log(`Backfill to ${cfg.restUrl} (${args.execute ? 'EXECUTE' : 'dry run'})`)

  // People first. The live hook creates a person as a side effect of a job;
  // the backfill also covers customers who have no job row (rare, manual adds).
  const customers = await listCustomers()
  let peopleExisting = 0
  let peopleToCreate = 0
  let peopleSkipped = 0
  for (const c of customers) {
    if (c.anonymized || !c.email || isSentinelEmail(c.email)) {
      peopleSkipped += 1
      continue
    }
    const existing = await findTwentyPersonId(cfg, c.email)
    if (existing) peopleExisting += 1
    else peopleToCreate += 1
    // Creation itself happens through the job upsert below (same code path as
    // the hook). A customer with no jobs is created here explicitly.
  }
  console.log(`customers: ${customers.length} (exist in Twenty: ${peopleExisting}, to create: ${peopleToCreate}, skipped anonymized/no email: ${peopleSkipped})`)

  const jobs = await listJobs()
  const jobsWithEmail = new Set(jobs.map((j) => (j.email || '').trim().toLowerCase()))
  const orphanCustomers = customers.filter(
    (c) => !c.anonymized && c.email && !isSentinelEmail(c.email) && !jobsWithEmail.has(c.email.trim().toLowerCase()),
  )
  for (const c of orphanCustomers) {
    console.log(`person (no jobs): ${c.email} ${args.execute ? '-> sync' : '(would create)'}`)
    if (args.execute) {
      // syncJobToTwenty needs a job; a customer without one is created directly.
      const res = await syncPersonOnly(cfg, c)
      console.log(`  ${res}`)
    }
  }

  let created = 0
  let updated = 0
  let failed = 0
  let seen = 0
  for (const job of jobs) {
    if (seen >= args.limit) break
    seen += 1
    const jobId = (job.job_id || '').trim()
    if (!jobId) {
      console.log(`skip: row ${job.rowNumber} has no job_id`)
      continue
    }
    const exists = await findTwentyJobId(cfg, jobId)
    const label = `${jobId} ${job.status.padEnd(18)} ${job.submitted_at.slice(0, 10)}`
    if (!args.execute) {
      console.log(`${exists ? 'update' : 'create'}: ${label}`)
      if (exists) updated += 1
      else created += 1
      continue
    }
    const appt = await getAppointmentByJobId(jobId).catch(() => null)
    const res = await syncJobToTwenty(job as ContactRow, {
      appointment: appt && appt.status !== 'cancelled' ? { startsAt: appt.startsAt, endsAt: appt.endsAt } : null,
    })
    if (res.ok) {
      if (res.created) created += 1
      else updated += 1
      console.log(`${res.created ? 'created' : 'updated'}: ${label} -> ${res.twentyJobId}`)
    } else {
      failed += 1
      console.log(`FAILED: ${label} -> ${'error' in res ? res.error : res.skipped}`)
    }
  }
  console.log(
    `jobs: ${seen} processed, ${created} ${args.execute ? 'created' : 'to create'}, ${updated} ${args.execute ? 'updated' : 'to update'}, ${failed} failed`,
  )
  if (!args.execute) console.log('Dry run only, nothing written. Re-run with --execute.')
}

// Direct person create for a customer with no job row. Mirrors upsertPerson in
// lib/twenty/sync.ts (match by email, create when absent) without needing a
// job. Kept here because it is a backfill-only case.
async function syncPersonOnly(
  cfg: TwentyConfig,
  c: { name: string; email: string; phone: string },
): Promise<string> {
  const existing = await findTwentyPersonId(cfg, c.email)
  if (existing) return `exists ${existing}`
  const res = await fetch(`${cfg.restUrl}/people`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildPersonFields({ name: c.name, email: c.email, phone: c.phone })),
  })
  if (!res.ok) return `FAILED HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`
  return 'created'
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
