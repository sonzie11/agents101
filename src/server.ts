import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SalesforceClient, SalesforceError } from "./salesforce.js";

export function createMcpServer(sf: SalesforceClient): McpServer {
  const server = new McpServer({
    name: "salesforce-mcp",
    version: "1.0.0",
  });

  server.registerTool(
    "soql_query",
    {
      title: "Salesforce SOQL Query",
      description:
        "Run a read-only SOQL query against Salesforce and return matching records as JSON. " +
        "Example: SELECT Id, Name, Industry FROM Account WHERE Industry = 'Technology' LIMIT 10",
      inputSchema: {
        soql: z.string().min(1).describe("A valid SOQL query string, e.g. SELECT Id, Name FROM Account LIMIT 5"),
      },
    },
    async ({ soql }) => {
      try {
        const result = await sf.query(soql);
        return jsonResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "sosl_search",
    {
      title: "Salesforce SOSL Search",
      description:
        "Run a SOSL full-text search across Salesforce objects and return matching records as JSON. " +
        "Example: FIND {Acme} IN ALL FIELDS RETURNING Account(Id, Name), Contact(Id, Name, Email)",
      inputSchema: {
        sosl: z
          .string()
          .min(1)
          .describe("A valid SOSL search string, e.g. FIND {Acme*} IN NAME FIELDS RETURNING Account(Id, Name)"),
      },
    },
    async ({ sosl }) => {
      try {
        const result = await sf.search(sosl);
        return jsonResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  return server;
}

function jsonResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function errorResult(err: unknown) {
  const message =
    err instanceof SalesforceError
      ? `${err.message}${err.status ? ` (HTTP ${err.status})` : ""}`
      : err instanceof Error
        ? err.message
        : String(err);
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
  };
}
