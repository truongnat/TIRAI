// Importing this module (and calling boom) simulates an infrastructure-level
// failure so the generator can demonstrate the ERROR (vs business FAIL)
// classification path without any real network access.
export function boom(): number {
  throw new Error('net::ERR_CONNECTION_REFUSED simulated infrastructure failure');
}
