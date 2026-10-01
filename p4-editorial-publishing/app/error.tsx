"use client";

import { useEffect } from "react";

export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error("P4 browser | editorial page unavailable", {
      event: "editorial.page.failed",
      category: "page_unavailable",
      ...(error.digest ? { digest: error.digest } : {}),
    });
  }, [error]);
  return (
    <main className="landing">
      <section className="service-state" role="alert">
        <h2>Editorial workspace unavailable</h2>
        <p>The request could not be completed safely.</p>
        <button className="secondary" type="button" onClick={retry}>
          Try again
        </button>
      </section>
    </main>
  );
}
