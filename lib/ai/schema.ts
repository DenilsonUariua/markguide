/**
 * Schemas live in Gemini's dialect — upper-case types and `propertyOrdering`.
 * OpenAI-compatible providers want plain JSON Schema, with objects closed and
 * every property listed as required. Translating here keeps one source of truth
 * for the rubric and mark shapes.
 */

type SchemaNode = Record<string, unknown>;

export function toJsonSchema(node: SchemaNode): SchemaNode {
  const out: SchemaNode = {};

  for (const [key, value] of Object.entries(node)) {
    // Gemini-only hint; JSON Schema rejects unknown keywords on strict providers.
    if (key === "propertyOrdering") continue;

    if (key === "type" && typeof value === "string") {
      out.type = value.toLowerCase();
      continue;
    }

    if (key === "properties" && value && typeof value === "object") {
      out.properties = Object.fromEntries(
        Object.entries(value as SchemaNode).map(([name, child]) => [name, toJsonSchema(child as SchemaNode)]),
      );
      continue;
    }

    if (key === "items" && value && typeof value === "object") {
      out.items = toJsonSchema(value as SchemaNode);
      continue;
    }

    out[key] = value;
  }

  if (out.type === "object" && out.properties && typeof out.properties === "object") {
    out.additionalProperties = false;
    out.required = Object.keys(out.properties as SchemaNode);
  }

  return out;
}
