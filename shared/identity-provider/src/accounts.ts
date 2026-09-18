import type { Account, AccountClaims, FindAccount } from "oidc-provider";

export const tutorialAccounts = [
  { id: "alex", name: "Alex Morgan", email: "alex@tutorial.test" },
  { id: "mina", name: "Mina Okafor", email: "mina@tutorial.test" },
  { id: "sam", name: "Sam Rivera", email: "sam@tutorial.test" },
  { id: "ada", name: "Ada Mensah", email: "ada@tutorial.test" },
  { id: "leo", name: "Leo Martin", email: "leo@tutorial.test" },
  { id: "mallory", name: "Mallory Silva", email: "mallory@tutorial.test" },
  { id: "dana", name: "Dana", email: "dana@tutorial.test" },
  { id: "amir", name: "Amir", email: "amir@tutorial.test" },
  { id: "eve", name: "Eve", email: "eve@tutorial.test" },
  { id: "riley", name: "Riley", email: "riley@tutorial.test" },
  { id: "ana", name: "Ana", email: "ana@tutorial.test" },
  { id: "omar", name: "Omar", email: "omar@tutorial.test" },
  { id: "amina", name: "Amina", email: "amina@tutorial.test" },
  { id: "leah", name: "Leah", email: "leah@tutorial.test" },
  { id: "theo", name: "Theo", email: "theo@tutorial.test" },
  { id: "zoya", name: "Zoya", email: "zoya@tutorial.test" },
  { id: "sofia", name: "Sofia", email: "sofia@tutorial.test" },
  { id: "marco", name: "Marco", email: "marco@tutorial.test" },
  { id: "tess", name: "Tess", email: "tess@tutorial.test" },
  { id: "jordan", name: "Jordan", email: "jordan@tutorial.test" },
  { id: "priya", name: "Priya", email: "priya@tutorial.test" },
  { id: "lee", name: "Lee", email: "lee@tutorial.test" },
  { id: "mei", name: "Mei", email: "mei@tutorial.test" },
  { id: "kwame", name: "Kwame", email: "kwame@tutorial.test" },
  { id: "yuki", name: "Yuki", email: "yuki@tutorial.test" },
  { id: "nora", name: "Nora Mensah", email: "nora@tutorial.test" },
  { id: "pavel", name: "Pavel Novak", email: "pavel@tutorial.test" },
  { id: "elena", name: "Elena Rossi", email: "elena@tutorial.test" },
  { id: "malik", name: "Malik Johnson", email: "malik@tutorial.test" },
  { id: "rowan", name: "Rowan Lee", email: "rowan@tutorial.test" },
  { id: "maya", name: "Maya", email: "maya@tutorial.test" },
  { id: "noah", name: "Noah", email: "noah@tutorial.test" },
  { id: "lena", name: "Lena", email: "lena@tutorial.test" },
  { id: "imani", name: "Imani", email: "imani@tutorial.test" },
  { id: "lin", name: "Lin", email: "lin@tutorial.test" },
  { id: "nia", name: "Nia", email: "nia@tutorial.test" },
  { id: "ben", name: "Ben", email: "ben@tutorial.test" },
  { id: "cora", name: "Cora", email: "cora@tutorial.test" },
  { id: "talia", name: "Talia", email: "talia@tutorial.test" },
  { id: "grace", name: "Grace", email: "grace@tutorial.test" },
  { id: "dina", name: "Dina", email: "dina@tutorial.test" },
  { id: "amara", name: "Amara", email: "amara@tutorial.test" },
  { id: "benoit", name: "Benoit", email: "benoit@tutorial.test" },
  { id: "chloe", name: "Chloe", email: "chloe@tutorial.test" },
  { id: "bao", name: "Bao", email: "bao@tutorial.test" },
  { id: "sela", name: "Sela", email: "sela@tutorial.test" },
  { id: "diego", name: "Diego", email: "diego@tutorial.test" },
] as const;

export type TutorialAccount = (typeof tutorialAccounts)[number];

export function findTutorialAccount(id: unknown): TutorialAccount | undefined {
  if (typeof id !== "string") return undefined;
  return tutorialAccounts.find((account) => account.id === id);
}

export const findAccount: FindAccount = async (
  _ctx,
  id,
): Promise<Account | undefined> => {
  const account = findTutorialAccount(id);
  if (!account) return undefined;

  return {
    accountId: account.id,
    async claims(): Promise<AccountClaims> {
      return {
        sub: account.id,
        name: account.name,
        preferred_username: account.id,
        email: account.email,
        email_verified: true,
      };
    },
  };
};
