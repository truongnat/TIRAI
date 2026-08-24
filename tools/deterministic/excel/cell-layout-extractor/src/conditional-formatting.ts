// ---------------------------------------------------------------------------
// Conditional Formatting extraction – raw OOXML parsing via JSZip
// ---------------------------------------------------------------------------

import type {
  ConditionalFormattingRaw,
  ConditionalFormattingRuleRaw,
  Warning,
} from './models.js';
import { WarningCode, createWarning } from './warnings.js';
import { WorkbookOOXMLContext } from './ooxml-context.js';

/**
 * Extract conditional formatting rules from a worksheet by parsing raw OOXML.
 *
 * ExcelJS does not fully expose conditional formatting, so we read the
 * sheet XML directly from the zip archive.
 */
export async function extractConditionalFormatting(
  filePath: string,
  sheetIndex: number,
  sheetName: string,
  warnings: Warning[],
  ooxmlContext?: WorkbookOOXMLContext,
): Promise<ConditionalFormattingRaw[]> {
  const result: ConditionalFormattingRaw[] = [];

  try {
    const context = ooxmlContext ?? await WorkbookOOXMLContext.fromFile(filePath);

    const sheetPath = `xl/worksheets/sheet${sheetIndex + 1}.xml`;
    const sheetXml = await context.text(sheetPath);
    if (sheetXml === null) return result;

    // Match all <conditionalFormatting> elements
    const cfRegex = /<conditionalFormatting\s+([^>]*?)>([\s\S]*?)<\/conditionalFormatting>/g;
    let cfMatch;

    while ((cfMatch = cfRegex.exec(sheetXml)) !== null) {
      const attrs = cfMatch[1];
      const content = cfMatch[2];

      // Extract sqref (applied ranges)
      const sqrefMatch = /sqref="([^"]+)"/.exec(attrs);
      if (!sqrefMatch) continue;

      const ranges = sqrefMatch[1].split(/\s+/).filter(Boolean);

      // Parse rules within this conditional formatting block
      const rules = parseCFRules(content, sheetName, warnings);

      if (rules.length > 0) {
        result.push({ ranges, rules });
      }
    }
  } catch (err) {
    warnings.push(
      createWarning(
        WarningCode.CONDITIONAL_FORMATTING_PARTIAL,
        `Failed to parse conditional formatting: ${err instanceof Error ? err.message : String(err)}`,
        sheetName,
      ),
    );
  }

  // Sort deterministically by first range
  result.sort((a, b) => {
    const aRange = a.ranges[0] ?? '';
    const bRange = b.ranges[0] ?? '';
    return aRange.localeCompare(bRange);
  });

  return result;
}

// ---- Rule parsing --------------------------------------------------------

function parseCFRules(
  cfContent: string,
  _sheetName: string,
  _warnings: Warning[],
): ConditionalFormattingRuleRaw[] {
  const rules: ConditionalFormattingRuleRaw[] = [];

  // Match <cfRule> elements (self-closing or with content)
  const ruleRegex = /<cfRule\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/cfRule>)/g;
  let ruleMatch;

  while ((ruleMatch = ruleRegex.exec(cfContent)) !== null) {
    const attrs = ruleMatch[1];
    const innerContent = ruleMatch[2] ?? '';

    // Extract attributes
    const type = extractAttr(attrs, 'type') ?? 'expression';
    const operator = extractAttr(attrs, 'operator');
    const priority = parseInt(extractAttr(attrs, 'priority') ?? '0', 10);
    const stopIfTrue = extractAttr(attrs, 'stopIfTrue') === '1';
    const dxfIdStr = extractAttr(attrs, 'dxfId');
    const dxfId = dxfIdStr !== null ? parseInt(dxfIdStr, 10) : null;

    // Extract formulas from <formula> elements
    const formulas: string[] = [];
    const formulaRegex = /<formula>([\s\S]*?)<\/formula>/g;
    let formulaMatch;
    while ((formulaMatch = formulaRegex.exec(innerContent)) !== null) {
      formulas.push(decodeXmlEntities(formulaMatch[1]));
    }

    rules.push({
      type,
      operator,
      formula: formulas,
      priority,
      stopIfTrue,
      dxfId,
    });
  }

  // Sort rules by priority (deterministic)
  rules.sort((a, b) => a.priority - b.priority);

  return rules;
}

// ---- Helpers -------------------------------------------------------------

function extractAttr(attrs: string, name: string): string | null {
  const match = new RegExp(`${name}="([^"]*)"`, 'i').exec(attrs);
  return match ? match[1] : null;
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}
