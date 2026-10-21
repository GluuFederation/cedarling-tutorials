const clock = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** Keep server-rendered deadlines identical in browsers with another timezone. */
export function displayTime(value: string): string {
  return `${clock.format(new Date(value))} UTC`;
}
