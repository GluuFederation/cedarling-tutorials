import { describe, expect, it } from "vitest";
import {
  findAccount,
  findTutorialAccount,
  tutorialAccounts,
} from "../src/accounts.js";

describe("tutorial accounts", () => {
  it("exposes the approved synthetic identities", () => {
    expect(tutorialAccounts.map(({ id }) => id)).toEqual([
      "alex",
      "mina",
      "sam",
      "ada",
      "leo",
      "mallory",
      "dana",
      "amir",
      "eve",
      "riley",
      "ana",
      "omar",
      "amina",
      "leah",
      "theo",
      "zoya",
      "sofia",
      "marco",
      "tess",
      "jordan",
      "priya",
      "lee",
      "mei",
      "kwame",
      "yuki",
      "nora",
      "pavel",
      "elena",
      "malik",
      "rowan",
      "maya",
      "noah",
      "lena",
      "imani",
      "lin",
      "nia",
      "ben",
      "cora",
      "talia",
      "grace",
      "dina",
      "amara",
      "benoit",
      "chloe",
      "bao",
      "sela",
      "diego",
    ]);
    expect(findTutorialAccount("riley")?.name).toBe("Riley");
  });

  it("returns stable OIDC subjects without application authorization claims", async () => {
    const account = await findAccount({} as never, "mina");
    await expect(
      account?.claims("id_token", "openid", {} as never, [] as never),
    ).resolves.toEqual({
      sub: "mina",
      name: "Mina Okafor",
      preferred_username: "mina",
      email: "mina@tutorial.test",
      email_verified: true,
    });
  });

  it("rejects identities outside the predefined tutorial accounts", async () => {
    await expect(findAccount({} as never, "unknown")).resolves.toBeUndefined();
  });

  it.each(["dina", "amara", "benoit", "chloe"] as const)(
    "does not manufacture application authority for %s",
    async (id) => {
      const account = await findAccount({} as never, id);
      const claims = await account?.claims(
        "id_token",
        "openid profile",
        {} as never,
        [] as never,
      );
      expect(claims).toMatchObject({ sub: id });
      expect(claims).not.toHaveProperty("tutorial_assurance");
      expect(claims).not.toHaveProperty("role");
      expect(claims).not.toHaveProperty("consent");
      expect(claims).not.toHaveProperty("incident");
    },
  );
});
