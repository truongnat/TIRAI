import * as fs from 'node:fs';
import * as path from 'node:path';

export interface ProjectDetection {
  projectName?: string;
  language: string;
  packageManager?: string;
  playwrightDetected: boolean;
  vitestDetected: boolean;
  tsconfigDetected: boolean;
}

export function detectProject(projectRoot: string): ProjectDetection {
  const root = path.resolve(projectRoot);
  let projectName: string | undefined;
  const language: string = 'typescript';
  let packageManager: string | undefined;
  let playwrightDetected = false;
  let vitestDetected = false;
  let tsconfigDetected = false;

  // package.json
  const pkgPath = path.join(root, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (typeof pkg.name === 'string') projectName = pkg.name;
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps['@playwright/test'] || deps['playwright']) playwrightDetected = true;
      if (deps['vitest']) vitestDetected = true;
    } catch {
      // ignore
    }
    // package manager lockfiles
    if (fs.existsSync(path.join(root, 'pnpm-lock.yaml'))) packageManager = 'pnpm';
    else if (fs.existsSync(path.join(root, 'yarn.lock'))) packageManager = 'yarn';
    else if (fs.existsSync(path.join(root, 'package-lock.json'))) packageManager = 'npm';
    else if (fs.existsSync(path.join(root, 'bun.lockb'))) packageManager = 'bun';
  }

  if (fs.existsSync(path.join(root, 'tsconfig.json'))) tsconfigDetected = true;
  if (fs.existsSync(path.join(root, 'playwright.config.ts')) || fs.existsSync(path.join(root, 'playwright.config.js'))) playwrightDetected = true;
  if (fs.existsSync(path.join(root, 'vitest.config.ts')) || fs.existsSync(path.join(root, 'vitest.config.js')) || fs.existsSync(path.join(root, 'vitest.config.mjs'))) vitestDetected = true;

  // fallback: if no package.json, check for .tirai parent
  if (!projectName) projectName = path.basename(root);

  return {
    projectName,
    language,
    packageManager,
    playwrightDetected,
    vitestDetected,
    tsconfigDetected,
  };
}
