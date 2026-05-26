export interface SalesforceConfig {
  loginUrl: string;
  clientId: string;
  clientSecret: string;
  apiVersion: string;
}

interface TokenState {
  accessToken: string;
  instanceUrl: string;
}

export class SalesforceError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "SalesforceError";
  }
}

/**
 * Minimal Salesforce REST client using the OAuth 2.0 Client Credentials flow.
 * Authenticates machine-to-machine via a Connected App; no user password is stored.
 */
export class SalesforceClient {
  private token: TokenState | null = null;

  constructor(private readonly config: SalesforceConfig) {}

  static fromEnv(): SalesforceClient {
    const loginUrl = requireEnv("SF_LOGIN_URL");
    const clientId = requireEnv("SF_CLIENT_ID");
    const clientSecret = requireEnv("SF_CLIENT_SECRET");
    const apiVersion = process.env.SF_API_VERSION?.trim() || "60.0";
    return new SalesforceClient({ loginUrl, clientId, clientSecret, apiVersion });
  }

  private async authenticate(): Promise<TokenState> {
    const tokenUrl = `${trimSlash(this.config.loginUrl)}/services/oauth2/token`;
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    });

    const res = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || typeof data.access_token !== "string") {
      throw new SalesforceError(
        `Salesforce authentication failed: ${data.error ?? res.statusText} - ${data.error_description ?? ""}`.trim(),
        res.status,
        data,
      );
    }

    this.token = {
      accessToken: data.access_token,
      instanceUrl: typeof data.instance_url === "string" ? data.instance_url : this.config.loginUrl,
    };
    return this.token;
  }

  /** Performs a REST GET, transparently (re)authenticating and retrying once on 401. */
  private async apiGet(path: string): Promise<unknown> {
    let token = this.token ?? (await this.authenticate());

    const doRequest = async (t: TokenState) => {
      const url = `${trimSlash(t.instanceUrl)}/services/data/v${this.config.apiVersion}${path}`;
      return fetch(url, { headers: { Authorization: `Bearer ${t.accessToken}` } });
    };

    let res = await doRequest(token);
    if (res.status === 401) {
      token = await this.authenticate();
      res = await doRequest(token);
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // Salesforce returns an array of { message, errorCode } on error.
      const msg = Array.isArray(data) && data[0]?.message ? data[0].message : res.statusText;
      throw new SalesforceError(`Salesforce API error: ${msg}`, res.status, data);
    }
    return data;
  }

  /** Runs a SOQL query. Returns the raw query result (records, totalSize, done, nextRecordsUrl). */
  async query(soql: string): Promise<unknown> {
    return this.apiGet(`/query?q=${encodeURIComponent(soql)}`);
  }

  /** Runs a SOSL search (FIND {...} ...). Returns the raw search result. */
  async search(sosl: string): Promise<unknown> {
    return this.apiGet(`/search?q=${encodeURIComponent(sosl)}`);
  }
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}
