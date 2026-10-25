const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const katexRoot = path.dirname(require.resolve('katex/package.json'));
fs.copyFileSync(path.join(katexRoot, 'dist/katex.min.js'), path.join(root, 'src/lib/katex.js'));
fs.copyFileSync(path.join(katexRoot, 'LICENSE'), path.join(root, 'src/lib/katex.LICENSE'));
console.log('Bundled KaTeX', require('katex/package.json').version);
