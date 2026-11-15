const stateChangingMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function isTrustedTaskFlowProxyRequest(
  method: string,
  origin: string | null,
  expectedOrigin = "http://localhost:5173",
) {
  const normalizedMethod = method.toUpperCase();

  if (origin && origin !== expectedOrigin) return false;
  return !stateChangingMethods.has(normalizedMethod) || origin === expectedOrigin;
}

export function isStateChangingRequest(method: string) {
  return stateChangingMethods.has(method.toUpperCase());
}
