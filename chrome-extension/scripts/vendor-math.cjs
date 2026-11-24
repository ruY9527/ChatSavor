const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const katexRoot = path.dirname(require.resolve('katex/package.json'));
let source = fs.readFileSync(path.join(katexRoot, 'dist/katex.min.js'), 'utf8');
// Suppress KaTeX's load-time quirks-mode console.warn in blank about:blank subframes.
// ChatSavor renders output: "mathml" inside isolated Shadow DOM, which never depends on host compatMode.
if (!source.includes('"CSS1Compat"!==document.compatMode')) {
  throw new Error('Expected KaTeX quirks-mode check was not found in katex.min.js');
}
source = source.replace('"CSS1Compat"!==document.compatMode', 'false');
fs.writeFileSync(path.join(root, 'src/lib/katex.js'), source);
fs.copyFileSync(path.join(katexRoot, 'LICENSE'), path.join(root, 'src/lib/katex.LICENSE'));
console.log('Bundled KaTeX', require('katex/package.json').version);
