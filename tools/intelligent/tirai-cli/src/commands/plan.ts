// ---------------------------------------------------------------------------
// TIRAI — Plan command (placeholder for Phase 3)
// ---------------------------------------------------------------------------

export interface PlanOptions {
  cwd: string;
  json?: boolean;
}

export async function runPlan(opts: PlanOptions): Promise<void> {
  console.log('Plan command — coming in Phase 3');
  console.log('  Specs + Targets → Canonical TestPlan');
  if (opts.json) {
    console.log(JSON.stringify({ status: 'not-implemented' }, null, 2));
  }
}
