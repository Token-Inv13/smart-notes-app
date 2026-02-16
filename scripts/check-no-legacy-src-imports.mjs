import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const WEB_SRC_DIR = join(ROOT, 'apps', 'web', 'src');
const TARGET_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);

const FORBIDDEN_PATTERNS = [
  {
    id: 'relative-legacy-src-import',
    regex: /(?:from\s+['"]|import\s*\(\s*['"])(?:\.\.\/)+src\//g,
    message: "Import relatif interdit vers le legacy root/src depuis apps/web.",
  },
  {
    id: 'absolute-legacy-src-path',
    regex: /smart-notes-app\/(?:src)\//g,
    message: 'Chemin absolu legacy root/src détecté.',
  },
];

async function listFilesRecursively(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '.next' || entry.name === 'node_modules') continue;
      files.push(...(await listFilesRecursively(abs)));
      continue;
    }

    const ext = entry.name.slice(entry.name.lastIndexOf('.'));
    if (!TARGET_EXTENSIONS.has(ext)) continue;
    files.push(abs);
  }

  return files;
}

async function main() {
  const files = await listFilesRecursively(WEB_SRC_DIR);
  const violations = [];

  for (const file of files) {
    const content = await readFile(file, 'utf8');

    for (const rule of FORBIDDEN_PATTERNS) {
      const matches = [...content.matchAll(rule.regex)];
      for (const match of matches) {
        const index = typeof match.index === 'number' ? match.index : 0;
        const line = content.slice(0, index).split('\n').length;
        violations.push({
          ruleId: rule.id,
          message: rule.message,
          file: relative(ROOT, file),
          line,
          snippet: String(match[0]),
        });
      }
    }
  }

  if (violations.length === 0) {
    console.log('[legacy-src-guard] OK: aucun import legacy root/src détecté dans apps/web/src.');
    return;
  }

  console.error(`[legacy-src-guard] ${violations.length} violation(s) détectée(s):`);
  for (const violation of violations) {
    console.error(`- ${violation.file}:${violation.line} [${violation.ruleId}] ${violation.message} -> ${violation.snippet}`);
  }

  process.exitCode = 1;
}

void main();
