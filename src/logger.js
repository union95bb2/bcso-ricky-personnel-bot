/**
 * Process-level diagnostics. Keep this separate from the PAB audit log:
 * audit entries describe approved personnel actions, while these entries are
 * technical troubleshooting data and never include submitted form values.
 */
function errorFields(error) {
  if (error instanceof Error) return { errorName: error.name, errorMessage: error.message, stack: error.stack };
  return { errorMessage: String(error) };
}

export function logError(scope, error, context = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level: "error",
    scope,
    ...context,
    ...errorFields(error)
  };
  // Structured stderr is captured by Docker/systemd/host log collection while
  // keeping personnel form contents out of the technical log.
  console.error(JSON.stringify(entry));
}

export function logWarn(scope, message, context = {}) {
  console.warn(JSON.stringify({ timestamp: new Date().toISOString(), level: "warn", scope, ...context, message }));
}
