import { afterEach, expect, test } from "vitest";
import { SchoolDatabase } from "../src/server/data/database.ts";
import { createAuthorization } from "../src/server/school/authorization.ts";
import type { Authorize } from "../src/server/school/service.ts";
import { Students } from "../src/server/school/students.ts";

const stores: SchoolDatabase[] = [];
function fixture(
  authorize: Authorize = async () => "allow",
  beforeEffect = () => {},
) {
  const db = new SchoolDatabase(":memory:", "http://localhost:18013");
  stores.push(db);
  return { db, students: new Students(db, authorize, beforeEffect) };
}
afterEach(() => {
  for (const db of stores.splice(0)) db.close();
});
test("seeds eight same-school profiles and 32 assessment records without exposing grade values in directory responses", async () => {
  const { students, db } = fixture();
  const rows = await students.list("talia", "list");
  expect(rows).toHaveLength(8);
  expect(rows.map((r) => r.id)).not.toContain("foreign");
  expect(db.candidateIds("school-a")).toHaveLength(32);
  const sam = await students.read("sam", "sam", "profile");
  expect(sam).toMatchObject({
    studentNumber: "STU-1001",
    className: "10A",
    preferredName: "Sam",
  });
  expect(sam.enrollments).toHaveLength(2);
  expect(Object.keys(sam.enrollments[0] ?? {}).sort()).toEqual([
    "course",
    "courseId",
    "state",
  ]);
  expect(JSON.stringify(sam)).not.toMatch(
    /internalNote|feedback|score|schoolId|issuer/,
  );
  expect(Object.keys(rows[0] ?? {}).sort()).toEqual(
    [
      "id",
      "name",
      "studentNumber",
      "className",
      "yearGroup",
      "enrollmentStatus",
    ].sort(),
  );
});
test("all six identities can use baseline directory/profile operations", async () => {
  const { students } = fixture();
  for (const actor of ["talia", "rene", "sam", "ava", "grace", "imani"]) {
    expect(await students.list(actor, actor)).toHaveLength(8);
    expect((await students.read(actor, "sam", actor)).id).toBe("sam");
  }
});
test("directory candidates and direct profiles share the same fail-closed seam", async () => {
  const deny = fixture(async () => "deny");
  expect(await deny.students.list("talia", "deny")).toEqual([]);
  await expect(
    deny.students.read("talia", "sam", "deny"),
  ).rejects.toMatchObject({ status: 404 });
  const outage = fixture(async () => "unavailable");
  await expect(outage.students.list("sam", "outage")).rejects.toMatchObject({
    status: 503,
  });
  await expect(
    outage.students.read("sam", "sam", "outage"),
  ).rejects.toMatchObject({ status: 503 });
  const own = fixture();
  await expect(
    own.students.read("talia", "foreign", "foreign"),
  ).rejects.toMatchObject({ status: 404 });
});
test("relationship changes reauthorize the profile before projection", async () => {
  let calls = 0;
  const { students, db } = fixture(async () => {
    if (++calls === 1) db.changeFixture("withdraw-enrollment");
    return "allow";
  });
  expect(
    (await students.read("talia", "sam", "race")).enrollments.find(
      (e) => e.courseId === "algebra",
    )?.state,
  ).toBe("withdrawn");
  expect(calls).toBe(2);
});
test("the final session check stops even an empty directory disclosure", async () => {
  const { students } = fixture(
    async () => "deny",
    () => {
      throw Object.assign(new Error("expired"), { status: 401 });
    },
  );
  await expect(students.list("talia", "expired")).rejects.toMatchObject({
    status: 401,
  });
});
test("profile traces use one inline event with no protected grade content", async () => {
  const logs: string[] = [];
  const { students } = fixture(createAuthorization((line) => logs.push(line)));
  await students.read("sam", "sam", "req-profile");
  expect(logs).toEqual([
    "P13 server | FAKE ALLOW | student.profile.view | sam -> sam | req-profile",
  ]);
});
