import express, { type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SalesforceClient } from "./salesforce.js";
import { createMcpServer } from "./server.js";

const PORT = Number(process.env.PORT ?? 3000);
const AUTH_TOKEN = process.env.MCP_AUTH_TOKEN?.trim();

// Fail fast if Salesforce config is missing.
const sf = SalesforceClient.fromEnv();

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

/** Optional shared-secret guard for the MCP endpoint. */
function authorized(req: Request): boolean {
  if (!AUTH_TOKEN) return true;
  const header = req.headers.authorization ?? "";
  return header === `Bearer ${AUTH_TOKEN}`;
}

// Stateless Streamable HTTP: each request gets a fresh server + transport.
// This keeps the deployment horizontally scalable (no in-memory session state).
app.post("/mcp", async (req: Request, res: Response) => {
  if (!authorized(req)) {
    res.status(401).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Unauthorized" },
      id: null,
    });
    return;
  }

  const server = createMcpServer(sf);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  res.on("close", () => {
    transport.close();
    server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("Error handling MCP request:", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

// GET/DELETE are not used in stateless mode; respond per MCP spec.
const methodNotAllowed = (_req: Request, res: Response) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed." },
    id: null,
  });
};
app.get("/mcp", methodNotAllowed);
app.delete("/mcp", methodNotAllowed);

app.listen(PORT, () => {
  console.log(`Salesforce MCP server listening on port ${PORT} (POST /mcp)`);
});
