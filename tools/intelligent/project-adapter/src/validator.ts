// Cross-reference validator — validates all references within a profile.
//
// Checks: UI page/element IDs, API resource/operation refs, DB resource refs,
// binding names, secret refs, command envRefs. Fails on dangling references.

import type {
  ProjectExecutionProfile,
  ProjectAdapterError as ModelError,
  ProjectAdapterWarning,
  ProjectAdapterValidationResult,
} from './models.js';
import { createWarning } from './warnings.js';

export function validateProfile(
  profile: ProjectExecutionProfile,
): ProjectAdapterValidationResult {
  const errors: ModelError[] = [];
  const warnings: ProjectAdapterWarning[] = [];

  // --- UI cross-references ---
  if (profile.ui) {
    const _pageIds = new Set(profile.ui.catalog.pages.map((p) => p.id));
    const elementNames = new Set<string>();
    for (const page of profile.ui.catalog.pages) {
      for (const el of page.elements) {
        const key = `${page.id}.${el.logicalName}`;
        if (elementNames.has(key)) {
          errors.push({
            code: 'PROJECT_DUPLICATE_RESOURCE',
            message: `Duplicate UI element: ${key}`,
            path: `ui.catalog.pages.${page.id}.elements`,
          });
        }
        elementNames.add(key);
      }
    }
  } else {
    warnings.push(
      createWarning('PROJECT_NO_UI', 'No UI profile configured'),
    );
  }

  // --- API cross-references ---
  if (profile.api) {
    const resourceIds = new Set(profile.api.resources.map((r) => r.id));
    for (const op of profile.api.operations) {
      if (!resourceIds.has(op.resourceId)) {
        errors.push({
          code: 'PROJECT_INVALID_REFERENCE',
          message: `API operation "${op.id}" references unknown resource "${op.resourceId}"`,
          path: `api.operations.${op.id}`,
        });
      }
    }
    // Check for duplicate operations.
    const opIds = new Set<string>();
    for (const op of profile.api.operations) {
      if (opIds.has(op.id)) {
        errors.push({
          code: 'PROJECT_DUPLICATE_RESOURCE',
          message: `Duplicate API operation: ${op.id}`,
          path: `api.operations`,
        });
      }
      opIds.add(op.id);
    }
    // Check for duplicate resources.
    const resIds = new Set<string>();
    for (const r of profile.api.resources) {
      if (resIds.has(r.id)) {
        errors.push({
          code: 'PROJECT_DUPLICATE_RESOURCE',
          message: `Duplicate API resource: ${r.id}`,
          path: `api.resources`,
        });
      }
      resIds.add(r.id);
    }
  } else {
    warnings.push(
      createWarning('PROJECT_NO_API', 'No API profile configured'),
    );
  }

  // --- Database cross-references ---
  if (profile.database) {
    const dbResourceIds = new Set(profile.database.resources.map((r) => r.id));
    for (const cat of profile.database.catalogs) {
      if (!dbResourceIds.has(cat.resourceId)) {
        errors.push({
          code: 'PROJECT_INVALID_REFERENCE',
          message: `DB catalog references unknown resource "${cat.resourceId}"`,
          path: `database.catalogs.${cat.resourceId}`,
        });
      }
    }
    // Check for duplicate resources.
    const dbIds = new Set<string>();
    for (const r of profile.database.resources) {
      if (dbIds.has(r.id)) {
        errors.push({
          code: 'PROJECT_DUPLICATE_RESOURCE',
          message: `Duplicate database resource: ${r.id}`,
          path: `database.resources`,
        });
      }
      dbIds.add(r.id);
    }
  } else {
    warnings.push(
      createWarning('PROJECT_NO_DATABASE', 'No database profile configured'),
    );
  }

  // --- Binding cross-references ---
  const bindingNames = new Set(profile.bindings.definitions.map((b) => b.name));
  const dupBindings = new Set<string>();
  for (const b of profile.bindings.definitions) {
    if (dupBindings.has(b.name)) {
      errors.push({
        code: 'PROJECT_DUPLICATE_RESOURCE',
        message: `Duplicate binding: ${b.name}`,
        path: `bindings.definitions`,
      });
    }
    dupBindings.add(b.name);
  }

  // --- Secret references ---
  const secretNames = new Set(profile.secrets.references.map((s) => s.name));
  const dupSecrets = new Set<string>();
  for (const s of profile.secrets.references) {
    if (dupSecrets.has(s.name)) {
      errors.push({
        code: 'PROJECT_DUPLICATE_RESOURCE',
        message: `Duplicate secret reference: ${s.name}`,
        path: `secrets.references`,
      });
    }
    dupSecrets.add(s.name);
  }

  // Check that API auth secretRefs exist.
  if (profile.api) {
    for (const r of profile.api.resources) {
      if (r.authStrategy?.secretRef && !secretNames.has(r.authStrategy.secretRef)) {
        errors.push({
          code: 'PROJECT_INVALID_REFERENCE',
          message: `API resource "${r.id}" auth secretRef "${r.authStrategy.secretRef}" not found`,
          path: `api.resources.${r.id}`,
        });
      }
    }
  }

  // Check that DB connectionSecretRefs exist.
  if (profile.database) {
    for (const r of profile.database.resources) {
      if (r.connectionSecretRef && !secretNames.has(r.connectionSecretRef)) {
        errors.push({
          code: 'PROJECT_INVALID_REFERENCE',
          message: `DB resource "${r.id}" connectionSecretRef "${r.connectionSecretRef}" not found`,
          path: `database.resources.${r.id}`,
        });
      }
    }
  }

  // --- Command envRefs ---
  const allEnvRefNames = new Set([
    ...bindingNames,
    ...secretNames,
  ]);
  const cmdIds = new Set<string>();
  for (const cmd of profile.commands.commands) {
    if (cmdIds.has(cmd.id)) {
      errors.push({
        code: 'PROJECT_DUPLICATE_RESOURCE',
        message: `Duplicate command: ${cmd.id}`,
        path: `commands.commands`,
      });
    }
    cmdIds.add(cmd.id);
    for (const ref of cmd.envRefs) {
      if (!allEnvRefNames.has(ref)) {
        warnings.push(
          createWarning(
            'PROJECT_BINDING_UNUSED',
            `Command "${cmd.id}" envRef "${ref}" not found in bindings or secrets`,
            `commands.commands.${cmd.id}`,
          ),
        );
      }
    }
    if (!cmd.safeForAutomation) {
      warnings.push(
        createWarning(
          'PROJECT_COMMAND_UNSAFE',
          `Command "${cmd.id}" is not safe for automation`,
          `commands.commands.${cmd.id}`,
        ),
      );
    }
  }

  // --- Production safety ---
  if (profile.environment.safety === 'production') {
    warnings.push(
      createWarning(
        'PROJECT_PRODUCTION_ENVIRONMENT',
        'Environment is classified as production',
        'environment',
      ),
    );
  }

  // --- Unused secret warnings ---
  const usedSecrets = new Set<string>();
  if (profile.api) {
    for (const r of profile.api.resources) {
      if (r.authStrategy?.secretRef) usedSecrets.add(r.authStrategy.secretRef);
    }
  }
  if (profile.database) {
    for (const r of profile.database.resources) {
      if (r.connectionSecretRef) usedSecrets.add(r.connectionSecretRef);
    }
  }
  for (const s of profile.secrets.references) {
    if (!usedSecrets.has(s.name)) {
      warnings.push(
        createWarning(
          'PROJECT_SECRET_REFERENCE_UNUSED',
          `Secret reference "${s.name}" is not used by any resource`,
          `secrets.references.${s.name}`,
        ),
      );
    }
  }

  // --- Unused binding warnings ---
  const usedBindings = new Set<string>();
  // Bindings referenced by commands count as used.
  for (const cmd of profile.commands.commands) {
    for (const ref of cmd.envRefs) {
      if (bindingNames.has(ref)) usedBindings.add(ref);
    }
  }
  for (const b of profile.bindings.definitions) {
    if (!usedBindings.has(b.name)) {
      warnings.push(
        createWarning(
          'PROJECT_BINDING_UNUSED',
          `Binding "${b.name}" is not referenced`,
          `bindings.definitions.${b.name}`,
        ),
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
