import { RouterProvider } from "react-router";
import { getBrowserRouter } from "./routes.tsx";
export function App({
  router = getBrowserRouter(),
}: {
  router?: ReturnType<typeof getBrowserRouter>;
}) {
  return <RouterProvider router={router} />;
}
