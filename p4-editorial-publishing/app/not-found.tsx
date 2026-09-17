import { ServiceError } from "./components.tsx";

export default function NotFound() {
  return (
    <main className="landing">
      <ServiceError message="The requested article is unavailable." />
    </main>
  );
}
