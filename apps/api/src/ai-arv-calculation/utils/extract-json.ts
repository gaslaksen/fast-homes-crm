// Extract the largest top-level JSON object from a string by counting
// braces with quote/escape awareness. Survives JSON containing braces
// inside strings, nested objects, and prose before/after.
//
// Mirrors the helper in ai-comp-curation/ai-comp-curation.service.ts —
// kept inline rather than shared because cross-module import paths in
// this codebase prefer module-local utilities.
export function extractLargestJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  return null;
}
