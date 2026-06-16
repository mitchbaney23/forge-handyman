import { z } from 'zod'
import {
  CONTACT_METHODS,
  CONTACT_TIMES,
  PROPERTY_TYPES,
  SERVICE_CATEGORIES,
  URGENCY_OPTIONS,
} from '@/lib/constants'

export const serviceCategoryCodeSchema = z.enum(
  SERVICE_CATEGORIES.map((s) => s.code) as [string, ...string[]],
)

export const propertyTypeSchema = z.enum(
  PROPERTY_TYPES.map((s) => s.code) as [string, ...string[]],
)

export const urgencySchema = z.enum(
  URGENCY_OPTIONS.map((s) => s.code) as [string, ...string[]],
)

export const contactTimeSchema = z.enum(
  CONTACT_TIMES.map((s) => s.code) as [string, ...string[]],
)

export const contactMethodSchema = z.enum(
  CONTACT_METHODS.map((s) => s.code) as [string, ...string[]],
)

// Multi-select services: at least one entry, all must be valid codes,
// max 8 (the count of selectable categories).
export const serviceCategoriesArraySchema = z
  .array(serviceCategoryCodeSchema)
  .min(1, 'Pick at least one service')
  .max(8, 'Too many services selected')

// The booking cart contract (see lib/cart.ts). A single à-la-carte selection:
// a menu item id plus a quantity in 1..10.
export const cartSelectionSchema = z.object({
  id: z.string().min(1).max(40),
  qty: z.number().int().min(1).max(10),
})

// The full cart: up to 25 à-la-carte items plus an optional package number
// (1, 2, or 3). packageNumber may be null/omitted when no package is chosen;
// it's normalized to `null` so the parsed output matches the Cart contract
// (lib/cart.ts) exactly — `{ items: CartSelection[]; packageNumber: number | null }`.
export const cartSchema = z.object({
  items: z.array(cartSelectionSchema).max(25),
  packageNumber: z
    .union([z.literal(1), z.literal(2), z.literal(3)])
    .nullable()
    .optional()
    .transform((n) => n ?? null),
})
