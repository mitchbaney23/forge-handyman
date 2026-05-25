import { z } from 'zod'
import {
  BUDGET_RANGES,
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

export const budgetRangeSchema = z.enum(
  BUDGET_RANGES.map((s) => s.code) as [string, ...string[]],
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
