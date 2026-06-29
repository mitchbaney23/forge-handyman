import { describe, it, expect } from 'vitest'
import { contactSchema } from '@/app/api/contact/route'

// Server-side mirror of the form's description rule (see ContactForm.tsx):
// when the customer picks menu items, the cart IS the job, so notes are
// optional; on the "I'm not sure / custom job" path the description IS the
// job, so it's required. These tests guard that contract on the API side so a
// blank-notes menu order is never rejected, and a blank custom request always
// is.

const base = {
  name: 'Jane Homeowner',
  phone: '9195551234',
  email: 'jane@example.com',
  address: '123 Main St, Garner, NC',
  propertyType: 'residential',
  urgency: 'flexible',
  bestContactTime: 'any',
  bestContactMethod: 'any',
}

const cartWithItem = { items: [{ id: 'door-fix', qty: 1 }], packageNumber: null }

describe('contactSchema — description requiredness by path', () => {
  it('accepts a menu order with a blank description', () => {
    const result = contactSchema.safeParse({
      ...base,
      cart: cartWithItem,
      notSure: false,
      description: '',
    })
    expect(result.success).toBe(true)
  })

  it('accepts a menu order with a description present', () => {
    const result = contactSchema.safeParse({
      ...base,
      cart: cartWithItem,
      notSure: false,
      description: 'The bathroom door rubs the frame.',
    })
    expect(result.success).toBe(true)
  })

  it('rejects a "not sure" request with a blank description', () => {
    const result = contactSchema.safeParse({
      ...base,
      notSure: true,
      description: '',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const onDescription = result.error.issues.some((i) =>
        i.path.includes('description'),
      )
      expect(onDescription).toBe(true)
    }
  })

  it('accepts a "not sure" request with a description', () => {
    const result = contactSchema.safeParse({
      ...base,
      notSure: true,
      description: 'Not sure what it is — water pooling under the sink cabinet.',
    })
    expect(result.success).toBe(true)
  })

  it('sanitizes and caps the description like the old freeTextSchema', () => {
    const result = contactSchema.safeParse({
      ...base,
      cart: cartWithItem,
      description: '  <b>hello</b>   world  ',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      // HTML stripped, whitespace collapsed, trimmed.
      expect(result.data.description).toBe('hello world')
    }
  })
})

// Security: the form's client-side validation (required/pattern) is just UX —
// the API is the real gate. This proves the exact "test" from the security
// review (submit a garbage email + blank name) is rejected SERVER-SIDE.
describe('contactSchema — server-side input validation (security)', () => {
  it('rejects a garbage email like "notanemail"', () => {
    const result = contactSchema.safeParse({
      ...base,
      email: 'notanemail',
      cart: cartWithItem,
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes('email'))).toBe(true)
    }
  })

  it('rejects a blank name', () => {
    const result = contactSchema.safeParse({
      ...base,
      name: '',
      cart: cartWithItem,
    })
    expect(result.success).toBe(false)
  })

  it('rejects a blank / malformed phone', () => {
    const result = contactSchema.safeParse({
      ...base,
      phone: '',
      cart: cartWithItem,
    })
    expect(result.success).toBe(false)
  })
})
