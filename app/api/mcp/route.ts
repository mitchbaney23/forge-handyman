import { createMcpHandler, withMcpAuth } from 'mcp-handler'
import * as Sentry from '@sentry/nextjs'
import { logger } from '@/lib/security/logger'
import { checkLimit } from '@/lib/security/rate-limit'
import { resolveMcpToken } from '@/lib/mcp/auth'
import { TOOLS, actorFor } from '@/lib/mcp/tools'

// Claude's door into the handyman business (the website is the system of
// record; see forge-platform docs/decisions/2026-09-17-claude-as-entry-point.md).
// Streamable HTTP MCP, bearer token per person from MCP_KEYS, every call rate
// limited per person and attributed on the activity timeline as
// `claude:<label>`. Tools live in lib/mcp/tools.ts; this file only wires them.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const INSTRUCTIONS = [
  'Forge Handyman: customers, jobs, appointments, notes, quotes and a business snapshot.',
  'Jobs move New, Quoted, Pending Follow-Up, Booked, In Progress, Complete; Cancelled; and payment states Stripe owns.',
  'Quotes: price_menu for the flat-rate prices, preview_quote to build one and see who gets it, send_quote to email it. send_quote is the only thing here that reaches a customer (a Stripe payment link by email), so read the amounts and the recipient back and get a clear yes first.',
  'Complete, charges and refunds happen in the admin site, never here. David is dispatched from the admin site, not by log_phone_job.',
  'Read results back to the person in two lines.',
].join(' ')

type AuthContext = { http?: { authInfo?: { extra?: Record<string, unknown> } } }

function labelFrom(ctx: unknown): string | null {
  const label = (ctx as AuthContext).http?.authInfo?.extra?.label
  return typeof label === 'string' && label ? label : null
}

function text(value: unknown, isError = false) {
  return { content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }], isError }
}

const handler = createMcpHandler(
  (server) => {
    for (const tool of TOOLS) {
      server.registerTool(
        tool.name,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: { readOnlyHint: tool.readOnly, destructiveHint: false, openWorldHint: false },
        },
        async (input, ctx) => {
          const label = labelFrom(ctx)
          if (!label) return text('Not authenticated', true)
          const limit = await checkLimit('mcp', label)
          if (!limit.success) {
            return text(`Too many requests; try again in ${limit.retryAfterSeconds}s`, true)
          }
          const actor = actorFor(label)
          if (tool.money) {
            // Same tight bucket the admin site uses for quote sends, charges
            // and refunds, keyed by the Claude actor so it is per person.
            const money = await checkLimit('admin-money', actor)
            if (!money.success) {
              return text(`Too many money actions; try again in ${money.retryAfterSeconds}s`, true)
            }
          }
          try {
            const result = await tool.run(input, actor)
            logger.info({ tool: tool.name, actor }, 'mcp: tool call')
            return text(result)
          } catch (err) {
            Sentry.captureException(err, { tags: { route: 'mcp', tool: tool.name }, extra: { actor } })
            logger.error({ err, tool: tool.name, actor }, 'mcp: tool threw')
            return text(`Error: ${err instanceof Error ? err.message : String(err)}`, true)
          }
        },
      )
    }
  },
  {
    serverInfo: { name: 'forge-handyman', version: '1.0.0' },
    instructions: INSTRUCTIONS,
  },
)

const authed = withMcpAuth(
  handler,
  async (_req, bearer) => {
    const label = resolveMcpToken(bearer)
    if (!label) return undefined
    return { token: bearer as string, scopes: ['crm'], clientId: label, extra: { label } }
  },
  { required: true },
)

export { authed as GET, authed as POST, authed as DELETE }
