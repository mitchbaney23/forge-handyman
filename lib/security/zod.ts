import { parsePhoneNumberFromString } from 'libphonenumber-js'
import { z } from 'zod'

export const phoneSchema = z
  .string()
  .min(7, 'Phone number too short')
  .max(40, 'Phone number too long')
  .refine(
    (val) => {
      const parsed = parsePhoneNumberFromString(val, 'US')
      return parsed?.isValid() ?? false
    },
    { message: 'Invalid phone number' },
  )
  .transform((val) => parsePhoneNumberFromString(val, 'US')!.format('E.164'))

export const emailSchema = z
  .string()
  .min(3)
  .max(160)
  .email('Invalid email format')
  .transform((s) => s.trim().toLowerCase())

export const zipSchema = z
  .string()
  .regex(/^\d{5}(-\d{4})?$/, 'Invalid ZIP code')

export const freeTextSchema = z
  .string()
  .min(1, 'Required')
  .max(2000, 'Too long (max 2000 characters)')
  .transform((s) =>
    s
      .trim()
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' '),
  )

export const shortTextSchema = z
  .string()
  .min(1, 'Required')
  .max(240, 'Too long (max 240 characters)')
  .transform((s) => s.trim())

export const nameSchema = z
  .string()
  .min(1, 'Required')
  .max(120, 'Too long (max 120 characters)')
  .transform((s) => s.trim())

export const honeypotSchema = z
  .string()
  .max(0, 'Suspected spam')
  .optional()
  .or(z.literal(''))

export function fieldErrorsFromZod(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_root'
    if (!out[key]) out[key] = issue.message
  }
  return out
}
