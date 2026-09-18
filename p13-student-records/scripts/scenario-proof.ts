import assert from "node:assert/strict";
import type { AppConfig } from "../src/server/config.ts";
import { SchoolDatabase } from "../src/server/database.ts";
import { openSession } from "./scenario-session.ts";

function record(value: unknown): Record<string, unknown> {
  assert.ok(
    typeof value === "object" && value !== null && !Array.isArray(value),
    "Expected a response object",
  );
  return value as Record<string, unknown>;
}
async function grade(response: Response): Promise<Record<string, unknown>> {
  assert.equal(response.status, 200);
  return record(record(await response.json()).grade);
}

export async function exercise(config: AppConfig, databaseFile: string) {
  const talia = await openSession(config, "talia");
  const sam = await openSession(config, "sam");
  const grace = await openSession(config, "grace");
  console.info(
    "✓ Talia, Sam and Grace completed real PKCE, consent, signed ID-token and session flows",
  );
  for (const client of [sam, grace]) {
    const response = await client.request("/api/grades/teacher/grade-sam-1");
    assert.equal(response.status, 200);
    assert.equal(
      (await grade(response)).internalNote,
      "Check reasoning privately.",
    );
  }
  console.info(
    "✓ gap: student and guardian directly receive the fixed teacher projection",
  );
  const foreign = await talia.request("/api/grades/teacher/grade-foreign-1");
  assert.equal(foreign.status, 404);
  const saved = await grade(
    await talia.request("/api/grades/grade-sam-2", {
      method: "PATCH",
      body: JSON.stringify({
        expectedVersion: 1,
        score: 73,
        feedback: "A complete saved draft.",
        internalNote: "Synthetic private note.",
      }),
    }),
  );
  assert.equal(saved.version, 2);
  assert.equal(saved.score, 73);
  const otherCourse = await talia.request("/api/grades/grade-ava-1/publish", {
    method: "POST",
    body: JSON.stringify({ expectedVersion: 1 }),
  });
  assert.equal(otherCourse.status, 200);
  console.info(
    "✓ gap: Talia publishes another teacher's complete grade; foreign-school containment holds",
  );
  const publish = await talia.request("/api/grades/grade-sam-1/publish", {
    method: "POST",
    body: JSON.stringify({ expectedVersion: 1 }),
  });
  assert.equal(publish.status, 200);
  assert.equal(record(await publish.json()).version, 2);
  const repeated = await talia.request("/api/grades/grade-sam-1/publish", {
    method: "POST",
    body: JSON.stringify({ expectedVersion: 1 }),
  });
  assert.equal(repeated.status, 409);
  const student = await grade(
    await sam.request("/api/grades/student/grade-sam-1"),
  );
  const guardian = await grade(
    await grace.request("/api/grades/guardian/grade-sam-1"),
  );
  assert.deepEqual(
    Object.keys(student).sort(),
    [
      "course",
      "assessment",
      "score",
      "letterGrade",
      "feedback",
      "publishedAt",
      "version",
    ].sort(),
  );
  assert.deepEqual(
    Object.keys(guardian).sort(),
    ["course", "assessment", "letterGrade", "publishedAt", "version"].sort(),
  );
  const database = new SchoolDatabase(databaseFile, config.issuer);
  try {
    database.changeFixture("withdraw-enrollment");
    database.changeFixture("revoke-guardian");
  } finally {
    database.close();
  }
  assert.equal(
    (await talia.request("/api/grades/teacher/grade-sam-2")).status,
    200,
  );
  assert.equal(
    (await grace.request("/api/grades/guardian/grade-sam-1")).status,
    200,
  );
  assert.equal(
    (await sam.request("/api/grades/student/grade-sam-1")).status,
    200,
  );
  console.info(
    "✓ gap: withdrawn enrollment and revoked guardian links are observed but not enforced",
  );
  console.info(
    "✓ immutable publication, exact audience projections, persisted fixture changes",
  );
  return talia;
}

export async function verifyPersistence(
  client: Awaited<ReturnType<typeof openSession>>,
) {
  const response = await client.request("/api/grades/teacher/grade-sam-1");
  assert.equal(
    response.status,
    200,
    "Persisted session remains usable after application restart",
  );
  const view = await grade(response);
  assert.equal(view.state, "published");
  assert.equal(view.version, 2);
  assert.equal(view.internalNote, "Check reasoning privately.");
  const databaseState = await client.request("/api/grades/grade-sam-1", {
    method: "PATCH",
    body: JSON.stringify({
      expectedVersion: 2,
      score: 0,
      feedback: "Attempt",
      internalNote: "",
    }),
  });
  assert.equal(databaseState.status, 409);
  console.info(
    "✓ application restart preserves session, publication and read-only teacher note",
  );
}
