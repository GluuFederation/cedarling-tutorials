import { afterEach, expect, test } from "vitest";
import { createAuthorization } from "../src/server/authorization.ts";
import { SchoolDatabase } from "../src/server/database.ts";
import { type Authorize, School } from "../src/server/school.ts";

const databases: SchoolDatabase[] = [];
function fixture(authorize: Authorize = async () => "allow") {
  const database = new SchoolDatabase(":memory:", "http://idp.localhost:4000");
  databases.push(database);
  return { school: new School(database, authorize), database };
}
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

test("synthetic authorization traces never contain protected grade fields", async () => {
  const lines: string[] = [];
  const { school } = fixture(createAuthorization((line) => lines.push(line)));
  await school.read("talia", "grade.teacher.view", "grade-sam-1", "req-safe");
  expect(lines).toEqual([
    "P13 server | FAKE ALLOW | grade.teacher.view | talia -> Grade::grade-sam-1",
  ]);
  expect(lines.join("\n")).not.toMatch(
    /internalNote|feedback|score|Clear working|Check reasoning/,
  );
});

test("each read operation releases only its own fixed projection, including under fake allow", async () => {
  const { school } = fixture();
  const teacher = await school.read(
    "talia",
    "grade.teacher.view",
    "grade-sam-1",
  );
  expect(teacher.grade).toMatchObject({
    studentName: "Sam Rivera",
    state: "draft",
    internalNote: "Check reasoning privately.",
    score: 85,
  });
  const student = await school.read(
    "sam",
    "grade.published.view",
    "grade-sam-1",
  );
  expect(student.grade).toEqual({
    course: "Algebra",
    assessment: "Quiz 1",
    score: 85,
    letterGrade: "B",
    feedback: "Clear working.",
    publishedAt: null,
    version: 1,
  });
  const guardian = await school.read(
    "grace",
    "guardian.grade.view",
    "grade-sam-1",
  );
  expect(guardian.grade).toEqual({
    course: "Algebra",
    assessment: "Quiz 1",
    letterGrade: "B",
    publishedAt: null,
    version: 1,
  });
  expect(await school.read("sam", "grade.teacher.view", "grade-sam-1")).toEqual(
    teacher,
  );
});

test("native school containment and grade completeness hold under fake allow", async () => {
  const { school } = fixture();
  await expect(
    school.read("talia", "grade.teacher.view", "grade-foreign-1"),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    school.read("talia", "grade.teacher.view", "absent"),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    school.publish("talia", "grade-sam-2", 1, "incomplete"),
  ).rejects.toMatchObject({ status: 422 });
  await expect(
    school.write(
      "talia",
      "grade-sam-2",
      { expectedVersion: 1, score: 101, feedback: "", internalNote: "" },
      "invalid",
    ),
  ).rejects.toMatchObject({ status: 400 });
  expect(
    await school.read("talia", "grade.teacher.view", "grade-sam-2"),
  ).toMatchObject({ grade: { state: "draft", version: 1 } });
});

test.each([
  { score: 0, feedback: "Keep practicing.", complete: true },
  { score: 100, feedback: "Excellent.", complete: true },
  { score: null, feedback: "Awaiting score.", complete: false },
  { score: 85, feedback: " \t\n", complete: false },
])("publication and authorization agree on completeness: %j", async (input) => {
  const facts: boolean[] = [];
  const { school, database } = fixture(async ({ facts: snapshot }) => {
    facts.push(snapshot.grade.complete);
    return "allow";
  });
  await school.write(
    "talia",
    "grade-sam-2",
    {
      expectedVersion: 1,
      score: input.score,
      feedback: input.feedback,
      internalNote: "",
    },
    "save",
  );
  await school.read("talia", "grade.teacher.view", "grade-sam-2");
  expect(facts.at(-1)).toBe(input.complete);
  const publication = school.publish("talia", "grade-sam-2", 2, "publish");
  if (input.complete) {
    await expect(publication).resolves.toMatchObject({
      state: "published",
      version: 3,
    });
  } else {
    await expect(publication).rejects.toMatchObject({ status: 422 });
    expect(database.snapshot("talia", "grade-sam-2")?.grade).toMatchObject({
      state: "draft",
      version: 2,
    });
  }
});

test.each(["deny", "unavailable"] as const)(
  "gateway %s prevents projection and publication",
  async (decision) => {
    const { school, database } = fixture(async () => decision);
    const status = decision === "deny" ? 404 : 503;
    await expect(
      school.read("talia", "grade.teacher.view", "grade-sam-1"),
    ).rejects.toMatchObject({ status });
    await expect(
      school.publish("talia", "grade-sam-1", 1, "blocked"),
    ).rejects.toMatchObject({ status });
    expect(database.snapshot("talia", "grade-sam-1")?.grade).toMatchObject({
      state: "draft",
      version: 1,
      publishedAt: null,
    });
  },
);

test("a concurrent withdrawal requires a fresh decision and cannot publish on a stale allow", async () => {
  const seen: number[] = [];
  const { school, database } = fixture(async (request) => {
    seen.push(request.facts.enrollment?.version ?? 0);
    if (seen.length === 1) database.changeFixture("withdraw-enrollment");
    return request.facts.enrollment?.state === "active" ? "allow" : "deny";
  });
  await expect(
    school.publish("talia", "grade-sam-1", 1, "race"),
  ).rejects.toMatchObject({ status: 404 });
  expect(seen).toEqual([1, 2]);
  expect(database.snapshot("talia", "grade-sam-1")?.grade).toMatchObject({
    state: "draft",
    version: 1,
  });
});

test("assignment churn exhausts one bounded retry without a mutation", async () => {
  let calls = 0;
  const { school, database } = fixture(async () => {
    calls += 1;
    database.sql.exec(
      "UPDATE assignments SET version=version+1 WHERE actor_id='talia'",
    );
    return "allow";
  });
  await expect(
    school.publish("talia", "grade-sam-1", 1, "churn"),
  ).rejects.toMatchObject({ status: 409 });
  expect(calls).toBe(2);
  expect(database.snapshot("talia", "grade-sam-1")?.grade).toMatchObject({
    version: 1,
    state: "draft",
  });
});

test("a later list decision cannot release an earlier row using stale enrollment facts", async () => {
  let withdrawn = false;
  const versions: number[] = [];
  const { school, database } = fixture(async ({ facts }) => {
    if (facts.grade.id === "grade-sam-1")
      versions.push(facts.enrollment?.version ?? 0);
    if (facts.grade.id === "grade-ava-1" && !withdrawn) {
      withdrawn = true;
      database.changeFixture("withdraw-enrollment");
    }
    return facts.enrollment?.state === "active" ? "allow" : "deny";
  });
  const result = await school.list("talia", "grade.teacher.view", "list-race");
  expect(result.map((view) => view.id)).toEqual(["grade-ava-1"]);
  expect(versions).toEqual([1, 2]);
});

test("continuous list fact changes exhaust one retry without returning any rows", async () => {
  let calls = 0;
  const { school, database } = fixture(async ({ facts }) => {
    calls += 1;
    if (facts.grade.id === "grade-ava-1")
      database.changeFixture("withdraw-enrollment");
    return "allow";
  });
  await expect(
    school.list("talia", "grade.teacher.view", "list-churn"),
  ).rejects.toMatchObject({ status: 409 });
  expect(calls).toBe(6);
});

test("permissive gaps remain observable without weakening native integrity", async () => {
  const { school, database } = fixture();
  expect(
    await school.read("talia", "grade.teacher.view", "grade-ava-1"),
  ).toMatchObject({ grade: { studentName: "Ava" } });
  await school.publish("talia", "grade-ava-1", 1, "unassigned");
  database.changeFixture("withdraw-enrollment");
  expect(
    await school.read("talia", "grade.teacher.view", "grade-sam-2"),
  ).toMatchObject({ grade: { state: "draft" } });
  await school.publish("talia", "grade-sam-1", 1, "synthetic");
  database.changeFixture("revoke-guardian");
  expect(
    await school.read("grace", "guardian.grade.view", "grade-sam-1"),
  ).toMatchObject({ grade: { letterGrade: "B" } });
  const evidence = database.sql
    .prepare(
      `SELECT published_by,authorized_grade_version,authorized_enrollment_version,
        version,publication_request_id,synthetic_decision,policy_release,policy_digest
      FROM grades WHERE id='grade-sam-1'`,
    )
    .get();
  expect(evidence).toEqual({
    published_by: "talia",
    authorized_grade_version: 1,
    authorized_enrollment_version: 2,
    version: 2,
    publication_request_id: "synthetic",
    synthetic_decision: 1,
    policy_release: null,
    policy_digest: null,
  });
});

test("a database failure leaves publication and its evidence unchanged", async () => {
  const { school, database } = fixture();
  database.sql.exec(
    "CREATE TRIGGER injected_failure BEFORE UPDATE ON grades BEGIN SELECT RAISE(ABORT,'test-only write failure'); END",
  );
  await expect(
    school.publish("talia", "grade-sam-1", 1, "failed"),
  ).rejects.toThrow();
  const evidence = database.sql
    .prepare(
      "SELECT state,version,published_at,publication_request_id,synthetic_decision FROM grades WHERE id='grade-sam-1'",
    )
    .get();
  expect(evidence).toEqual({
    state: "draft",
    version: 1,
    published_at: null,
    publication_request_id: null,
    synthetic_decision: null,
  });
});

test("a complete saved draft publishes once and remains readable with its private teacher note", async () => {
  const { school } = fixture();
  const saved = await school.write(
    "talia",
    "grade-sam-1",
    {
      expectedVersion: 1,
      score: 95,
      feedback: "Excellent reasoning.",
      internalNote: "Keep this private.",
    },
    "req-save",
  );
  expect(saved.grade).toMatchObject({ score: 95, version: 2 });
  const published = await school.publish(
    "talia",
    "grade-sam-1",
    2,
    "req-publish",
  );
  expect(published).toMatchObject({
    id: "grade-sam-1",
    state: "published",
    version: 3,
    requestId: "req-publish",
  });
  expect(
    await school.read("talia", "grade.teacher.view", "grade-sam-1"),
  ).toMatchObject({
    grade: {
      state: "published",
      internalNote: "Keep this private.",
      version: 3,
    },
  });
  expect(
    await school.read("grace", "guardian.grade.view", "grade-sam-1"),
  ).toMatchObject({ grade: { letterGrade: "A", version: 3 } });
  await expect(
    school.publish("talia", "grade-sam-1", 2, "repeat"),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    school.write(
      "talia",
      "grade-sam-1",
      { expectedVersion: 3, score: 0, feedback: "Overwrite", internalNote: "" },
      "rewrite",
    ),
  ).rejects.toMatchObject({ status: 409 });
});

test("relationship fixtures preserve grades and increment persisted relationship versions", async () => {
  const { school, database } = fixture();
  await school.publish("talia", "grade-sam-1", 1, "publish");
  expect(database.changeFixture("withdraw-enrollment")).toMatchObject({
    target: "sam/algebra",
    state: "withdrawn",
    version: 2,
  });
  expect(database.changeFixture("restore-enrollment")).toMatchObject({
    state: "active",
    version: 3,
  });
  expect(database.changeFixture("revoke-guardian")).toMatchObject({
    target: "grace/sam",
    state: "revoked",
    version: 2,
  });
  expect(database.changeFixture("restore-guardian")).toMatchObject({
    state: "active",
    version: 3,
  });
  expect(
    await school.read("talia", "grade.teacher.view", "grade-sam-1"),
  ).toMatchObject({ grade: { state: "published", version: 2 } });
});
