import assert from "node:assert/strict";
import type { AppConfig } from "../src/server/config.ts";
import type { AccountId, SessionView } from "../src/shared/contracts.ts";

class CookieJar {
  private readonly cookies = new Map<string, string>();
  async request(url: string | URL, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    // Restart the server between requests to verify session persistence.
    headers.set("Connection", "close");
    headers.set(
      "Cookie",
      [...this.cookies].map(([key, value]) => `${key}=${value}`).join("; "),
    );
    const response = await fetch(url, {
      ...init,
      headers,
      redirect: "manual",
      signal: init.signal ?? AbortSignal.timeout(10000),
    });
    for (const header of response.headers.getSetCookie()) {
      const pair = header.split(";")[0] ?? "";
      const index = pair.indexOf("=");
      if (index < 1) continue;
      const name = pair.slice(0, index);
      const value = pair.slice(index + 1);
      if (!value || /;\s*Max-Age=0(?:;|$)/iu.test(header))
        this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    return response;
  }
}
function redirect(response: Response, origin: string): URL {
  assert.ok(
    [302, 303, 307, 308].includes(response.status),
    `Expected redirect; received ${response.status}`,
  );
  const location = response.headers.get("location");
  assert.ok(location, "Redirect location missing");
  const target = new URL(location, origin);
  assert.equal(target.origin, origin, "Unexpected redirect origin");
  return target;
}
function formAction(html: string, origin: string): URL {
  const action = html.match(/<form[^>]*action="([^"]+)"/u)?.[1];
  assert.ok(action, "IdP form action missing");
  const target = new URL(action.replaceAll("&amp;", "&"), origin);
  assert.equal(target.origin, origin);
  return target;
}
export async function openSession(config: AppConfig, subject: AccountId) {
  const app = new CookieJar();
  const issuer = new CookieJar();
  const start = await app.request(
    `${config.baseUrl}/auth/login?login_hint=${subject}`,
  );
  const authorization = redirect(start, config.issuer);
  const interaction = await issuer.request(authorization);
  const loginPage = await issuer.request(redirect(interaction, config.issuer));
  assert.equal(loginPage.status, 200);
  const login = await issuer.request(
    formAction(await loginPage.text(), config.issuer),
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        login: subject,
        password: "tutorial",
        prompt: "login",
      }),
    },
  );
  const resume = await issuer.request(redirect(login, config.issuer));
  const consentPage = await issuer.request(redirect(resume, config.issuer));
  assert.equal(consentPage.status, 200);
  const consent = await issuer.request(
    formAction(await consentPage.text(), config.issuer),
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ prompt: "consent" }),
    },
  );
  const consentResume = await issuer.request(redirect(consent, config.issuer));
  const callback = await app.request(redirect(consentResume, config.baseUrl));
  assert.equal(
    callback.status,
    302,
    "Application callback rejected real OIDC grant",
  );
  const sessionResponse = await app.request(`${config.baseUrl}/api/session`);
  assert.equal(sessionResponse.status, 200);
  const session = (await sessionResponse.json()) as SessionView;
  assert.equal(session.user.id, subject);
  assert.ok(session.csrfToken);
  assert.ok(session.expiresAt > Date.now());
  return {
    session,
    async request(path: string, init: RequestInit = {}) {
      const headers = new Headers(init.headers);
      headers.set("Origin", config.baseUrl);
      headers.set("Sec-Fetch-Site", "same-origin");
      headers.set("X-CSRF-Token", session.csrfToken);
      if (init.body) headers.set("Content-Type", "application/json");
      return app.request(new URL(path, config.baseUrl), { ...init, headers });
    },
  };
}
