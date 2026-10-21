import { StrictMode, startTransition } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";
import { DocumentNonceContext } from "./context.ts";

const nonce = document.querySelector<HTMLScriptElement>("script[nonce]")?.nonce;

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <DocumentNonceContext value={nonce}>
        <HydratedRouter />
      </DocumentNonceContext>
    </StrictMode>,
  );
});
