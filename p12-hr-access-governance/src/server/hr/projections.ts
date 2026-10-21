import type {
  Contact,
  Medical,
  MedicalEntry,
  Profile,
} from "../../shared/contracts.ts";
import {
  type Database,
  type Employee,
  effectiveStatus,
  type GrantRow,
} from "../data/database.ts";
import type { MedicalData } from "../data/models.ts";
import { missing } from "../http/errors.ts";
import type { Facts, GrantFacts } from "./authorization.ts";

export function employeeFacts(employee: Employee) {
  const {
    id,
    employeeNumber,
    name,
    preferredName,
    tenantId,
    managerId,
    team,
    jobTitle,
    office,
    employmentType,
    employmentStatus,
    startDate,
    version,
  } = employee;
  return {
    id,
    employeeNumber,
    name,
    preferredName,
    tenantId,
    managerId,
    team,
    jobTitle,
    office,
    employmentType,
    employmentStatus,
    startDate,
    version,
  };
}
export function grantFacts(grant: GrantRow): GrantFacts {
  const { reason: _, reviewNote: __, ...facts } = grant;
  return { ...facts, status: effectiveStatus(grant, Date.now()) };
}
export function profileProjection({ employee, manager }: Facts): Profile {
  if (!employee || !manager) throw missing();
  const { tenantId: _, ...fields } = employee;
  return { ...fields, managerName: manager.name };
}
export function contactProjection(db: Database, id: string): Contact {
  const employee = db.employee(id);
  if (!employee) throw missing();
  const {
    workEmail,
    workPhone,
    personalEmail,
    mobilePhone,
    address,
    emergencyName,
    emergencyRelationship,
    emergencyPhone,
    version,
  } = employee;
  return {
    id,
    workEmail,
    workPhone,
    personalEmail,
    mobilePhone,
    address,
    emergencyName,
    emergencyRelationship,
    emergencyPhone,
    version,
  };
}
function entries(rows: readonly MedicalEntry[]): readonly MedicalEntry[] {
  return rows.map(({ date, title, details }) => ({ date, title, details }));
}
export function medicalProjection(db: Database, id: string): Medical {
  const row = db.medical(id);
  if (!row) throw missing();
  const value = JSON.parse(row.value) as MedicalData;
  return {
    id,
    dateOfBirth: value.dateOfBirth,
    bloodGroup: value.bloodGroup,
    allergies: value.allergies.map((entry) => String(entry)),
    conditions: entries(value.conditions),
    medications: entries(value.medications),
    consultations: entries(value.consultations),
    testResults: entries(value.testResults),
    vaccinations: entries(value.vaccinations),
    assessments: entries(value.assessments),
    version: row.version,
  };
}
