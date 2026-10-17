// Trust-boundary marker: routes map this to HTTP 400 (client error); anything
// else is a dependency/infrastructure failure and maps to HTTP 500.
export class ValidationError extends Error {}
