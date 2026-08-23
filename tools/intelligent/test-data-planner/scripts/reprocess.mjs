import { classifyConstraints } from '../dist/normalization/constraint-classifier.js';
import { applyProvenanceInheritance } from '../dist/normalization/provenance-inheritance.js';
import { computeDataQualityMetrics } from '../dist/quality/metrics.js';
// eslint-disable-next-line no-console
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../../../..');

const tcIR = JSON.parse(fs.readFileSync(path.join(ROOT, 'output/test-planner-deepseek-final/test-case-ir.json'), 'utf-8'));
const dpIR = JSON.parse(fs.readFileSync(path.join(ROOT, 'output/test-data/test-data-plan-ir.json'), 'utf-8'));

console.log('=== BEFORE ===');
console.log('Provenance coverage:', dpIR.quality.provenanceCoverage);
const otherBefore = dpIR.dataItems.reduce((s, d) => s + d.constraints.filter(c => c.type === 'other').length, 0);
const totalConstraints = dpIR.dataItems.reduce((s, d) => s + d.constraints.length, 0);
console.log('Constraints typed other:', otherBefore, '/', totalConstraints);

for (const item of dpIR.dataItems) {
  item.constraints = classifyConstraints(item.constraints);
}

const gained = applyProvenanceInheritance(dpIR.dataItems, tcIR.testCases);
console.log('Items gained provenance:', gained, '/', dpIR.dataItems.length);

dpIR.quality = computeDataQualityMetrics(
  dpIR.testCases, dpIR.dataItems, dpIR.dependencyGraph,
  dpIR.reusableSets, dpIR.unresolved, 0,
);

console.log('\n=== AFTER ===');
console.log('Provenance coverage:', dpIR.quality.provenanceCoverage);
const otherAfter = dpIR.dataItems.reduce((s, d) => s + d.constraints.filter(c => c.type === 'other').length, 0);
console.log('Constraints typed other:', otherAfter, '/', totalConstraints);

const typeDist = {};
for (const d of dpIR.dataItems) {
  for (const c of d.constraints) {
    typeDist[c.type] = (typeDist[c.type] || 0) + 1;
  }
}
console.log('Constraint type distribution:', JSON.stringify(typeDist));

const outDir = path.join(ROOT, 'output/test-data-hardened');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'test-data-plan-ir.json'), JSON.stringify(dpIR, null, 2));
console.log('\nHardened output written to output/test-data-hardened/');

console.log('\n=== INVARIANT CHECK ===');
console.log('Data items:', dpIR.dataItems.length, '(expected 24)');
console.log('Dependencies:', dpIR.dependencyGraph.length, '(expected 5)');
console.log('Unresolved:', dpIR.unresolved.length, '(expected 1)');
console.log('Cycles:', dpIR.quality.cyclicDependencies, '(expected 0)');
