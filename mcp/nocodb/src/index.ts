#!/usr/bin/env node

/**
 * NocoDB MCP Server
 *
 * Provides Model Context Protocol (MCP) interface to NocoDB API
 * with Airtable-compatible interface for easy migration.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { NocoDBClient } from "./nocodb-client.js";

// Environment variables
const NOCODB_URL = process.env.NOCODB_URL;
const NOCODB_TOKEN = process.env.NOCODB_TOKEN;

if (!NOCODB_URL || !NOCODB_TOKEN) {
  throw new Error("NOCODB_URL and NOCODB_TOKEN environment variables are required");
}

/**
 * NocoDB MCP Server
 */
class NocoDBServer {
  private server: Server;
  private client: NocoDBClient;

  constructor() {
    this.server = new Server(
      {
        name: "nocodb-mcp-server",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.client = new NocoDBClient(NOCODB_URL, NOCODB_TOKEN);

    this.setupToolHandlers();

    // Error handling
    this.server.onerror = (error) => console.error("[MCP Error]", error);

    // Signal handling
    process.on("SIGINT", async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupToolHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "nocodb_list_records",
          description: "List records from a NocoDB table",
          inputSchema: {
            type: "object",
            properties: {
              baseId: {
                type: "string",
                description: "Airtable base ID",
              },
              tableName: {
                type: "string",
                description: "Table name",
              },
              limit: {
                type: "number",
                description: "Maximum number of records to return (default: 100)",
              },
              offset: {
                type: "number",
                description: "Offset for pagination (default: 0)",
              },
              where: {
                type: "string",
                description: "Filter condition",
              },
              sort: {
                type: "string",
                description: "Sort order",
              },
              fields: {
                type: "array",
                items: { type: "string" },
                description: "Fields to return",
              },
            },
            required: ["baseId", "tableName"],
          },
        },
        {
          name: "nocodb_get_record",
          description: "Get a single record by ID",
          inputSchema: {
            type: "object",
            properties: {
              baseId: {
                type: "string",
                description: "Airtable base ID",
              },
              tableName: {
                type: "string",
                description: "Table name",
              },
              recordId: {
                type: "string",
                description: "Record ID",
              },
            },
            required: ["baseId", "tableName", "recordId"],
          },
        },
        {
          name: "nocodb_create_record",
          description: "Create a new record",
          inputSchema: {
            type: "object",
            properties: {
              baseId: {
                type: "string",
                description: "Airtable base ID",
              },
              tableName: {
                type: "string",
                description: "Table name",
              },
              fields: {
                type: "object",
                description: "Record fields",
              },
            },
            required: ["baseId", "tableName", "fields"],
          },
        },
        {
          name: "nocodb_update_record",
          description: "Update an existing record",
          inputSchema: {
            type: "object",
            properties: {
              baseId: {
                type: "string",
                description: "Airtable base ID",
              },
              tableName: {
                type: "string",
                description: "Table name",
              },
              recordId: {
                type: "string",
                description: "Record ID",
              },
              fields: {
                type: "object",
                description: "Updated fields",
              },
            },
            required: ["baseId", "tableName", "recordId", "fields"],
          },
        },
        {
          name: "nocodb_delete_record",
          description: "Delete a record",
          inputSchema: {
            type: "object",
            properties: {
              baseId: {
                type: "string",
                description: "Airtable base ID",
              },
              tableName: {
                type: "string",
                description: "Table name",
              },
              recordId: {
                type: "string",
                description: "Record ID",
              },
            },
            required: ["baseId", "tableName", "recordId"],
          },
        },
        // Meta API tools
        {
          name: "nocodb_get_table_meta",
          description: "Get table metadata including column definitions. Use NocoDB table ID directly (e.g., mxsy93mwfdvhug1)",
          inputSchema: {
            type: "object",
            properties: {
              tableId: {
                type: "string",
                description: "NocoDB table ID (e.g., mxsy93mwfdvhug1)",
              },
            },
            required: ["tableId"],
          },
        },
        {
          name: "nocodb_update_column",
          description: "Update column options for SingleSelect/MultiSelect columns. Use this to add or modify select options.",
          inputSchema: {
            type: "object",
            properties: {
              columnId: {
                type: "string",
                description: "NocoDB column ID (e.g., ctqf64uyeb7frf9)",
              },
              colOptions: {
                type: "object",
                description: "Column options object with 'options' array containing {title, color} objects",
                properties: {
                  options: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        title: { type: "string", description: "Option label" },
                        color: { type: "string", description: "Color code (e.g., #ffc9c9)" },
                      },
                      required: ["title"],
                    },
                  },
                },
                required: ["options"],
              },
            },
            required: ["columnId", "colOptions"],
          },
        },
      ],
    }));

    // Handle tool execution
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        switch (request.params.name) {
          case "nocodb_list_records": {
            const { baseId, tableName, limit, offset, where, sort, fields } =
              request.params.arguments as {
                baseId: string;
                tableName: string;
                limit?: number;
                offset?: number;
                where?: string;
                sort?: string;
                fields?: string[];
              };

            const records = await this.client.list(baseId, tableName, {
              limit,
              offset,
              where,
              sort,
              fields,
            });

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(records, null, 2),
                },
              ],
            };
          }

          case "nocodb_get_record": {
            const { baseId, tableName, recordId } = request.params.arguments as {
              baseId: string;
              tableName: string;
              recordId: string;
            };

            const record = await this.client.get(baseId, tableName, recordId);

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(record, null, 2),
                },
              ],
            };
          }

          case "nocodb_create_record": {
            const { baseId, tableName, fields } = request.params.arguments as {
              baseId: string;
              tableName: string;
              fields: Record<string, any>;
            };

            const record = await this.client.create(baseId, tableName, fields);

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(record, null, 2),
                },
              ],
            };
          }

          case "nocodb_update_record": {
            const { baseId, tableName, recordId, fields } = request.params
              .arguments as {
              baseId: string;
              tableName: string;
              recordId: string;
              fields: Record<string, any>;
            };

            const record = await this.client.update(
              baseId,
              tableName,
              recordId,
              fields
            );

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(record, null, 2),
                },
              ],
            };
          }

          case "nocodb_delete_record": {
            const { baseId, tableName, recordId } = request.params.arguments as {
              baseId: string;
              tableName: string;
              recordId: string;
            };

            await this.client.delete(baseId, tableName, recordId);

            return {
              content: [
                {
                  type: "text",
                  text: "Record deleted successfully",
                },
              ],
            };
          }

          // Meta API handlers
          case "nocodb_get_table_meta": {
            const { tableId } = request.params.arguments as {
              tableId: string;
            };

            const meta = await this.client.getTableMeta(tableId);

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(meta, null, 2),
                },
              ],
            };
          }

          case "nocodb_update_column": {
            const { columnId, colOptions } = request.params.arguments as {
              columnId: string;
              colOptions: {
                options: Array<{ title: string; color?: string }>;
              };
            };

            const result = await this.client.updateColumn(columnId, { colOptions });

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({ success: true, message: "Column options updated", result }, null, 2),
                },
              ],
            };
          }

          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${request.params.name}`
            );
        }
      } catch (error: any) {
        throw new McpError(
          ErrorCode.InternalError,
          `NocoDB error: ${error.message}`
        );
      }
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("NocoDB MCP server running on stdio");
  }
}

// Start server
const server = new NocoDBServer();
server.run().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
