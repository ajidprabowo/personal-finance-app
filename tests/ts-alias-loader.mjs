import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const WORKSPACE_ROOT = process.cwd();

function resolveCandidateFile(basePath) {
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.js`,
    `${basePath}.mjs`,
    path.join(basePath, 'index.ts'),
    path.join(basePath, 'index.tsx'),
    path.join(basePath, 'index.js'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return pathToFileURL(candidate).href;
    }
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const relativeTarget = specifier.slice(2);
    const resolvedUrl = resolveCandidateFile(path.resolve(WORKSPACE_ROOT, relativeTarget));
    if (resolvedUrl) {
      return { url: resolvedUrl, shortCircuit: true };
    }
  }

  if (
    (specifier.startsWith('./') || specifier.startsWith('../')) &&
    context.parentURL &&
    context.parentURL.startsWith('file://') &&
    !context.parentURL.includes('/node_modules/')
  ) {
    const parentDir = path.dirname(new URL(context.parentURL).pathname);
    const resolvedUrl = resolveCandidateFile(path.resolve(parentDir, specifier));
    if (resolvedUrl) {
      return { url: resolvedUrl, shortCircuit: true };
    }
  }

  return nextResolve(specifier, context);
}
