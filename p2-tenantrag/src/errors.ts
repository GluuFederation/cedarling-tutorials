type StableErrorCode =
  | "invalid_retrieval"
  | "authentication_required"
  | "corpus_not_found"
  | "retrieval_unavailable";

export class ApplicationError extends Error {
  constructor(
    public readonly statusCode: 400 | 401 | 404 | 503,
    public readonly code: StableErrorCode,
  ) {
    super(code);
    this.name = "ApplicationError";
  }
}

export function invalidRetrieval(): ApplicationError {
  return new ApplicationError(400, "invalid_retrieval");
}

export function authenticationRequired(): ApplicationError {
  return new ApplicationError(401, "authentication_required");
}

export function corpusNotFound(): ApplicationError {
  return new ApplicationError(404, "corpus_not_found");
}

export function retrievalUnavailable(): ApplicationError {
  return new ApplicationError(503, "retrieval_unavailable");
}
