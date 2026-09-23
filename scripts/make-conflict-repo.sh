#!/bin/sh
# Build throwaway repos stuck mid-conflict, one per operation the conflict
# resolver handles (see readMergeState / mapConflictKind in src/main.ts), so the
# resolver can be exercised by opening each repo in a tab. Re-running wipes and
# rebuilds everything, so resolve/abort freely and just run it again.
#
#   sh scripts/make-conflict-repo.sh [target-dir]
#
# Default target: ~/leviathan-conflicts (visible in the Open dialog, unlike $TMPDIR)
set -eu

ROOT="${1:-$HOME/leviathan-conflicts}"
ROOT="${ROOT%/}"
rm -rf "$ROOT"
mkdir -p "$ROOT"

# Fresh repo on `main` with a local identity, so it works on any machine.
new_repo() {
  dir="$ROOT/$1"
  git init -q "$dir"
  cd "$dir"
  git symbolic-ref HEAD refs/heads/main
  git config user.name 'Conflict Fixture'
  git config user.email 'fixture@example.com'
  git config commit.gpgsign false
  git config core.autocrlf false
}

commit() { git add -A && git commit -qm "$1"; }

# Print 1..n as "line N", one per line.
lines() { i=1; while [ "$i" -le "$1" ]; do echo "line $i"; i=$((i + 1)); done; }

# A file with several hunks: `side` edits lines 3 and 15 (conflicting) plus a
# side-specific line (which auto-merges cleanly).
multi_hunk() {
  side=$1 own=$2
  lines 20 | sed \
    -e "s/^line 3\$/line 3 changed on $side/" \
    -e "s/^line 15\$/line 15 changed on $side/" \
    -e "s/^line $own\$/line $own only touched by $side/"
}

# Real 64x64 PNGs, different per side, so the resolver's image preview has
# something to show: base = grey circle, main = green circle, feature = teal square.
PNG_base='iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAlklEQVR42u3awRWAIAwE0fRfwNZpCbYAPHDDOlNB/k0T6rm8AgAAAAAAAADkADRWO4BW8wO0IxtA+zIAtLvvADrZcYDOB8A6/ayhGk4/Zaie048b/gGQLwABALkDAAAAAAAAAAAAwOc0ACeAn/oGgOv3QgmbOZa7PQDX3wcSLjQhN7KEK2XCnTjkUs9jDwAAAAAAAGCtF7rkxn0v2HZCAAAAAElFTkSuQmCC'
PNG_main='iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAApUlEQVR42u3aURWAIBBE0UlkCYsS0QhWWEDcYXkcA7z7p4x6Nj8CAAAAAAAAANQBXO2OPHaAYPcKibLSv2IovX7SIIf6GYMc0mcYsqofMBwG+KG+1yDD+i6DPOvjhjMAKfVBAwB/QGJ9xAAAAAAAAAAAAACA12kAawF81BsAtr8XqnAzx+WuB2D7faDCQlNkI6uwUlbYiYss9fzsAQAAAAAAAIydF+mUsCjL/oEoAAAAAElFTkSuQmCC'
PNG_feature='iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAWUlEQVR42u3ZQQ0AMAgEQZzUMgrQiISqIKTNXNbAvC/68QUAAAAAAAAAwDDgVK4EAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAALAD8NQDAAAAAAAAfAq4WhGPTv11O/UAAAAASUVORK5CYII='
binary() { eval "printf '%s' \"\$PNG_$1\"" | base64 -d; }

# A realistic source file for the line-by-line editor: several conflicts of
# different shapes (2 vs 3 lines, 4 vs 8, one side empty, 1 vs 4, a one-line
# tweak, both appending at EOF) with auto-merged edits in between.
service_base() {
  cat <<'JS'
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const DEFAULT_PORT = 3000;
const DEFAULT_HOST = 'localhost';
const TIMEOUT_MS = 5000;

// ---------------------------------------------------------------------------

export async function loadConfig(dir) {
  const raw = await readFile(join(dir, 'config.json'), 'utf8');
  const config = JSON.parse(raw);
  return config;
}

// ---------------------------------------------------------------------------

export function normalize(config) {
  // Legacy keys, kept for old config files.
  if (config.hostname) config.host = config.hostname;
  if (config.portNumber) config.port = config.portNumber;
  return config;
}

// ---------------------------------------------------------------------------

export function describe(config) {
  return `${config.host}:${config.port}`;
}

// ---------------------------------------------------------------------------

export function startServer(config) {
  const port = config.port ?? DEFAULT_PORT;
  const host = config.host ?? DEFAULT_HOST;
  console.log('starting on', host, port);
  const server = createServer(handler);
  server.listen(port, host);
  return server;
}

// ---------------------------------------------------------------------------

export function stopServer(server) {
  server.close();
}
JS
}

service_main() {
  cat <<'JS'
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { logger } from './logger.js';

const DEFAULT_PORT = 3000;
const DEFAULT_HOST = 'localhost';
const TIMEOUT_MS = 5000;

// ---------------------------------------------------------------------------

export async function loadConfig(dir) {
  const file = join(dir, 'config.json');
  logger.debug('loading config from', file);
  const config = JSON.parse(await readFile(file, 'utf8'));
  return config;
}

// ---------------------------------------------------------------------------

export function normalize(config) {
  return config;
}

// ---------------------------------------------------------------------------

export function describe(config) {
  return `http://${config.host}:${config.port}`;
}

// ---------------------------------------------------------------------------

export function startServer(config) {
  const port = config.port ?? DEFAULT_PORT;
  const host = config.host ?? DEFAULT_HOST;
  logger.info(`starting on ${host}:${port}`);
  const server = createServer(handler);
  server.listen(port, host);
  return server;
}

// ---------------------------------------------------------------------------

export function stopServer(server) {
  server.close();
}

export function restartServer(server, config) {
  stopServer(server);
  return startServer(config);
}
JS
}

service_feature() {
  cat <<'JS'
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer } from 'node:https';
import { readFileSync } from 'node:fs';
import { z } from 'zod';

const DEFAULT_PORT = 3000;
const DEFAULT_HOST = 'localhost';
const TIMEOUT_MS = 10000;

// ---------------------------------------------------------------------------

export async function loadConfig(dir) {
  const path = join(dir, 'config.json');
  let raw;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return {};
  }
  return ConfigSchema.parse(JSON.parse(raw));
}

// ---------------------------------------------------------------------------

export function normalize(config) {
  // Legacy keys, kept for old config files (removed in v3).
  if (config.hostname) config.host = config.hostname;
  if (config.portNumber) config.port = Number(config.portNumber);
  return config;
}

// ---------------------------------------------------------------------------

export function describe(config) {
  const scheme = config.tls ? 'https' : 'http';
  const host = config.host ?? DEFAULT_HOST;
  const port = config.port ?? DEFAULT_PORT;
  return `${scheme}://${host}:${port}`;
}

// ---------------------------------------------------------------------------

export function startServer(config) {
  const port = config.port ?? DEFAULT_PORT;
  const host = config.host ?? DEFAULT_HOST;
  console.log('starting on', host, port, config.tls ? '(tls)' : '');
  const server = createServer(handler);
  server.listen(port, host);
  return server;
}

// ---------------------------------------------------------------------------

export function stopServer(server) {
  server.close();
}

export function reloadCertificates(server, config) {
  const cert = readFileSync(config.tls.cert);
  const key = readFileSync(config.tls.key);
  server.setSecureContext({ cert, key });
}
JS
}

# Merge scenario covering every conflict kind: UU, AA, UD, DU, rename/rename
# (DD + AU + UA), binary, and CRLF text.
build_merge() {
  new_repo "$1"
  [ "${2:-}" = diff3 ] && git config merge.conflictStyle diff3

  lines 20 > multi.txt
  service_base > service.js
  printf 'keep\nshared\n' > edit-vs-delete.txt
  printf 'keep\nshared\n' > delete-vs-edit.txt
  printf 'original name\n' > renamed.txt
  binary base > image.png
  printf 'alpha\r\nbeta\r\ngamma\r\n' > crlf.txt
  commit 'base'

  git switch -qc feature
  multi_hunk feature 8 > multi.txt
  service_feature > service.js
  printf 'added on feature\n' > both-added.txt
  git rm -q edit-vs-delete.txt
  printf 'keep\nedited on feature\n' > delete-vs-edit.txt
  git mv renamed.txt renamed-by-feature.txt
  binary feature > image.png
  printf 'alpha\r\nbeta from feature\r\ngamma\r\n' > crlf.txt
  commit 'feature changes'

  git switch -q main
  multi_hunk main 11 > multi.txt
  service_main > service.js
  printf 'added on main\n' > both-added.txt
  printf 'keep\nedited on main\n' > edit-vs-delete.txt
  git rm -q delete-vs-edit.txt
  git mv renamed.txt renamed-by-main.txt
  binary main > image.png
  printf 'alpha\r\nbeta from main\r\ngamma\r\n' > crlf.txt
  commit 'main changes'

  git merge feature >/dev/null 2>&1 || true
}

# Rebase of three commits, each conflicting with main -> stops at step 1/3.
build_rebase() {
  new_repo rebase
  printf 'one\ntwo\nthree\n' > a.txt
  printf 'one\ntwo\nthree\n' > b.txt
  printf 'one\ntwo\nthree\n' > c.txt
  commit 'base'

  git switch -qc feature
  for f in a b c; do
    sed 's/^two$/two from feature/' "$f.txt" > tmp && mv tmp "$f.txt"
    commit "feature: edit $f.txt"
  done

  git switch -q main
  for f in a b c; do sed 's/^two$/two from main/' "$f.txt" > tmp && mv tmp "$f.txt"; done
  commit 'main: edit a, b, c'

  git switch -q feature
  git rebase main >/dev/null 2>&1 || true
}

build_cherry_pick() {
  new_repo cherry-pick
  printf 'header\nbody\nfooter\n' > notes.txt
  commit 'base'

  git switch -qc feature
  printf 'header\nbody from feature\nfooter\n' > notes.txt
  commit 'feature: rewrite body'
  pick=$(git rev-parse HEAD)

  git switch -q main
  printf 'header\nbody from main\nfooter\n' > notes.txt
  commit 'main: rewrite body'

  git cherry-pick "$pick" >/dev/null 2>&1 || true
}

build_revert() {
  new_repo revert
  printf 'a\nb\nc\n' > config.txt
  commit 'base'
  printf 'a\nb = 1\nc\n' > config.txt
  commit 'set b = 1'
  target=$(git rev-parse HEAD)
  printf 'a\nb = 2\nc\n' > config.txt
  commit 'set b = 2'

  git revert --no-edit "$target" >/dev/null 2>&1 || true
}

build_stash_pop() {
  new_repo stash-pop
  printf 'title\ncontent\nend\n' > draft.txt
  commit 'base'
  printf 'title\ncontent from stash\nend\n' > draft.txt
  git stash -q
  printf 'title\ncontent from commit\nend\n' > draft.txt
  commit 'conflicting edit'

  git stash pop >/dev/null 2>&1 || true
}

build_merge merge
build_merge diff3 diff3
build_rebase
build_cherry_pick
build_revert
build_stash_pop

echo "Conflicted repos in $ROOT:"
for d in merge diff3 rebase cherry-pick revert stash-pop; do
  echo "  $ROOT/$d"
done
