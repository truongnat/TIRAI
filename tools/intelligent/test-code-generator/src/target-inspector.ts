// Target-Code Mapping Bridge (spec §8–§13).
//
// Deterministic, compiler-backed inspection of a target project's source to
// establish trusted symbol identity (no AI, no fuzzy matching). The mapping
// layer then resolves a canonical TestCase to a concrete target symbol using
// explicit, trusted references (spec §10).

import * as ts from 'typescript';
import { readFileSync, readdirSync, type Dirent } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { sha256 } from './fingerprint.js';
import type {
  TargetProjectProfile,
  TargetSymbolKind,
  UnitTargetCodeMapping,
  TargetMappingStatus,
  UnitAssertionType,
  GenerationBlockReason,
} from './models.js';
import type { TestCase } from './re-export.js';

interface InspectedSymbol {
  sourceFile: string;
  symbolName: string;
  kind: TargetSymbolKind;
  params: Array<{ name: string; type?: string }>;
  isAsync: boolean;
  returnType?: string;
  fingerprint: string;
}

export type SymbolIndex = Map<string, InspectedSymbol[]>;

function toPosix(p: string): string {
  return p.split('\\').join('/');
}

function walkTsFiles(root: string): string[] {
  const out: string[] = [];
  const visit = (dir: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const name = entry.name;
      if (name === 'node_modules' || name === '.git') continue;
      const full = join(dir, name);
      try {
        if (entry.isDirectory()) visit(full);
        else if (entry.isFile() && name.endsWith('.ts') && !name.endsWith('.d.ts')) out.push(full);
      } catch {
        continue;
      }
    }
  };
  visit(root);
  return out;
}

function isExported(node: ts.Node): boolean {
  return (
    (node as { modifiers?: ts.NodeArray<ts.Modifier> }).modifiers?.some(
      (m) => m.kind === ts.SyntaxKind.ExportKeyword,
    ) ?? false
  );
}

function paramInfo(p: ts.ParameterDeclaration, sf: ts.SourceFile): { name: string; type?: string } {
  const name = p.name.getText(sf);
  const type = p.type?.getText(sf);
  return type ? { name, type } : { name };
}

function returnTypeOf(node: ts.SignatureDeclaration, sf: ts.SourceFile): string | undefined {
  return node.type?.getText(sf);
}

function isAsyncFn(node: ts.SignatureDeclaration): boolean {
  const fn = node as ts.FunctionLikeDeclaration;
  return fn.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ?? false;
}

/** Inspect a target project and build a name -> symbol index (spec §8). */
export function inspectTargetProject(profile: TargetProjectProfile): SymbolIndex {
  const index: SymbolIndex = new Map();
  const roots = profile.sourceRoots.length ? profile.sourceRoots : [profile.projectRoot];
  const files = roots.flatMap((r) => walkTsFiles(resolve(profile.projectRoot, r)));

  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    const fingerprint = sha256(content);
    const sf = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);

    const add = (symbolName: string, kind: TargetSymbolKind, node: ts.SignatureDeclaration): void => {
      const entry: InspectedSymbol = {
        sourceFile: toPosix(file),
        symbolName,
        kind,
        params: node.parameters.map((p) => paramInfo(p, sf)),
        isAsync: isAsyncFn(node),
        returnType: returnTypeOf(node, sf),
        fingerprint,
      };
      const list = index.get(symbolName) ?? [];
      list.push(entry);
      index.set(symbolName, list);
    };

    for (const stmt of sf.statements) {
      if (ts.isFunctionDeclaration(stmt) && stmt.name && isExported(stmt)) {
        add(stmt.name.text, 'function', stmt);
      } else if (ts.isClassDeclaration(stmt) && stmt.name && isExported(stmt)) {
        const className = stmt.name.text;
        add(className, 'class', {
          parameters: [],
          type: undefined,
          modifiers: stmt.modifiers,
        } as unknown as ts.SignatureDeclaration);
        for (const member of stmt.members) {
          if (
            ts.isMethodDeclaration(member) &&
            member.name &&
            !member.modifiers?.some(
              (m) =>
                m.kind === ts.SyntaxKind.PrivateKeyword ||
                m.kind === ts.SyntaxKind.ProtectedKeyword ||
                m.kind === ts.SyntaxKind.StaticKeyword,
            )
          ) {
            const methodName = member.name.getText(sf);
            add(`${className}.${methodName}`, 'method', member);
          }
        }
      } else if (ts.isVariableStatement(stmt) && isExported(stmt)) {
        for (const decl of stmt.declarationList.declarations) {
          if (!ts.isIdentifier(decl.name)) continue;
          const init = decl.initializer;
          if (init && (ts.isFunctionExpression(init) || ts.isArrowFunction(init))) {
            add(decl.name.text, 'function', init);
          }
        }
      }
    }
  }
  return index;
}

export interface ResolvedUnitBinding {
  argumentValues: unknown[];
  expectedValue?: unknown;
  assertionType: UnitAssertionType;
}

export interface ResolvedUnitMapping {
  status: TargetMappingStatus;
  symbol?: InspectedSymbol & { importPath: string };
  binding?: ResolvedUnitBinding;
  reason?: GenerationBlockReason;
}

function computeImportPath(generatedDir: string, sourceFile: string): string {
  let rel = toPosix(relative(generatedDir, sourceFile));
  if (!rel.startsWith('.')) rel = `./${rel}`;
  return rel.replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, '');
}

/**
 * Resolve a trusted UnitTargetCodeMapping against the inspected symbol index.
 * Only RESOLVED mappings may generate runnable unit test code (spec §11).
 */
export function resolveUnitMapping(
  testCase: TestCase,
  mapping: UnitTargetCodeMapping,
  index: SymbolIndex,
  generatedDir: string,
  profile: TargetProjectProfile,
): ResolvedUnitMapping {
  const candidates = index.get(mapping.symbolRef.symbolName) ?? [];
  const refSource = mapping.symbolRef.sourceFile
    ? toPosix(resolve(profile.projectRoot, mapping.symbolRef.sourceFile))
    : undefined;
  const withSource = refSource
    ? candidates.filter((c) => toPosix(c.sourceFile) === refSource)
    : candidates;

  if (withSource.length === 0) {
    return {
      status: 'NOT_FOUND',
      reason: {
        code: 'NOT_FOUND',
        message: `No trusted symbol '${mapping.symbolRef.symbolName}' found in target project`,
      },
    };
  }
  if (withSource.length > 1) {
    return {
      status: 'AMBIGUOUS',
      reason: {
        code: 'AMBIGUOUS',
        message: `Symbol '${mapping.symbolRef.symbolName}' resolves to ${withSource.length} candidates; explicit sourceFile required`,
      },
    };
  }

  const entry = withSource[0];

  if (mapping.targetFingerprint && mapping.targetFingerprint !== entry.fingerprint) {
    return {
      status: 'STALE_MAPPING',
      reason: {
        code: 'STALE_MAPPING',
        message: `Target symbol '${mapping.symbolRef.symbolName}' fingerprint mismatch (stale mapping)`,
      },
    };
  }

  const inputByName = new Map(testCase.inputs.map((i) => [i.name, i.value]));
  const argumentValues: unknown[] = [];
  for (const name of mapping.argumentInputNames) {
    if (!inputByName.has(name)) {
      return {
        status: 'UNRESOLVED_INPUT',
        reason: {
          code: 'UNRESOLVED_INPUT',
          message: `TestCase input '${name}' not found; cannot bind to target parameter`,
        },
      };
    }
    argumentValues.push(inputByName.get(name));
  }
  if (argumentValues.length !== entry.params.length) {
    return {
      status: 'UNRESOLVED_INPUT',
      reason: {
        code: 'UNRESOLVED_INPUT',
        message: `Parameter count mismatch: target expects ${entry.params.length}, mapping binds ${argumentValues.length}`,
      },
    };
  }

  const expected =
    mapping.expectedResultIndex !== null && mapping.expectedResultIndex !== undefined
      ? testCase.expectedResults[mapping.expectedResultIndex]
      : undefined;
  const expectedValue = expected?.verificationIntent?.expectedValue;
  if (expectedValue === undefined || expectedValue === null) {
    return {
      status: 'UNSUPPORTED_ASSERTION',
      reason: {
        code: 'UNSUPPORTED_ASSERTION',
        message: `No expected value at expectedResultIndex ${mapping.expectedResultIndex} for assertion`,
      },
    };
  }

  const symbol: InspectedSymbol & { importPath: string } = {
    ...entry,
    importPath: computeImportPath(generatedDir, entry.sourceFile),
  };

  return {
    status: 'RESOLVED',
    symbol,
    binding: {
      argumentValues,
      expectedValue,
      assertionType: mapping.assertionType,
    },
  };
}
