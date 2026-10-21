import assert from "node:assert/strict";

class CookieJar {
  private readonly cookies = new Map<string, string>();

  async request(url: string | URL, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("connection", "close");
    headers.set(
      "cookie",
      [...this.cookies].map(([key, value]) => `${key}=${value}`).join("; "),
    );
    const response = await fetch(url, {
      ...init,
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";")[0] ?? "";
      const index = pair.indexOf("=");
      if (index > 0)
        this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
    return response;
  }
}

function redirect(response: Response, origin: string): URL {
  assert.ok(
    [302, 303, 307, 308].includes(response.status),
    `Expected redirect, received ${response.status}`,
  );
  const location = response.headers.get("location");
  assert.ok(location);
  const next = new URL(location, origin);
  assert.equal(next.origin, origin);
  return next;
}

function form(html: string, origin: string): URL {
  const action = html.match(/<form[^>]*action="([^"]+)"/u)?.[1];
  assert.ok(action, "Expected the tutorial IdP form");
  const next = new URL(action.replaceAll("&amp;", "&"), origin);
  assert.equal(next.origin, origin);
  return next;
}

export async function openSession(
  config: { baseUrl: string; issuer: string },
  subject: string,
) {
  const app = new CookieJar();
  const idp = new CookieJar();
  const start = await app.request(
    `${config.baseUrl}/auth/login?login_hint=${subject}`,
  );
  const auth = await idp.request(redirect(start, config.issuer));
  const loginPage = await idp.request(redirect(auth, config.issuer));
  assert.equal(loginPage.status, 200);
  const login = await idp.request(form(await loginPage.text(), config.issuer), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      login: subject,
      password: "cedarling-is-awesome",
      prompt: "login",
    }),
  });
  const resumed = await idp.request(redirect(login, config.issuer));
  const consentPage = await idp.request(redirect(resumed, config.issuer));
  assert.equal(consentPage.status, 200);
  const consent = await idp.request(
    form(await consentPage.text(), config.issuer),
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ prompt: "consent" }),
    },
  );
  const confirmed = await idp.request(redirect(consent, config.issuer));
  const callback = await app.request(redirect(confirmed, config.baseUrl));
  assert.equal(
    callback.status,
    302,
    "Real OIDC callback must establish a session",
  );
  const session = (await (
    await app.request(`${config.baseUrl}/api/session`)
  ).json()) as { user: { id: string; name: string }; csrfToken: string };
  assert.equal(session.user.id, subject);
  assert.ok(session.csrfToken);
  return {
    async request(path: string, init: RequestInit = {}) {
      const headers = new Headers(init.headers);
      headers.set("origin", config.baseUrl);
      headers.set("sec-fetch-site", "same-origin");
      headers.set("x-csrf-token", session.csrfToken);
      if (init.body) headers.set("content-type", "application/json");
      return app.request(new URL(path, config.baseUrl), { ...init, headers });
    },
  };
}
