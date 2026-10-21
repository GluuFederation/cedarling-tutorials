import { type ComponentProps, useState } from "react";
import { createBrowserRouter, RouterProvider } from "react-router";
import { routes } from "./routes.tsx";

type Router = ComponentProps<typeof RouterProvider>["router"];
export function App({ router }: { router?: Router }) {
  const [current] = useState(() => router ?? createBrowserRouter(routes));
  return <RouterProvider router={current} />;
}
