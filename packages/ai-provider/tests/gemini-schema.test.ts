import { describe, expect, it } from 'vitest'
import { toGeminiSchema } from '../src/gemini-schema'

describe('toGeminiSchema', () => {
  it('normalizes nullable nested arrays and object items for Gemini function declarations', () => {
    const schema = toGeminiSchema({
      type: 'object',
      properties: {
        rows: {
          type: ['array', 'null'],
          items: {
            type: ['object', 'null'],
            properties: {
              values: {
                type: 'array',
                items: { type: ['string', 'null'] },
              },
            },
          },
        },
      },
      required: ['rows'],
    }) as Record<string, any>

    expect(schema.type).toBe('OBJECT')
    expect(schema.properties.rows.type).toBe('ARRAY')
    expect(schema.properties.rows.items.type).toBe('OBJECT')
    expect(schema.properties.rows.items.properties.values.items).toEqual({ type: 'STRING' })
    expect(Array.isArray(schema.properties.rows.items)).toBe(false)
    expect(Array.isArray(schema.properties.rows.items.properties.values.items)).toBe(false)
  })

  it('always supplies an item schema for an array with an incomplete JSON schema', () => {
    expect(toGeminiSchema({ type: 'array' })).toEqual({
      type: 'ARRAY',
      items: { type: 'STRING' },
    })
  })
})
