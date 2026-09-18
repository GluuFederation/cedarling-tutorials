"use client";

import { useEffect } from "react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => console.error(error.name), [error]);
  return (
    <main className="landing">
      <section className="service-state" role="alert">
        <h2>Editorial workspace unavailable</h2>
        <p>The request could not be completed safely.</p>
        <button className="secondary" type="button" onClick={reset}>
          Try again
        </button>
      </section>
    </main>
  );
}
