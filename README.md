# Salesforce MCP Server

A remote [Model Context Protocol](https://modelcontextprotocol.io) server that exposes Salesforce
**SOQL** and **SOSL** queries as tools. It is designed to be deployed as an HTTP service and added
as a **custom connector** in a Claude Teams/Enterprise organization, so everyone in the org can
query Salesforce from Claude.

Authentication to Salesforce uses the **OAuth 2.0 Client Credentials flow** — machine-to-machine,
no user passwords stored, no interactive login. The server runs queries as a single designated
integration user.

## Tools

| Tool | Description |
| --- | --- |
| `soql_query` | Run a read-only SOQL query, e.g. `SELECT Id, Name FROM Account LIMIT 10`. |
| `sosl_search` | Run a SOSL full-text search, e.g. `FIND {Acme} IN ALL FIELDS RETURNING Account(Id, Name)`. |

Both are read-only — SOQL/SOSL cannot mutate data.

## 1. Set up the Salesforce Connected App

The Client Credentials flow requires a **My Domain** and a Connected App with a designated run-as user.

1. In Salesforce Setup, enable **My Domain** (Setup → My Domain) if you haven't already. Your login
   URL will look like `https://your-domain.my.salesforce.com`.
2. Setup → **App Manager** → **New Connected App** (or **New External Client App**).
3. Enable **OAuth Settings**:
   - Callback URL: `https://login.salesforce.com/services/oauth2/callback` (unused by this flow but required).
   - OAuth Scopes: add **Manage user data via APIs (api)**.
   - Check **Enable Client Credentials Flow**.
4. Save. Open **Manage Consumer Details** to copy the **Consumer Key** (`SF_CLIENT_ID`) and
   **Consumer Secret** (`SF_CLIENT_SECRET`).
5. Edit the Connected App's policies (**Manage** → **Edit Policies**) and set the
   **Run As** user under *Client Credentials Flow* to the integration user whose permissions the
   queries should run with.

## 2. Configure the server

Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

| Variable | Required | Description |
| --- | --- | --- |
| `SF_LOGIN_URL` | yes | My Domain URL, e.g. `https://your-domain.my.salesforce.com`. |
| `SF_CLIENT_ID` | yes | Connected App Consumer Key. |
| `SF_CLIENT_SECRET` | yes | Connected App Consumer Secret. |
| `SF_API_VERSION` | no | REST API version, default `60.0`. |
| `PORT` | no | HTTP port, default `3000`. |
| `MCP_AUTH_TOKEN` | recommended | Shared bearer token; if set, requests must send `Authorization: Bearer <token>`. |

## 3. Run

```bash
npm install
npm run build
npm start
```

The server listens on `POST /mcp` and exposes `GET /health`.

Quick local check:

```bash
curl -s http://localhost:3000/health   # {"status":"ok"}
```

## 4. Deploy

Deploy anywhere that can run a Node 20+ HTTP service and is reachable over **HTTPS** (Claude
connectors require HTTPS): Render, Fly.io, Railway, Cloud Run, ECS, a VM behind a TLS reverse
proxy, etc. Set the environment variables from step 2 in your platform's secret manager. **Always
set `MCP_AUTH_TOKEN` for a publicly reachable deployment.**

The public MCP endpoint will be `https://<your-host>/mcp`.

## 5. Add as a Claude Teams custom connector

1. In Claude, go to **Settings → Connectors** (org admins can add it org-wide under the
   organization's connector settings).
2. **Add custom connector** → enter the URL `https://<your-host>/mcp`.
3. If you set `MCP_AUTH_TOKEN`, provide it as the connector's bearer token / authorization header.
4. Save. The `soql_query` and `sosl_search` tools become available to members of the organization.

## Architecture notes

- **Transport:** Streamable HTTP (the current MCP remote transport), run in **stateless** mode —
  each request gets a fresh server instance, so the service scales horizontally with no shared
  session state.
- **Token handling:** the Salesforce access token and instance URL are cached in memory and
  transparently refreshed on a `401`.
- **Security:** the optional `MCP_AUTH_TOKEN` guards the `/mcp` endpoint. Salesforce credentials
  never leave the server.
