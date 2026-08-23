// Profile selectors — helper functions for extracting profile slices.
//
// Avoids giant direct object traversal in downstream code.

import type {
  ProjectExecutionProfile,
  UIProjectProfile,
  APIProjectProfile,
  DatabaseProjectProfile,
  ProjectEnvironmentDefinition,
  RuntimeBindingDefinition,
  SecretReferenceDefinition,
  ProjectCommandDefinition,
} from './models.js';

export function getUIProfile(
  profile: ProjectExecutionProfile,
): UIProjectProfile | undefined {
  return profile.ui;
}

export function getAPIProfile(
  profile: ProjectExecutionProfile,
): APIProjectProfile | undefined {
  return profile.api;
}

export function getDatabaseProfile(
  profile: ProjectExecutionProfile,
): DatabaseProjectProfile | undefined {
  return profile.database;
}

export function getEnvironment(
  profile: ProjectExecutionProfile,
): ProjectEnvironmentDefinition {
  return profile.environment;
}

export function getBinding(
  profile: ProjectExecutionProfile,
  name: string,
): RuntimeBindingDefinition | undefined {
  return profile.bindings.definitions.find((b) => b.name === name);
}

export function getSecretRef(
  profile: ProjectExecutionProfile,
  name: string,
): SecretReferenceDefinition | undefined {
  return profile.secrets.references.find((s) => s.name === name);
}

export function getCommand(
  profile: ProjectExecutionProfile,
  id: string,
): ProjectCommandDefinition | undefined {
  return profile.commands.commands.find((c) => c.id === id);
}
