export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "P2 TenantRAG API",
    version: "0.0.0",
    description:
      "A multi-tenant RAG service for learning Cedarling enforcement boundaries.",
  },
  paths: {
    "/openapi.json": {
      get: {
        operationId: "getOpenApi",
        responses: { "200": { description: "OpenAPI document" } },
      },
    },
    "/v1/retrievals": {
      post: {
        operationId: "createRetrieval",
        security: [{ bearerAuth: [] }],
        "x-cedarling-capabilities": ["corpus.search", "document.retrieve"],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["corpusId", "query"],
                properties: {
                  corpusId: { type: "string", minLength: 1, maxLength: 64 },
                  query: { type: "string", minLength: 1, maxLength: 500 },
                  limit: {
                    type: "integer",
                    minimum: 1,
                    maximum: 3,
                    default: 3,
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Generated answer and server-owned citations",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/RetrievalResponse" },
              },
            },
          },
          "400": {
            description: "Invalid retrieval request",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
          "401": {
            description: "Authentication required",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
          "404": {
            description: "Corpus not found",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
          "503": {
            description: "Retrieval dependency unavailable",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
    },
    schemas: {
      Citation: {
        type: "object",
        additionalProperties: false,
        required: ["documentId", "chunkId", "label"],
        properties: {
          documentId: { type: "string", minLength: 1 },
          chunkId: { type: "string", minLength: 1 },
          label: { type: "string", minLength: 1 },
        },
      },
      RetrievalResponse: {
        type: "object",
        additionalProperties: false,
        required: ["requestId", "answer", "citations"],
        properties: {
          requestId: { type: "string", pattern: "^req_" },
          answer: { type: ["string", "null"] },
          citations: {
            type: "array",
            maxItems: 3,
            items: { $ref: "#/components/schemas/Citation" },
          },
        },
      },
      ErrorResponse: {
        type: "object",
        additionalProperties: false,
        required: ["requestId", "error"],
        properties: {
          requestId: { type: "string", pattern: "^req_" },
          error: {
            type: "string",
            enum: [
              "invalid_retrieval",
              "authentication_required",
              "corpus_not_found",
              "retrieval_unavailable",
            ],
          },
        },
      },
    },
  },
} as const;
