type JsonSchema = {
  type?: string | string[]
  description?: string
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema | JsonSchema[]
  enum?: string[]
  anyOf?: JsonSchema[]
  oneOf?: JsonSchema[]
}

type GeminiSchema = Record<string, unknown>

function normalizeType(type: string | string[] | undefined, schema: JsonSchema): string | undefined {
  const candidate = Array.isArray(type) ? type.find((value) => value !== 'null') : type
  if (candidate) {
    const normalized = candidate.toUpperCase()
    if (['STRING', 'NUMBER', 'INTEGER', 'BOOLEAN', 'OBJECT', 'ARRAY'].includes(normalized)) {
      return normalized
    }
  }
  if (schema.properties) return 'OBJECT'
  if (schema.items) return 'ARRAY'
  return undefined
}

function mergeUnion(schema: JsonSchema): JsonSchema {
  const variants = schema.anyOf ?? schema.oneOf
  if (!variants?.length) return schema

  const nonNull = variants.filter((variant) => {
    if (Array.isArray(variant.type)) return !variant.type.includes('null')
    return variant.type !== 'null'
  })
  if (nonNull.length === 1) return nonNull[0]!

  return {
    type: 'STRING',
    description:
      schema.description ??
      'A value accepted by multiple JSON Schema variants. Provide a JSON-compatible string representation.',
  }
}

export function toGeminiSchema(input: unknown): GeminiSchema {
  const source = (input && typeof input === 'object' ? input : {}) as JsonSchema
  const schema = mergeUnion(source)
  const result: GeminiSchema = {}

  const type = normalizeType(schema.type, schema)
  if (type) result.type = type
  if (schema.description) result.description = schema.description
  if (schema.enum?.length) result.enum = schema.enum

  if (schema.properties && typeof schema.properties === 'object') {
    const properties: Record<string, GeminiSchema> = {}
    for (const [name, property] of Object.entries(schema.properties)) {
      properties[name] = toGeminiSchema(property)
    }
    result.properties = properties
  }

  if (Array.isArray(schema.required) && schema.required.length) {
    result.required = schema.required
  }

  if (schema.items) {
    const item = Array.isArray(schema.items) ? schema.items[0] : schema.items
    if (item) result.items = toGeminiSchema(item)
  }

  return result
}
