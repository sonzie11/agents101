#!/usr/bin/env node
// Minimal, dependency-free BigQuery REST API client.
//
// Runs a read-only SQL query against BigQuery using the REST API
// (jobs.query + getQueryResults) and prints the rows as a JSON array of
// objects to stdout. Used by the `weekly-sales-digest` agent.
//
// Usage:
//   node scripts/bq-query.mjs "SELECT 1 AS x"
//   echo "SELECT 1 AS x" | node scripts/bq-query.mjs
//   node scripts/bq-query.mjs --format=tsv "SELECT ..."
//
// Auth (first match wins):
//   1. BQ_ACCESS_TOKEN / GOOGLE_OAUTH_ACCESS_TOKEN  — a pre-minted OAuth2 token.
//   2. Service account key:
//        GOOGLE_APPLICATION_CREDENTIALS = path to the JSON key file, or
//        GCP_SERVICE_ACCOUNT_KEY        = the JSON key as an inline string.
//      The key is signed into a JWT (RS256) and exchanged for an access token.
//   3. GCE/Cloud Run metadata server (if running on GCP).
//
// Config:
//   BQ_PROJECT_ID  billing/run project (default: prism-sg-datahub)
//   BQ_LOCATION    dataset location, e.g. asia-southeast1 (optional)
//   BQ_SCOPE       OAuth scope (default: https://www.googleapis.com/auth/bigquery)

import { readFileSync } from "node:fs";
import { createSign } from "node:crypto";

const DEFAULT_PROJECT = process.env.BQ_PROJECT_ID?.trim() || "prism-sg-datahub";
const LOCATION = process.env.BQ_LOCATION?.trim() || undefined;
const SCOPE = process.env.BQ_SCOPE?.trim() || "https://www.googleapis.com/auth/bigquery";
const TOKEN_URI = "https://oauth2.googleapis.com/token";

function b64url(input) {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function tokenFromServiceAccount(key) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: key.client_email,
      scope: SCOPE,
      aud: key.token_uri || TOKEN_URI,
      iat: now,
      exp: now + 3600,
    }),
  );
  const signingInput = `${header}.${claims}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  const signature = signer.sign(key.private_key).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const assertion = `${signingInput}.${signature}`;

  const res = await fetch(key.token_uri || TOKEN_URI, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(`Token exchange failed: ${data.error ?? res.statusText} ${data.error_description ?? ""}`.trim());
  }
  return data.access_token;
}

async function tokenFromMetadata() {
  const url =
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";
  const res = await fetch(url, { headers: { "Metadata-Flavor": "Google" } });
  if (!res.ok) throw new Error(`Metadata token request failed: HTTP ${res.status}`);
  const data = await res.json();
  return data.access_token;
}

async function getAccessToken() {
  const direct = process.env.BQ_ACCESS_TOKEN?.trim() || process.env.GOOGLE_OAUTH_ACCESS_TOKEN?.trim();
  if (direct) return direct;

  const inlineKey = process.env.GCP_SERVICE_ACCOUNT_KEY?.trim();
  const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (inlineKey || keyPath) {
    const raw = inlineKey || readFileSync(keyPath, "utf8");
    return tokenFromServiceAccount(JSON.parse(raw));
  }

  // Last resort: GCP metadata server.
  try {
    return await tokenFromMetadata();
  } catch (err) {
    throw new Error(
      "No BigQuery credentials found. Set BQ_ACCESS_TOKEN, or GOOGLE_APPLICATION_CREDENTIALS / " +
        "GCP_SERVICE_ACCOUNT_KEY (service account JSON), or run on GCP with a metadata server. " +
        `(metadata fallback: ${err.message})`,
    );
  }
}

// Convert a BigQuery REST row ({ f: [{ v }] }) + schema into a plain object,
// coercing numeric/bool types so downstream math is clean.
function coerce(value, field) {
  if (value === null || value === undefined) return null;
  const t = (field.type || "").toUpperCase();
  if (["INTEGER", "INT64", "FLOAT", "FLOAT64", "NUMERIC", "BIGNUMERIC"].includes(t)) {
    const n = Number(value);
    return Number.isNaN(n) ? value : n;
  }
  if (["BOOL", "BOOLEAN"].includes(t)) return value === "true" || value === true;
  return value;
}

function rowsToObjects(fields, rows) {
  return (rows || []).map((row) => {
    const obj = {};
    fields.forEach((field, i) => {
      obj[field.name] = coerce(row.f[i]?.v, field);
    });
    return obj;
  });
}

async function runQuery(sql) {
  const token = await getAccessToken();
  const base = `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(DEFAULT_PROJECT)}`;
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  // Start the query.
  let res = await fetch(`${base}/queries`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      query: sql,
      useLegacySql: false,
      timeoutMs: 60000,
      ...(LOCATION ? { location: LOCATION } : {}),
    }),
  });
  let data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || res.statusText;
    throw new Error(`BigQuery query failed: ${msg}`);
  }

  const fields = data.schema?.fields || [];
  const jobId = data.jobReference?.jobId;
  const jobLocation = data.jobReference?.location || LOCATION;
  let rows = data.rows || [];
  let pageToken = data.pageToken;
  let complete = data.jobComplete;

  // Poll/paginate via getQueryResults until the job is done and all pages read.
  while (!complete || pageToken) {
    const params = new URLSearchParams({ timeoutMs: "60000" });
    if (pageToken) params.set("pageToken", pageToken);
    if (jobLocation) params.set("location", jobLocation);
    res = await fetch(`${base}/queries/${encodeURIComponent(jobId)}?${params}`, { headers });
    data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data?.error?.message || res.statusText;
      throw new Error(`BigQuery getQueryResults failed: ${msg}`);
    }
    complete = data.jobComplete;
    if (data.rows) rows = rows.concat(data.rows);
    pageToken = data.pageToken;
    if (!complete && !pageToken) await new Promise((r) => setTimeout(r, 500));
  }

  return rowsToObjects(fields.length ? fields : data.schema?.fields || [], rows);
}

function toTsv(objects) {
  if (objects.length === 0) return "";
  const cols = Object.keys(objects[0]);
  const lines = [cols.join("\t")];
  for (const o of objects) lines.push(cols.map((c) => (o[c] === null ? "" : String(o[c]))).join("\t"));
  return lines.join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  let format = "json";
  const sqlParts = [];
  for (const a of args) {
    if (a.startsWith("--format=")) format = a.slice("--format=".length);
    else sqlParts.push(a);
  }
  let sql = sqlParts.join(" ").trim();
  if (!sql && !process.stdin.isTTY) {
    sql = readFileSync(0, "utf8").trim(); // read from stdin
  }
  if (!sql) {
    console.error("Usage: node scripts/bq-query.mjs [--format=json|tsv] \"<SQL>\"  (or pipe SQL on stdin)");
    process.exit(2);
  }

  const objects = await runQuery(sql);
  if (format === "tsv") process.stdout.write(toTsv(objects) + "\n");
  else process.stdout.write(JSON.stringify(objects, null, 2) + "\n");
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
