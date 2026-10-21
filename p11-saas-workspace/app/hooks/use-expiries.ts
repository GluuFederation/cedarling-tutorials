import { useEffect, useState } from "react";
import { useRevalidator } from "react-router";

/** Update expiry guidance once at each deadline; the server still validates every action. */
export function useExpiries(
  deadlines: readonly string[],
  initialTime = 0,
): number {
  const [now, setNow] = useState(initialTime);
  const { revalidate } = useRevalidator();
  const key = deadlines.join("|");
  useEffect(() => {
    const current = Date.now();
    setNow(current);
    const next = key
      .split("|")
      .map(Date.parse)
      .filter((time) => time > current)
      .sort((a, b) => a - b)[0];
    if (next === undefined) return;
    const timer = setTimeout(
      () => {
        setNow(Date.now());
        void revalidate();
      },
      Math.min(next - current + 25, 2_147_483_647),
    );
    return () => clearTimeout(timer);
  }, [key, revalidate]);
  return now;
}
