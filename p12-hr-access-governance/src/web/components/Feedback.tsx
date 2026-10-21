import { type ReactNode, useEffect, useRef, useState } from "react";
import { Link, useRevalidator, useRouteError } from "react-router";
import { ApiError } from "../api.ts";
export function Notice({ message }: { message: string }) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), 5000);
    return () => clearTimeout(timer);
  }, []);
  return visible ? (
    <p className="notice" role="status">
      {message}
    </p>
  ) : null;
}
export function FieldError() {
  const error = useRouteError();
  const revalidator = useRevalidator();
  if (error instanceof ApiError && error.status === 401) throw error;
  return (
    <section className="field-error" role="alert">
      <h3>
        {error instanceof ApiError && error.status === 403
          ? "Access not allowed"
          : "This record could not be loaded"}
      </h3>
      <p>
        {error instanceof ApiError
          ? error.message
          : "Retry the request. If the problem continues, reload this page."}
      </p>
      <button
        type="button"
        className="secondary"
        onClick={() => void revalidator.revalidate()}
      >
        Retry
      </button>
    </section>
  );
}
export function PageHeading({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <div className="page-heading">
      <div>
        <h2 tabIndex={-1} ref={heading}>
          {title}
        </h2>
        {description && <p>{description}</p>}
      </div>
      {children}
    </div>
  );
}
export function BackLink({
  to,
  children,
}: {
  to: string;
  children: ReactNode;
}) {
  return (
    <Link className="back-link" to={to}>
      {children}
    </Link>
  );
}
export function Status({ value }: { value: string }) {
  return (
    <span className={`status ${value.toLowerCase().replaceAll(" ", "-")}`}>
      {value === "rejected"
        ? "Declined"
        : value[0]?.toUpperCase() + value.slice(1)}
    </span>
  );
}
export function date(value: number | null) {
  return value === null
    ? "Not started"
    : new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(value);
}
export function calendarDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
    new Date(`${value}T12:00:00`),
  );
}
export function Facts({ items }: { items: readonly [string, ReactNode][] }) {
  return (
    <dl className="facts">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
