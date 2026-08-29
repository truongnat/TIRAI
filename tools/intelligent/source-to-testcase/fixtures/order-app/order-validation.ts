// Shared acceptance rule (spec §5.4 §6, §7).
//
// The SAME business rule is implemented here (Unit target, inspected by
// `inspectTargetProject`) and in the local E2E app server
// (`fixtures/order-app/server.mjs`). The Unit target and the UI exercise one
// identical semantic behavior:
//
//   quantity > availableStock  => order rejected, reason INSUFFICIENT_STOCK
//   otherwise                  => order accepted,   reason ACCEPTED

export function validateOrder(quantity: number, availableStock: number): string {
  return quantity > availableStock ? 'INSUFFICIENT_STOCK' : 'ACCEPTED';
}
