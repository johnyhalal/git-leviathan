import hljs from 'highlight.js/lib/common';

/**
 * Syntax highlighting for the diff/file viewer, built on highlight.js's
 * "common" bundle (~40 mainstream languages). We resolve a language from the
 * file's name and hand back pre-highlighted, HTML-escaped markup so the
 * renderer can drop it in via `dangerouslySetInnerHTML` — hljs escapes all
 * text itself, so nothing from a file's contents reaches the DOM as raw HTML.
 *
 * The diff view highlights line-by-line (add/delete/context lines aren't a
 * contiguous, valid program), while the full-file view highlights the whole
 * buffer at once so multi-line constructs (block comments, template strings)
 * stay correct, then splits the result back into per-line markup.
 */

/** Extension → highlight.js language (canonical names, not aliases). */
const EXT_TO_LANG: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  jsonc: 'json',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'xml',
  htm: 'xml',
  xml: 'xml',
  svg: 'xml',
  vue: 'xml',
  md: 'markdown',
  markdown: 'markdown',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  swift: 'swift',
  c: 'c',
  h: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  hh: 'cpp',
  cs: 'csharp',
  php: 'php',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  sql: 'sql',
  pl: 'perl',
  lua: 'lua',
  r: 'r',
  dart: 'dart',
  scala: 'scala',
  gradle: 'gradle',
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  diff: 'diff',
  patch: 'diff',
};

/** Full-filename → language, for extensionless files git commonly tracks. */
const FILENAME_TO_LANG: Record<string, string> = {
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  '.gitignore': 'plaintext',
  '.gitattributes': 'plaintext',
};

/** The language highlight.js should use for a path, or null when unsupported. */
export function languageForPath(path: string): string | null {
  const name = (path.split('/').pop() ?? path).toLowerCase();

  const byName = FILENAME_TO_LANG[name];
  if (byName) return hljs.getLanguage(byName) ? byName : null;

  const dot = name.lastIndexOf('.');
  const ext = dot === -1 ? name : name.slice(dot + 1);
  const lang = EXT_TO_LANG[ext];
  return lang && hljs.getLanguage(lang) ? lang : null;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Highlight one line in isolation; returns safe HTML (escaped when no lang). */
export function highlightLine(text: string, lang: string | null): string {
  if (!lang || text === '') return escapeHtml(text);
  try {
    return hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
  } catch {
    return escapeHtml(text);
  }
}

/**
 * Highlight a full buffer and return one HTML string per source line. Spans
 * that straddle a newline are closed at the line break and re-opened on the
 * next line so every line is independently well-formed markup.
 */
export function highlightBuffer(code: string, lang: string | null): string[] {
  if (!lang) return code.split('\n').map(escapeHtml);
  let html: string;
  try {
    html = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
  } catch {
    return code.split('\n').map(escapeHtml);
  }
  return splitHighlightedLines(html);
}

/** Split hljs markup on newlines while keeping the open-span stack balanced. */
function splitHighlightedLines(html: string): string[] {
  const lines: string[] = [];
  const openStack: string[] = [];
  let current = '';
  let i = 0;

  while (i < html.length) {
    if (html[i] === '<') {
      const end = html.indexOf('>', i);
      const tag = html.slice(i, end + 1);
      if (tag[1] === '/') openStack.pop();
      else openStack.push(tag);
      current += tag;
      i = end + 1;
      continue;
    }
    let next = html.indexOf('<', i);
    if (next === -1) next = html.length;
    const parts = html.slice(i, next).split('\n');
    for (let p = 0; p < parts.length; p++) {
      if (p > 0) {
        current += '</span>'.repeat(openStack.length);
        lines.push(current);
        current = openStack.join('');
      }
      current += parts[p];
    }
    i = next;
  }

  lines.push(current);
  return lines;
}
