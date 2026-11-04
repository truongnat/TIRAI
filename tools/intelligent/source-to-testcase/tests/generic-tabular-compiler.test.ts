import { describe, it, expect } from 'vitest';
import {
  isFieldDefTable,
  isRuleDefTable,
  isActionDefTable,
  compileGenericTabularSpec,
  canCompileGenericTabularSpec,
} from '../src/generic-tabular-compiler.js';
import type { CanonicalSourceDocument } from 'source-ingestion';

describe('Generic Tabular Compiler & Edge-Case Engine', () => {
  describe('Table morphology detection', () => {
    it('detects field definition tables across English, Japanese, Vietnamese', () => {
      // English
      expect(
        isFieldDefTable(
          ['No.', 'Field Name', 'Field ID', 'Control Type', 'Max Length'],
          [['1', 'Username', 'txtUser', 'TextBox', '30']],
        ),
      ).toBe(true);

      // Japanese
      expect(
        isFieldDefTable(
          ['№', 'コントロール名', 'コントロールID', '種類', '桁数'],
          [['1', '出荷日', 'dtpShipDate', 'DatePicker', '10']],
        ),
      ).toBe(true);

      // Vietnamese
      expect(
        isFieldDefTable(
          ['STT', 'Tên trường', 'Mã trường', 'Loại control', 'Độ dài tối đa'],
          [['1', 'Mã vật tư', 'txtMaterialCd', 'TextBox', '20']],
        ),
      ).toBe(true);

      // Noise table (e.g. revision history) should be rejected
      expect(
        isFieldDefTable(
          ['Version', 'Date', 'Author', 'Changes'],
          [['1.0', '2026-01-01', 'Admin', 'Initial commit']],
        ),
      ).toBe(false);
    });

    it('detects rule definition tables and eliminates false positives on revision history', () => {
      // Japanese check table with error code
      expect(
        isRuleDefTable(
          ['No.', 'タイミング', '条件', 'メッセージID'],
          [['1', '押下時', '日付形式不正', 'WZ00060']],
        ),
      ).toBe(true);

      // English validation table with dual signal (condition + message)
      expect(
        isRuleDefTable(
          ['Rule ID', 'Condition / Trigger', 'Error Message'],
          [['R-01', 'Password length < 8', 'Password too short']],
        ),
      ).toBe(true);

      // Noise table: Revision history with "Checker" column should NOT be detected as rule table
      expect(
        isRuleDefTable(
          ['Revision', 'Update Date', 'Checker', 'Remarks'],
          [['1.0', '2026-05-01', 'QA Team', 'Approved for production']],
        ),
      ).toBe(false);

      // Noise table: Revision history with "Date", "Change", "Check", "Message" columns must NOT be detected as rule table
      expect(
        isRuleDefTable(
          ['No', 'Date', 'Change', 'Check', 'Message'],
          [['1', '2026-05-01', 'Update spec', 'QA Team', 'Approved']],
        ),
      ).toBe(false);
    });

    it('detects user action and event tables', () => {
      expect(
        isActionDefTable(
          ['No.', 'Target Component', 'Timing', 'Action / Operation'],
          [['1', 'Submit Button', 'Click', 'Sends POST request to backend']],
        ),
      ).toBe(true);

      expect(
        isActionDefTable(
          ['No.', '項目', 'タイミング', '動作'],
          [['1', 'クリア(F1)ボタン', '押下時', '抽出条件部の入力内容を初期化する']],
        ),
      ).toBe(true);

      // Plain description table should be rejected
      expect(
        isActionDefTable(
          ['Property', 'Description'],
          [['Database', 'PostgreSQL 16']],
        ),
      ).toBe(false);
    });
  });

  describe('Autonomous edge-case expansion and full compilation', () => {
    const sampleDoc: CanonicalSourceDocument = {
      source: {
        id: 'src-sample-01',
        kind: 'markdown',
        displayName: 'DEMO001_UserRegistration.md',
        connectorId: 'local-markdown-connector',
        connectorVersion: '1.0.0',
      },
      revision: {
        id: 'rev-01',
        contentHash: 'hash-01',
        version: '1.0.0',
      },
      artifacts: [],
      contexts: [
        {
          id: 'ctx-fields',
          content: `
| No. | Field Name | Field ID | Control Type | Max Length | State | Description |
|---|---|---|---|---|---|---|
| 1 | Username | txtUsername | TextBox | 20 | Required | User account login handle |
| 2 | Birth Date | dtpBirthDate | DatePicker | 10 | Optional | Date of birth (yyyy/MM/dd) |
| 3 | Department Name | txtDeptNameRO | TextBox | 50 | ReadOnly | Readonly auto-filled department |
| 4 | Submit Button | btnSubmit | Button | - | - | Submits registration |
`,
        },
        {
          id: 'ctx-rules',
          content: `
| Rule No. | Trigger | Validation Condition | Message Code | Description |
|---|---|---|---|---|
| 1 | Submit | Username format contains whitespace | ERR-001 | Username must not contain whitespace |
| 2 | Submit | Birth date is in the future | ERR-002 | Birth date cannot be in the future |
| 3 | Submit | Username already taken | WARN-003 | Account already exists |
`,
        },
        {
          id: 'ctx-actions',
          content: `
| No. | Target Component | Trigger | Action Outcome |
|---|---|---|---|
| 1 | Submit Button | Click | Validate inputs and send registration API |
| 2 | Search Dept Modal | Click | Open department lookup modal and select department |
| 3 | Reset Button | Click | Clear all form fields to default |
`,
        },
      ],
    };

    it('can compile generic tabular spec', () => {
      expect(canCompileGenericTabularSpec(sampleDoc)).toBe(true);
    });

    it('compiles into canonical IR with autonomous BVA, Date, Security and Concurrency edge cases', () => {
      const result = compileGenericTabularSpec(sampleDoc);
      expect(result).not.toBeNull();
      if (!result) return;

      const { semanticIR, requirementIR, testPlanIR } = result;

      // Semantic IR verified
      expect(semanticIR.status).toBe('complete');
      expect(semanticIR.entities.length).toBeGreaterThan(0);
      expect(semanticIR.flows.length).toBe(3);
      expect(semanticIR.rules.length).toBe(3);

      // Requirement IR verified
      expect(requirementIR.requirements.length).toBeGreaterThan(0);

      // Test Plan & Test Cases verified
      expect(testPlanIR.testCases.length).toBeGreaterThan(10);
      expect(testPlanIR.scenarios.length).toBe(testPlanIR.testCases.length);

      // Verify BVA edge cases exist
      const bvaMax = testPlanIR.testCases.find((tc) => tc.id.includes('BVA') && !tc.id.includes('OVF'));
      expect(bvaMax).toBeDefined();
      expect(bvaMax?.inputs[0]?.value.length).toBe(20);

      const bvaOverflow = testPlanIR.testCases.find((tc) => tc.id.includes('BVA-OVF'));
      expect(bvaOverflow).toBeDefined();
      expect(bvaOverflow?.inputs[0]?.value.length).toBeGreaterThan(20);

      // Verify Date anomaly edge cases exist
      const dateInvalid = testPlanIR.testCases.find((tc) => tc.id.includes('DATE-INV'));
      expect(dateInvalid).toBeDefined();

      // Verify Security injection edge cases exist
      const sqliCase = testPlanIR.testCases.find((tc) => tc.id.includes('SEC-SQLI'));
      expect(sqliCase).toBeDefined();
      expect(sqliCase?.inputs[0]?.value).toContain("' OR '1'='1");

      const xssCase = testPlanIR.testCases.find((tc) => tc.id.includes('SEC-XSS'));
      expect(xssCase).toBeDefined();
      expect(xssCase?.inputs[0]?.value).toContain('<script>');

      // Verify Concurrency / Idempotency edge cases exist
      const raceCase = testPlanIR.testCases.find((tc) => tc.id.includes('RACE'));
      expect(raceCase).toBeDefined();

      // Verify Quality Gate: non-happy-path edge case ratio >= 40%
      const nonHappy = testPlanIR.scenarios.filter((s) => s.category !== 'happy-path').length;
      const ratio = nonHappy / testPlanIR.scenarios.length;
      expect(ratio).toBeGreaterThanOrEqual(0.4);
    });
  });
});
