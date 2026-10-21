import { useEffect, useState } from "react";
import { Link, NavLink, useFetcher } from "react-router";
import { useDisclosure } from "../hooks/use-disclosure.ts";
import { useExpiries } from "../hooks/use-expiries.ts";
import { useHydrated } from "../hooks/use-hydrated.ts";
import type { action as issueAction } from "../routes/organizations/issue-invitation.ts";
import type { action as switchAction } from "../routes/organizations/switch.ts";
import type {
  Invitation,
  InvitationCandidate,
  Membership,
  Project,
} from "../types/contracts.ts";
import { errorNotice } from "../utils/messages.ts";
import { displayTime } from "../utils/time.ts";
import {
  CheckCircle,
  ChevronDown,
  CreditCard,
  Folder,
  Inbox,
  Shield,
  Users,
} from "./icons.tsx";
import { EmptyState, Outcome } from "./shell.tsx";

export function WorkspaceSidebar({
  organizationId,
  memberships,
  selection,
  csrfToken,
  switchKeys,
}: Readonly<{
  organizationId: string | null;
  memberships: readonly Membership[];
  selection: Readonly<{ organizationId: string | null; version: number }>;
  csrfToken: string;
  switchKeys: Readonly<Record<string, string>>;
}>) {
  const switcher = useFetcher<typeof switchAction>();
  const switcherRef = useDisclosure();
  const activeMembership = memberships.find(
    (membership) => membership.organizationId === selection.organizationId,
  );

  return (
    <aside className="workspace-sidebar" aria-label="Workspace navigation">
      {memberships.length > 0 || selection.organizationId ? (
        <div className="workspace-switcher">
          <span className="eyebrow">Workspace</span>
          <details className="switcher" ref={switcherRef}>
            <summary className="switcher-trigger" aria-label="Switch workspace">
              <span className="org-copy">
                <strong>
                  {activeMembership?.organizationName ??
                    selection.organizationId ??
                    "Choose a workspace"}
                </strong>
                <small
                  className={
                    activeMembership
                      ? `role-chip ${activeMembership.role}`
                      : "role-chip stale"
                  }
                >
                  {activeMembership?.role ??
                    (selection.organizationId
                      ? "Membership unavailable"
                      : "No workspace selected")}
                </small>
              </span>
              <ChevronDown size={16} className="switcher-chevron" />
            </summary>
            <div className="switcher-menu">
              {memberships.map((membership) => {
                const current =
                  membership.organizationId === selection.organizationId;
                return (
                  <switcher.Form
                    action={`/organizations/${membership.organizationId}/switch`}
                    method="post"
                    key={membership.organizationId}
                  >
                    <input type="hidden" name="_csrf" value={csrfToken} />
                    <input
                      type="hidden"
                      name="expectedVersion"
                      value={selection.version}
                    />
                    <input
                      type="hidden"
                      name="idempotencyKey"
                      value={switchKeys[membership.organizationId]}
                    />
                    <button
                      type="submit"
                      disabled={current}
                      className="switcher-option"
                      onClick={(event) => {
                        event.currentTarget
                          .closest("details")
                          ?.removeAttribute("open");
                      }}
                      aria-current={current ? "true" : undefined}
                    >
                      <span className="org-copy">
                        <strong>{membership.organizationName}</strong>
                        <small className={`role-chip ${membership.role}`}>
                          {membership.role}
                        </small>
                      </span>
                      {current ? (
                        <CheckCircle size={16} className="switcher-check" />
                      ) : null}
                    </button>
                  </switcher.Form>
                );
              })}
            </div>
          </details>
          {switcher.data ? (
            <Outcome tone="error">
              {errorNotice(switcher.data.error, switcher.data.requestId)}
            </Outcome>
          ) : null}
        </div>
      ) : null}
      <nav className="section-nav" aria-label="Workspace sections">
        {organizationId ? (
          <>
            <NavLink to={`/organizations/${organizationId}/projects`}>
              <Folder size={17} />
              Projects
            </NavLink>
            <NavLink to={`/organizations/${organizationId}/members`}>
              <Users size={17} />
              Members
            </NavLink>
            <NavLink to={`/organizations/${organizationId}/billing`}>
              <CreditCard size={17} />
              Billing
            </NavLink>
          </>
        ) : null}
        <NavLink to="/invitations">
          <Inbox size={17} />
          My invitations
        </NavLink>
        <NavLink to="/support">
          <Shield size={17} />
          Support access
        </NavLink>
      </nav>
    </aside>
  );
}

export function ProjectList({
  organizationId,
  projects,
  activeProjectId,
}: Readonly<{
  organizationId: string;
  projects: readonly Pick<
    Project,
    "id" | "organizationId" | "name" | "version"
  >[];
  activeProjectId?: string;
}>) {
  if (!projects.length) {
    return (
      <EmptyState icon={<Folder size={20} />} title="No projects available">
        Choose another workspace to continue.
      </EmptyState>
    );
  }
  return (
    <nav className="project-list" aria-label="Projects">
      {projects.map((project) => (
        <Link
          key={project.id}
          to={`/organizations/${organizationId}/projects/${project.id}`}
          className={project.id === activeProjectId ? "selected" : undefined}
          aria-current={project.id === activeProjectId ? "page" : undefined}
        >
          {project.name} <small>v{project.version}</small>
        </Link>
      ))}
    </nav>
  );
}

function MemberList({ members }: Readonly<{ members: readonly Membership[] }>) {
  if (!members.length) {
    return (
      <EmptyState icon={<Users size={20} />} title="No members">
        Invite a teammate to collaborate in this workspace.
      </EmptyState>
    );
  }
  return (
    <ul className="member-list">
      {members.map((member) => {
        const name = member.principalName ?? "Current member";
        return (
          <li
            key={
              member.principalId ?? `${member.organizationId}-${member.role}`
            }
          >
            <span className="member-copy">
              <strong>{name}</strong>
              <small>Workspace seat</small>
            </span>
            <span className={`role-chip ${member.role}`}>{member.role}</span>
          </li>
        );
      })}
    </ul>
  );
}

function InvitationList({
  invitations,
}: Readonly<{ invitations: readonly Invitation[] }>) {
  if (!invitations.length) {
    return (
      <EmptyState icon={<Inbox size={20} />} title="No pending invitations">
        Invite a teammate below.
      </EmptyState>
    );
  }
  return (
    <ul className="invitation-list">
      {invitations.map((item) => (
        <li key={item.id}>
          <span className="member-copy">
            <strong>{item.targetName}</strong>
            <small>
              {item.state === "pending"
                ? `Expires ${displayTime(item.expiresAt)}`
                : item.state === "expired"
                  ? `Expired ${displayTime(item.expiresAt)}`
                  : item.state === "accepted"
                    ? "Invitation accepted"
                    : "Invitation revoked"}
            </small>
          </span>
          <span className={`role-chip ${item.role}`}>{item.role}</span>
          <span className="state-badge" data-state={item.state}>
            {item.state}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function TeamPanels({
  organizationId,
  csrfToken,
  selectionVersion,
  invitationKey,
  members,
  invitations,
  candidates,
  canInvite = true,
}: Readonly<{
  organizationId: string;
  csrfToken: string;
  selectionVersion: number;
  invitationKey: string;
  members: readonly Membership[];
  invitations: readonly Invitation[];
  candidates: readonly InvitationCandidate[];
  canInvite?: boolean;
}>) {
  const invitation = useFetcher<typeof issueAction>();
  const hydrated = useHydrated();
  const available = candidates.find((item) => item.state === "available");
  const [recipient, setRecipient] = useState(available?.id ?? "");
  useEffect(() => {
    if (
      !candidates.some(
        (item) => item.id === recipient && item.state === "available",
      )
    ) {
      setRecipient(available?.id ?? "");
    }
  }, [candidates, available?.id, recipient]);
  useExpiries(
    invitations
      .filter((item) => item.state === "pending")
      .map((item) => item.expiresAt),
  );

  return (
    <div className="team-grid">
      <section className="panel">
        <header className="panel-heading">
          <div>
            <h2>Members</h2>
            <small>{members.length} active</small>
          </div>
        </header>
        <MemberList members={members} />
      </section>
      {canInvite ? (
        <section className="panel">
          <header className="panel-heading">
            <div>
              <h2>Invitations</h2>
              <small>Invitations expire after 15 minutes.</small>
            </div>
          </header>
          <InvitationList invitations={invitations} />
          <invitation.Form
            className="compact-form"
            action={`/organizations/${organizationId}/invitations`}
            method="post"
          >
            <input type="hidden" name="_csrf" value={csrfToken} />
            <input
              type="hidden"
              name="expectedVersion"
              value={selectionVersion}
            />
            <input type="hidden" name="idempotencyKey" value={invitationKey} />
            <label>
              Teammate
              <select
                name="targetPrincipalId"
                value={recipient}
                onChange={(event) => setRecipient(event.currentTarget.value)}
                disabled={!available}
              >
                {!available ? (
                  <option value="">No teammates available</option>
                ) : null}
                {candidates.map((item) => (
                  <option
                    key={item.id}
                    value={item.id}
                    disabled={item.state !== "available"}
                  >
                    {item.name}
                    {item.state === "member"
                      ? " · Already a member"
                      : item.state === "pending"
                        ? " · Invitation pending"
                        : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Role
              <select name="role" defaultValue="viewer">
                <option value="viewer">Viewer</option>
                <option value="editor">Editor</option>
              </select>
            </label>
            <noscript>Enable JavaScript to issue an invitation.</noscript>
            <button
              type="submit"
              disabled={!available || !hydrated || invitation.state !== "idle"}
            >
              {invitation.state === "submitting"
                ? "Creating…"
                : "Create invitation"}
            </button>
          </invitation.Form>
          {!available ? (
            <p className="muted">
              Everyone listed is already a member or has a pending invitation.
            </p>
          ) : null}
          {invitation.data ? (
            <Outcome
              tone={!invitation.data.ok ? "error" : "success"}
              requestId={
                !invitation.data.ok ? undefined : invitation.data.requestId
              }
            >
              {invitation.data.ok ? (
                <InvitationToken
                  key={invitation.data.token}
                  token={invitation.data.token}
                />
              ) : (
                errorNotice(invitation.data.error, invitation.data.requestId)
              )}
            </Outcome>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function InvitationToken({ token }: Readonly<{ token: string }>) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  async function copy() {
    try {
      await navigator.clipboard.writeText(token);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }
  return (
    <div className="invitation-token">
      <p>Invitation created. Share this token with your teammate.</p>
      <div className="button-row">
        <code className="token-chip">{token}</code>
        <button type="button" className="secondary" onClick={copy}>
          Copy token
        </button>
      </div>
      <span role="status">
        {copyState === "copied"
          ? "Token copied."
          : copyState === "failed"
            ? "Copy is unavailable. Select the token and copy it manually."
            : ""}
      </span>
    </div>
  );
}

export function OpenWorkspace({
  organizationId,
  organizationName,
  csrfToken,
  selectionVersion,
  commandKey,
}: Readonly<{
  organizationId: string;
  organizationName: string;
  csrfToken: string;
  selectionVersion: number;
  commandKey: string;
}>) {
  const open = useFetcher<typeof switchAction>();
  const hydrated = useHydrated();
  return (
    <div>
      <open.Form
        action={`/organizations/${organizationId}/switch`}
        method="post"
      >
        <input type="hidden" name="_csrf" value={csrfToken} />
        <input type="hidden" name="expectedVersion" value={selectionVersion} />
        <input type="hidden" name="idempotencyKey" value={commandKey} />
        <button type="submit" disabled={!hydrated || open.state !== "idle"}>
          {open.state === "idle" ? `Open ${organizationName}` : "Opening…"}
        </button>
      </open.Form>
      {open.data ? (
        <Outcome tone="error">
          {errorNotice(open.data.error, open.data.requestId)}
        </Outcome>
      ) : null}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  children,
}: Readonly<{
  title: string;
  description: string;
  children?: React.ReactNode;
}>) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {children}
    </header>
  );
}
