import type Sqlite from "better-sqlite3";
import { accessPackages, accounts } from "../../shared/contracts.ts";
import type { MedicalData } from "./models.ts";

const staff = [
  [
    "cora",
    "Cora Mensah",
    "Support",
    "Support specialist",
    "ben",
    "Cotonou",
    "Permanent",
    "Active",
  ],
  [
    "amina",
    "Amina Diallo",
    "Support",
    "Customer success lead",
    "ben",
    "Dakar",
    "Permanent",
    "Active",
  ],
  [
    "jonas",
    "Jonas Weber",
    "Support",
    "Service coordinator",
    "ben",
    "Berlin",
    "Fixed term",
    "On leave",
  ],
  [
    "other-team",
    "Dee Okafor",
    "Operations",
    "Operations specialist",
    "other-manager",
    "Lagos",
    "Permanent",
    "Active",
  ],
  [
    "mei",
    "Mei Chen",
    "Operations",
    "Workplace coordinator",
    "other-manager",
    "Singapore",
    "Permanent",
    "Active",
  ],
  [
    "rafael",
    "Rafael Costa",
    "Finance",
    "Financial analyst",
    "other-manager",
    "Lisbon",
    "Permanent",
    "Active",
  ],
  [
    "ines",
    "Ines Laurent",
    "People",
    "People operations partner",
    "other-manager",
    "Paris",
    "Permanent",
    "On leave",
  ],
  [
    "samira",
    "Samira Haddad",
    "Engineering",
    "Platform engineer",
    "other-manager",
    "Tunis",
    "Permanent",
    "Active",
  ],
  [
    "foreign",
    "Eli Rivera",
    "Support",
    "Support specialist",
    "foreign-manager",
    "Madrid",
    "Permanent",
    "Active",
  ],
] as const;

function medicalFixture(index: number): MedicalData {
  return {
    dateOfBirth:
      ["1992-04-16", "1988-07-23", "1995-11-04"][index % 3] ?? "1992-04-16",
    bloodGroup: index % 2 ? "A+" : "O+",
    allergies:
      index % 2 ? ["No known allergies recorded"] : ["Seasonal pollen"],
    conditions:
      index % 2
        ? []
        : [
            {
              date: "2025-03-11",
              title: "Seasonal allergic rhinitis",
              details:
                "Recorded history; reviewed at the annual health assessment.",
            },
          ],
    medications: [
      {
        date: "2026-03-11",
        title: "Current medication review",
        details: "No current regular medication recorded.",
      },
    ],
    consultations: [
      {
        date: "2026-09-09",
        title: "Annual occupational-health consultation",
        details:
          "Routine review of work demands and reported symptoms. Follow-up recorded for the next annual assessment.",
      },
    ],
    testResults: [
      {
        date: "2026-09-09",
        title: "Vision screening",
        details: "Right eye 6/6; left eye 6/6. Synthetic screening result.",
      },
    ],
    vaccinations: [
      {
        date: "2025-10-14",
        title: "Influenza vaccination",
        details: "Annual vaccination recorded by the clinic.",
      },
    ],
    assessments: [
      {
        date: "2026-09-09",
        title: "Workplace assessment",
        details:
          "Fit for current duties. Adjustable workstation recommended. Review: 2027-09-09.",
      },
    ],
  };
}

export function seed(sql: Sqlite.Database) {
  const insertPrincipal = sql.prepare(
    "INSERT INTO principals VALUES (@id,@name,@tenantId,@role,@administrator,@reviewer,@clinician,1)",
  );
  for (const account of accounts) {
    insertPrincipal.run({
      ...account,
      tenantId: "tenant-a",
      administrator: Number(account.id === "lin"),
      reviewer: Number(account.id === "lin" || account.id === "nia"),
      clinician: Number(account.id === "aya"),
    });
  }
  for (const [id, name, tenantId] of [
    ["other-manager", "Morgan", "tenant-a"],
    ["foreign-manager", "Alex", "tenant-b"],
  ])
    insertPrincipal.run({
      id,
      name,
      tenantId,
      role: "Manager",
      administrator: 0,
      reviewer: 0,
      clinician: 0,
    });
  const employee = sql.prepare(`INSERT INTO employees VALUES
    (@id,@employeeNumber,@name,@preferredName,@tenantId,@managerId,@team,@jobTitle,@office,@employmentType,@employmentStatus,@startDate,
     @workEmail,@workPhone,@personalEmail,@mobilePhone,@address,@emergencyName,@emergencyRelationship,@emergencyPhone,1)`);
  const medical = sql.prepare("INSERT INTO medical_records VALUES (?,?,1)");
  staff.forEach(
    (
      [
        id,
        name,
        team,
        jobTitle,
        managerId,
        office,
        employmentType,
        employmentStatus,
      ],
      index,
    ) => {
      employee.run({
        id,
        employeeNumber: `EMP-${String(1001 + index)}`,
        name,
        preferredName: name.split(" ")[0],
        tenantId: id === "foreign" ? "tenant-b" : "tenant-a",
        managerId,
        team,
        jobTitle,
        office,
        employmentType,
        employmentStatus,
        startDate: "2023-06-05",
        workEmail: `${id}@example.test`,
        workPhone: `+1 202 555 ${String(101 + index).padStart(4, "0")}`,
        personalEmail: `${id}.personal@example.test`,
        mobilePhone: `+1 202 555 ${String(201 + index).padStart(4, "0")}`,
        address: `${12 + index} Sample Avenue, ${office}`,
        emergencyName: `Taylor ${name.split(" ").at(-1)}`,
        emergencyRelationship: "Family member",
        emergencyPhone: `+1 202 555 ${String(301 + index).padStart(4, "0")}`,
      });
      medical.run(id, JSON.stringify(medicalFixture(index)));
    },
  );
  const pkg = sql.prepare(
    "INSERT INTO packages VALUES (@id,@scope,@fieldGroup)",
  );
  for (const value of accessPackages) pkg.run(value);
}
