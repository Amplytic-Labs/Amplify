import type { Tool } from 'ai';

/*
 * AI SDK v7: Tool type uses `inputSchema` (FlexibleSchema) instead of
 * the legacy `parameters` property. The inputSchema can be a Zod schema,
 * JSON Schema object, or other schema format.
 */
type ParameterProperty = {
  type?: string;
  description?: string;
};

type JsonSchemaObject = {
  properties?: Record<string, ParameterProperty>;
  required?: string[];
};

type McpToolProps = {
  toolName: string;
  toolSchema: Tool;
};

/*
 * Extract parameters from Tool's inputSchema.
 * In v7, inputSchema is a FlexibleSchema which can be:
 * - A Zod schema (has .describe() or .shape())
 * - A JSON Schema object (has .properties)
 * - Other schema formats
 */
function extractParameters(toolSchema: Tool): { properties: Record<string, ParameterProperty>; required: string[] } {
  // Try to access inputSchema (v7)
  const inputSchema = (toolSchema as any).inputSchema;
  
  if (!inputSchema) {
    // Fallback to legacy parameters for backwards compatibility
    const legacyParams = (toolSchema as any).parameters;
    if (legacyParams?.jsonSchema) {
      return {
        properties: legacyParams.jsonSchema.properties || {},
        required: legacyParams.jsonSchema.required || [],
      };
    }
    return { properties: {}, required: [] };
  }

  // If it's a JSON-like schema with properties
  if (inputSchema.properties) {
    return {
      properties: inputSchema.properties || {},
      required: inputSchema.required || [],
    };
  }

  // If it's a Zod-like schema with shape
  if (typeof inputSchema.shape === 'object') {
    const shape = inputSchema.shape;
    const properties: Record<string, ParameterProperty> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      const field = value as any;
      properties[key] = {
        type: field.type || 'string',
        description: field.description || field.describe?.(),
      };
      if (!field.isOptional?.()) {
        required.push(key);
      }
    }

    return { properties, required };
  }

  return { properties: {}, required: [] };
}

export default function McpServerListItem({ toolName, toolSchema }: McpToolProps) {
  if (!toolSchema) {
    return null;
  }

  const { properties: parameters, required: requiredParams } = extractParameters(toolSchema);

  return (
    <div className="mt-2 ml-4 p-3 rounded-md bg-amplify-elements-background-depth-2 text-xs">
      <div className="flex flex-col gap-1.5">
        <h3 className="text-amplify-elements-textPrimary font-semibold truncate" title={toolName}>
          {toolName}
        </h3>

        <p className="text-amplify-elements-textSecondary">{toolSchema.description || 'No description available'}</p>

        {Object.keys(parameters).length > 0 && (
          <div className="mt-2.5">
            <h4 className="text-amplify-elements-textSecondary font-semibold mb-1.5">Parameters:</h4>
            <ul className="ml-1 space-y-2">
              {Object.entries(parameters).map(([paramName, paramDetails]) => (
                <li key={paramName} className="break-words">
                  <div className="flex items-start">
                    <span className="font-medium text-amplify-elements-textPrimary">
                      {paramName}
                      {requiredParams.includes(paramName) && (
                        <span className="text-red-600 dark:text-red-400 ml-1">*</span>
                      )}
                    </span>

                    <span className="mx-2 text-amplify-elements-textSecondary">•</span>

                    <div className="flex-1">
                      {paramDetails.type && (
                        <span className="text-amplify-elements-textSecondary italic">{paramDetails.type}</span>
                      )}
                      {paramDetails.description && (
                        <div className="mt-0.5 text-amplify-elements-textSecondary">{paramDetails.description}</div>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
