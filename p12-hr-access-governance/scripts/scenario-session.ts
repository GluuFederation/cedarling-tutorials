import type { Config } from "../src/server/config.ts";
import type { Result, SessionView } from "../src/shared/contracts.ts";

class CookieJar {
  private readonly cookies = new Map<string, string>();

  async request(url: URL | string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.cookies.size) {
      headers.set(
        "Cookie",
        [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; "),
      );
    }
    const response = await fetch(url, { ...init, headers, redirect: "manual" });
    for (const header of response.headers.getSetCookie()) {
      const [pair = "", ...attributes] = header.split(";");
      const separator = pair.indexOf("=");
      if (separator < 1) continue;
      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();
      if (
        !value ||
        attributes.some((item) => item.trim().toLowerCase() === "max-age=0")
      ) {
        this.cookies.delete(name);
      } else {
        this.cookies.set(name, value);
      }
    }
    return response;
  }
}

function redirect(response: Response, base: string): URL {
  if (![302, 303, 307, 308].includes(response.status)) {
    throw new Error(`Expected redirect, received ${response.status}`);
  }
  const location = response.headers.get("location");
  if (!location) throw new Error("Redirect location is missing");
  return new URL(location, base);
}

function sameOrigin(response: Response, base: string): URL {
  const target = redirect(response, base);
  if (target.origin !== new URL(base).origin) {
    throw new Error("OIDC redirect changed origin");
  }
  return target;
}

function formAction(html: string, base: string): URL {
  const action = html.match(/<form[^>]*action="([^"]+)"/u)?.[1];
  if (!action) throw new Error("OIDC interaction form action is missing");
  const target = new URL(action.replaceAll("&amp;", "&"), base);
  if (target.origin !== new URL(base).origin) {
    throw new Error("OIDC interaction form changed origin");
  }
  return target;
}

async function form(
  jar: CookieJar,
  target: URL,
  values: Record<string, string>,
): Promise<Response> {
  return jar.request(target, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(values),
  });
}

type ScenarioSession = Readonly<{
  request(path: string, init?: RequestInit): Promise<Response>;
}>;

export async function openScenarioSession(
  config: Config,
  login: "lin" | "nia" | "ben",
): Promise<ScenarioSession> {
  const app = new CookieJar();
  const issuer = new CookieJar();
  const start = await app.request(
    `${config.baseUrl}/auth/login?login_hint=${login}`,
  );
  const authorizationUrl = redirect(start, config.baseUrl);
  if (authorizationUrl.origin !== new URL(config.issuer).origin) {
    throw new Error("Authorization endpoint changed issuer");
  }
  const interactionStart = await issuer.request(authorizationUrl);
  const loginPage = await issuer.request(
    sameOrigin(interactionStart, config.issuer),
  );
  if (loginPage.status !== 200) throw new Error("OIDC login page failed");
  const loginSubmission = await form(
    issuer,
    formAction(await loginPage.text(), config.issuer),
    { login, password: "tutorial", prompt: "login" },
  );
  const loginResume = await issuer.request(
    sameOrigin(loginSubmission, config.issuer),
  );
  const consentPage = await issuer.request(
    sameOrigin(loginResume, config.issuer),
  );
  if (consentPage.status !== 200) throw new Error("OIDC consent page failed");
  const consentSubmission = await form(
    issuer,
    formAction(await consentPage.text(), config.issuer),
    { prompt: "consent" },
  );
  const consentResume = await issuer.request(
    sameOrigin(consentSubmission, config.issuer),
  );
  const callbackUrl = redirect(consentResume, config.issuer);
  if (callbackUrl.origin !== new URL(config.baseUrl).origin) {
    throw new Error("OIDC callback changed application origin");
  }
  const callback = await app.request(callbackUrl);
  if (
    callback.status !== 302 ||
    redirect(callback, config.baseUrl).pathname !== "/"
  ) {
    throw new Error("Application rejected the OIDC callback");
  }
  const sessionResponse = await app.request(`${config.baseUrl}/api/session`);
  if (sessionResponse.status !== 200) {
    throw new Error("OIDC callback did not create an application session");
  }
  const { data: view } = (await sessionResponse.json()) as Result<SessionView>;
  if (view?.user?.id !== login || !view.csrfToken) {
    throw new Error("OIDC session mapped the wrong P12 principal");
  }
  return {
    async request(path, init = {}) {
      const headers = new Headers(init.headers);
      if (!headers.has("Origin")) headers.set("Origin", config.baseUrl);
      if (!headers.has("Sec-Fetch-Site")) {
        headers.set("Sec-Fetch-Site", "same-origin");
      }
      if (!headers.has("X-CSRF-Token")) {
        headers.set("X-CSRF-Token", view.csrfToken ?? "");
      }
      if (init.body && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }
      return app.request(new URL(path, config.baseUrl), { ...init, headers });
    },
  };
}
