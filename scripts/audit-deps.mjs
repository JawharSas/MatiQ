#!/usr/bin/env node
// Dependency audit for CI. Checks the runtime dependencies of the app (npm
// workspaces) and of the Edge Functions (the npm: imports in
// supabase/functions/deno.json) against the npm advisory database.
//
// High and critical advisories fail the build unless they are listed, with a
// reason and a review date, in .github/dependency-audit-allowlist.json.
// Lower severities are printed as warnings.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const RANK = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
const FAIL_AT = RANK.high;

const allowlist = JSON.parse(readFileSync(join(root, '.github/dependency-audit-allowlist.json'), 'utf8'));
const today = new Date().toISOString().slice(0, 10);

function npmAudit(cwd) {
  let output;
  try {
    output = execFileSync('npm', ['audit', '--omit=dev', '--json'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  } catch (error) {
    // npm audit exits non-zero when it finds anything; the report is still on stdout.
    output = error.stdout;
  }
  const report = JSON.parse(output);
  // A failed lookup (network, registry) must not pass as "no advisories".
  if (report.error || !report.vulnerabilities) throw new Error(`npm audit failed in ${cwd}: ${JSON.stringify(report.error ?? report).slice(0, 300)}`);
  return report;
}

/** One finding per advisory and installed copy of the package. */
function findings(report, scope) {
  const list = [];
  for (const vulnerability of Object.values(report.vulnerabilities ?? {})) {
    for (const via of vulnerability.via) {
      if (typeof via !== 'object') continue; // inherited from a dependency, reported there
      const advisory = /GHSA-[\w-]+/.exec(via.url ?? '')?.[0] ?? String(via.source);
      for (const path of vulnerability.nodes) {
        list.push({ scope, advisory, path, severity: via.severity, title: via.title, range: via.range });
      }
    }
  }
  return list;
}

function edgeFunctionReport() {
  const { imports } = JSON.parse(readFileSync(join(root, 'supabase/functions/deno.json'), 'utf8'));
  const dependencies = {};
  for (const specifier of Object.values(imports)) {
    const match = /^npm:\/?((?:@[^/@]+\/)?[^/@]+)@([^/]+)\/?$/.exec(specifier);
    if (match) dependencies[match[1]] = match[2];
  }
  const dir = mkdtempSync(join(tmpdir(), 'matiq-audit-'));
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'edge-functions', private: true, dependencies }));
    execFileSync('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: dir, stdio: 'ignore' });
    return npmAudit(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const all = [...findings(npmAudit(root), 'app'), ...findings(edgeFunctionReport(), 'edge functions')];
const used = new Set();
let failed = false;

for (const finding of all) {
  const label = `${finding.severity.toUpperCase()} ${finding.advisory} ${finding.path} (${finding.scope}): ${finding.title}`;
  if (RANK[finding.severity] < FAIL_AT) {
    console.log(`::warning::${label}`);
    continue;
  }
  const entry = allowlist.find((item) => item.advisory === finding.advisory && item.path === finding.path && item.scope === finding.scope);
  if (!entry) {
    console.log(`::error::${label}. Update the dependency, or add a reviewed entry to .github/dependency-audit-allowlist.json.`);
    failed = true;
  } else if (entry.review_by < today) {
    console.log(`::error::${label}. The allowlist entry expired on ${entry.review_by}: review it again.`);
    failed = true;
  } else {
    used.add(entry);
    console.log(`Allowed until ${entry.review_by}: ${label}. ${entry.reason}`);
  }
}
for (const entry of allowlist) {
  if (!used.has(entry)) console.log(`::notice::Allowlist entry ${entry.advisory} ${entry.path} no longer matches anything; remove it.`);
}

console.log(failed ? 'Dependency audit failed.' : `Dependency audit passed (${all.length} advisories reviewed).`);
process.exit(failed ? 1 : 0);
