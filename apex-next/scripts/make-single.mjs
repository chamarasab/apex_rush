import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const srcHtmlPath = path.join(projectRoot, 'dist', 'index.html');
const outDir = path.resolve(projectRoot, '..', 'apex-next-single');
const outHtmlPath = path.join(outDir, 'index.html');

const html = fs.readFileSync(srcHtmlPath, 'utf8');
const scriptRe = /<script\b[^>]*>([\s\S]*?)<\/script>/i;
const match = html.match(scriptRe);

if (!match) {
  throw new Error(`Could not locate bundled inline <script> in ${srcHtmlPath}`);
}

const jsBody = match[1];
const wrappedJs = `(() => {\n'use strict';\n${jsBody}\n})();`;

// Validate classic non-module JS syntax so opening via file:// works in every browser
new vm.Script(wrappedJs, { filename: 'apex-next-single.js' });

// Prevent premature </script> closing inside HTML parser if present in minified code
const safeJs = wrappedJs.replace(/<\/script>/gi, '<\\/script>');
const withoutHeadScript = html.replace(scriptRe, '');

const bodyCloseIdx = withoutHeadScript.lastIndexOf('</body>');
if (bodyCloseIdx === -1) {
  throw new Error('Could not locate </body> closing tag in bundled HTML');
}

const singleHtml =
  withoutHeadScript.slice(0, bodyCloseIdx) +
  `<script>\n${safeJs}\n</script>\n` +
  withoutHeadScript.slice(bodyCloseIdx);

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outHtmlPath, singleHtml, 'utf8');

const kb = (Buffer.byteLength(singleHtml, 'utf8') / 1024).toFixed(1);
console.log(`Generated standalone HTML: ${outHtmlPath} (${kb} KB)`);

