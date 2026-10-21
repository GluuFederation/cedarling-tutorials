import { useEffect } from "react";
import { useRevalidator } from "react-router";
export function useDeadlineRefresh(deadline: number | null) {
  const { revalidate } = useRevalidator();
  useEffect(() => {
    if (deadline === null) return;
    const timer = setTimeout(
      () => void revalidate(),
      Math.max(0, deadline - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [deadline, revalidate]);
}
