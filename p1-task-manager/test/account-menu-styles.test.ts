/** @vitest-environment jsdom */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";

afterEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

it("keeps account-menu actions legible on their white surface", () => {
  const style = document.createElement("style");
  style.textContent = readFileSync(
    resolve(import.meta.dirname, "../src/web/styles.css"),
    "utf8",
  );
  document.head.append(style);
  document.body.innerHTML = `
    <header class="brand-rail">
      <details class="account-menu" open>
        <div class="account-menu-items">
          <button type="button">Change account</button>
        </div>
      </details>
    </header>
  `;

  const action = document.querySelector("button");
  expect(action).not.toBeNull();
  expect(getComputedStyle(action!).color).toBe("var(--charcoal)");
  expect(
    getComputedStyle(document.documentElement)
      .getPropertyValue("--charcoal")
      .trim(),
  ).toBe("#262a29");
});
