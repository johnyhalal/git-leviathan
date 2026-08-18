#!/usr/bin/env node
// Builds the GitHub Release body from the commits between the previous release
// tag and HEAD. We commit straight to dev/main with no PRs, so GitHub's own
// "generate release notes" (which lists merged PRs) would come out empty —
// conventional-commit subjects are the only changelog this repo has.
//
//   node scripts/release-notes.mjs [--tag v0.7.0] [--prev v0.6.5]
//
// Prints markdown on stdout. Exits non-zero only on a broken git invocation.

import { execFileSync } from 'node:child_process';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : '';
};

const pkgVersion = JSON.parse(
  execFileSync('node', ['-p', 'JSON.stringify(require("./package.json"))'], { encoding: 'utf8' }),
).version;

const tag = arg('tag') || `v${pkgVersion}`;

// Highest existing v* tag that isn't the one we're about to publish. `sort -V`
// semantics come free from git's own version:refname sort.
const previous =
  arg('prev') ||
  git('tag', '--list', 'v*', '--sort=-v:refname')
    .split('\n')
    .map((t) => t.trim())
    .filter((t) => t && t !== tag)[0] ||
  '';

const range = previous ? `${previous}..HEAD` : 'HEAD';
const log = git('log', range, '--no-merges', '--format=%h%x1f%s');

// type(scope): subject — scope optional, `!` marks a breaking change.
const CONVENTIONAL = /^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/;

// Everything not listed here lands in "Maintenance"; `chore` version bumps are
// noise on a release page that already carries the version in its title.
const SECTIONS = [
  { key: 'breaking', title: '### ⚠️ Breaking changes' },
  { key: 'feat', title: '### ✨ Features' },
  { key: 'fix', title: '### 🐛 Fixes' },
  { key: 'perf', title: '### ⚡ Performance' },
  { key: 'other', title: '### 🧹 Maintenance' },
];

const buckets = new Map(SECTIONS.map((s) => [s.key, []]));

for (const line of log.split('\n').filter(Boolean)) {
  const [hash, subject] = line.split('\x1f');
  const match = CONVENTIONAL.exec(subject);
  const type = match ? match[1] : '';
  const scope = match ? match[2] : '';
  const breaking = match ? Boolean(match[3]) : false;
  const text = match ? match[4] : subject;

  if (type === 'chore' && /^bump version/i.test(text)) continue;

  const key = breaking ? 'breaking' : buckets.has(type) ? type : 'other';
  buckets.get(key).push(`- ${scope ? `**${scope}**: ` : ''}${text} (${hash})`);
}

const slug = (process.env.GITHUB_REPOSITORY || '').trim() ||
  (git('remote', 'get-url', 'origin').match(/github\.com[:/](.+?)(?:\.git)?$/)?.[1] ?? '');

const body = [];
for (const { key, title } of SECTIONS) {
  const items = buckets.get(key);
  if (items.length) body.push(title, '', ...items, '');
}
if (!body.length) body.push('_No notable changes._', '');

if (slug && previous) {
  body.push(`**Full changelog**: https://github.com/${slug}/compare/${previous}...${tag}`);
}

process.stdout.write(body.join('\n').trim() + '\n');
