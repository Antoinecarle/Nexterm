const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt',
  '__pycache__', '.cache', '.vscode', '.idea', 'coverage',
  'vendor', '.svn', '.hg', 'bower_components', '.turbo',
]);

const IGNORE_FILES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
  'composer.lock', 'Gemfile.lock', 'Cargo.lock',
  '.DS_Store', 'Thumbs.db',
]);

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg', '.webp',
  '.mp3', '.mp4', '.avi', '.mov', '.mkv', '.wav', '.flac',
  '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar',
  '.exe', '.dll', '.so', '.dylib', '.bin',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.sqlite', '.db', '.sqlite3',
]);

const CODE_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.scala',
  '.c', '.cpp', '.h', '.hpp', '.cs',
  '.php', '.swift', '.dart', '.lua', '.r',
  '.sh', '.bash', '.zsh', '.fish', '.ps1',
  '.sql', '.graphql', '.gql',
  '.html', '.css', '.scss', '.sass', '.less',
  '.json', '.yaml', '.yml', '.toml', '.ini', '.cfg',
  '.xml', '.md', '.mdx', '.txt', '.rst',
  '.vue', '.svelte', '.astro',
  '.dockerfile', '.env.example', '.gitignore',
  '.tf', '.hcl', '.proto',
]);

const MAX_FILE_SIZE = 1024 * 1024; // 1MB
const SMALL_FILE_THRESHOLD = 100; // lines
const LARGE_FILE_THRESHOLD = 500; // lines
const CHUNK_LINES = 60;
const CHUNK_OVERLAP = 10;
const MAX_CHUNK_CHARS = 8000;

function shouldIgnore(name, isDir) {
  if (isDir) return IGNORE_DIRS.has(name);
  if (IGNORE_FILES.has(name)) return true;
  const ext = path.extname(name).toLowerCase();
  if (BINARY_EXTENSIONS.has(ext)) return true;
  return false;
}

function isCodeFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const basename = path.basename(filePath).toLowerCase();
  if (CODE_EXTENSIONS.has(ext)) return true;
  if (['dockerfile', 'makefile', 'rakefile', 'gemfile', 'procfile'].includes(basename)) return true;
  if (basename.startsWith('.') && basename.endsWith('rc')) return true;
  return false;
}

function scanFiles(projectDir) {
  const files = [];

  function walk(dir, relativePath) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (shouldIgnore(entry.name, entry.isDirectory())) continue;

      const fullPath = path.join(dir, entry.name);
      const relPath = path.join(relativePath, entry.name);

      if (entry.isDirectory()) {
        walk(fullPath, relPath);
      } else if (entry.isFile()) {
        if (!isCodeFile(fullPath)) continue;
        try {
          const stat = fs.statSync(fullPath);
          if (stat.size > MAX_FILE_SIZE || stat.size === 0) continue;
          files.push({ fullPath, relativePath: relPath, size: stat.size });
        } catch {
          continue;
        }
      }
    }
  }

  walk(projectDir, '');
  return files;
}

function hashFile(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

// Regex patterns for code construct boundaries
const CONSTRUCT_PATTERNS = [
  /^(?:export\s+)?(?:async\s+)?function\s+\w+/,
  /^(?:export\s+)?(?:const|let|var)\s+\w+\s*=\s*(?:async\s+)?(?:\(|function)/,
  /^(?:export\s+)?class\s+\w+/,
  /^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?(?:interface|type|enum)\s+\w+/,
  /^(?:export\s+)?(?:const|let|var)\s+\w+\s*=\s*\{/, // object definitions
  /^(?:app|router|server)\.\s*(?:get|post|put|patch|delete|use)\s*\(/,
  /^def\s+\w+/,
  /^class\s+\w+/,
  /^(?:pub\s+)?(?:fn|struct|enum|impl|trait|mod)\s+/,
  /^func\s+/,
  /^(?:public|private|protected)\s+(?:static\s+)?(?:async\s+)?\w+/,
];

function isConstructBoundary(line) {
  const trimmed = line.trimStart();
  return CONSTRUCT_PATTERNS.some(p => p.test(trimmed));
}

function chunkByConstructs(lines, filePath) {
  const chunks = [];
  let currentChunk = [];
  let currentStart = 0;

  for (let i = 0; i < lines.length; i++) {
    if (isConstructBoundary(lines[i]) && currentChunk.length > 5) {
      const text = currentChunk.join('\n');
      if (text.trim().length > 0) {
        chunks.push({
          content: text.slice(0, MAX_CHUNK_CHARS),
          startLine: currentStart + 1,
          endLine: i,
          filePath,
        });
      }
      currentChunk = [];
      currentStart = i;
    }
    currentChunk.push(lines[i]);
  }

  if (currentChunk.length > 0) {
    const text = currentChunk.join('\n');
    if (text.trim().length > 0) {
      chunks.push({
        content: text.slice(0, MAX_CHUNK_CHARS),
        startLine: currentStart + 1,
        endLine: lines.length,
        filePath,
      });
    }
  }

  return chunks;
}

function chunkByLines(lines, filePath) {
  const chunks = [];
  for (let i = 0; i < lines.length; i += CHUNK_LINES - CHUNK_OVERLAP) {
    const slice = lines.slice(i, i + CHUNK_LINES);
    const text = slice.join('\n');
    if (text.trim().length === 0) continue;
    chunks.push({
      content: text.slice(0, MAX_CHUNK_CHARS),
      startLine: i + 1,
      endLine: Math.min(i + CHUNK_LINES, lines.length),
      filePath,
    });
    if (i + CHUNK_LINES >= lines.length) break;
  }
  return chunks;
}

function chunkFile(content, filePath) {
  const lines = content.split('\n');

  if (lines.length < SMALL_FILE_THRESHOLD) {
    // Small file: entire file is one chunk
    const text = content.slice(0, MAX_CHUNK_CHARS);
    if (text.trim().length === 0) return [];
    return [{
      content: text,
      startLine: 1,
      endLine: lines.length,
      filePath,
    }];
  }

  if (lines.length <= LARGE_FILE_THRESHOLD) {
    // Medium file: chunk by constructs
    const chunks = chunkByConstructs(lines, filePath);
    // If construct chunking produces only 1 chunk (no constructs found), fall back to line chunking
    if (chunks.length <= 1 && lines.length > SMALL_FILE_THRESHOLD) {
      return chunkByLines(lines, filePath);
    }
    return chunks;
  }

  // Large file: chunk by lines with overlap
  return chunkByLines(lines, filePath);
}

module.exports = { scanFiles, hashFile, chunkFile };
