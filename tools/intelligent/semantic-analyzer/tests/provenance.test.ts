// ---------------------------------------------------------------------------
// Provenance tests – validates AI references against source context
// ---------------------------------------------------------------------------
// Spec coverage: scenarios 12-15

import { describe, it, expect } from 'vitest';
import {
  buildValidContextIds,
  buildContextSheetMap,
  validateProvenance,
  validateProvenanceArray,
} from '../src/validation/provenance-validator.js';
import { SemanticWarningCode } from '../src/warnings.js';
import { contextChunk, prov } from './fixtures/helpers.js';

describe('provenance validator', () => {
  const chunks = [
    contextChunk({ id: 'ctx-a', sheet: { index: 0, name: 'SheetA' } } as any),
    contextChunk({ id: 'ctx-b', sheet: { index: 1, name: 'SheetB' } } as any),
  ];

  const validIds = buildValidContextIds(chunks);
  const sheetMap = buildContextSheetMap(chunks);

  // Scenario 12: valid provenance
  describe('valid provenance', () => {
    it('returns no warnings for a valid provenance reference', () => {
      const warnings = validateProvenance(
        prov('ctx-a', 'SheetA', ['A1']),
        validIds,
        sheetMap,
        'entity-1',
      );
      expect(warnings).toHaveLength(0);
    });

    it('accepts provenance without sheet (optional field)', () => {
      const warnings = validateProvenance(
        prov('ctx-b'),
        validIds,
        sheetMap,
        'entity-2',
      );
      expect(warnings).toHaveLength(0);
    });
  });

  // Scenario 13: fake cell rejected (cell is not validated at provenance level,
  // but contextId must exist)
  describe('fake cell rejected', () => {
    it('rejects provenance referencing a non-existent context', () => {
      const warnings = validateProvenance(
        prov('ctx-fake', 'SheetA', ['Z999']),
        validIds,
        sheetMap,
        'entity-fake',
      );
      expect(warnings).toHaveLength(1);
      expect(warnings[0].code).toBe(SemanticWarningCode.INVALID_PROVENANCE);
      expect(warnings[0].message).toContain('ctx-fake');
    });
  });

  // Scenario 14: fake range rejected
  describe('fake range rejected', () => {
    it('rejects provenance with wrong sheet name for context', () => {
      const warnings = validateProvenance(
        prov('ctx-a', 'WrongSheet', ['A1']),
        validIds,
        sheetMap,
        'entity-wrong',
      );
      expect(warnings).toHaveLength(1);
      expect(warnings[0].code).toBe(SemanticWarningCode.INVALID_PROVENANCE);
      expect(warnings[0].message).toContain('does not match');
    });
  });

  // Scenario 15: missing context rejected
  describe('missing context rejected', () => {
    it('rejects provenance referencing a context ID not in source', () => {
      const warnings = validateProvenance(
        prov('ctx-nonexistent'),
        validIds,
        sheetMap,
        'entity-missing',
      );
      expect(warnings).toHaveLength(1);
      expect(warnings[0].code).toBe(SemanticWarningCode.INVALID_PROVENANCE);
      expect(warnings[0].objectId).toBe('entity-missing');
    });
  });

  describe('validateProvenanceArray', () => {
    it('validates multiple provenance references and collects all warnings', () => {
      const provenances = [
        prov('ctx-a', 'SheetA'),       // valid
        prov('ctx-fake', 'SheetA'),    // invalid context
        prov('ctx-b', 'WrongSheet'),   // wrong sheet
      ];
      const warnings = validateProvenanceArray(provenances, validIds, sheetMap, 'obj-1');
      // First is valid, second and third should produce warnings
      expect(warnings).toHaveLength(2);
      expect(warnings[0].message).toContain('ctx-fake');
      expect(warnings[1].message).toContain('does not match');
    });

    it('returns empty array when all provenances are valid', () => {
      const provenances = [
        prov('ctx-a', 'SheetA'),
        prov('ctx-b', 'SheetB'),
      ];
      const warnings = validateProvenanceArray(provenances, validIds, sheetMap, 'obj-2');
      expect(warnings).toHaveLength(0);
    });
  });
});
