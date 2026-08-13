type JsonSchema = {
  type?: string
  description?: string
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema | JsonSchema[]
  enum?: string[]
  anyOf?: JsonSchema[]
  oneOf?: JsonSchema[]
  nullable?: boolean
}

type GeminiSchema = Record<string, unknown>

function normalizeType(type: string | undefined, schema: JsonSchema): string | undefined {
  if (type) {
    const normalized = type.toUpperCase()
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

  const nonNull = variants.filter((variant) => variant.type !== 'null')
  if (nonNull.length === 1) {
    return { ...nonNull[0], description: schema.description ?? nonNull[0]?.description }
  }

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
    // Gemini's Schema.items accepts one Schema object, not JSON Schema's tuple form.
    // For tuple-style arrays, preserve the first item schema as the closest valid representation.
    const item = Array.isArray(schema.items) ? schema.items[0] : schema.items
    if (item) result.items = toGeminiSchema(item)
  }

  if (schema.nullable === true) result.nullable = true
  return result
}
