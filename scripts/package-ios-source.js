const fs = require('node:fs');
const path = require('node:path');
const JSZip = require('../www/libs/jszip.min.js');
const root = path.resolve(__dirname, '..');
const version = require('../package.json').version;
const zip = new JSZip();
function add(name) {
    const file = path.join(root, name);
    if (fs.statSync(file).isDirectory()) {
        for (const child of fs.readdirSync(file)) add(name + '/' + child);
    } else {
        if (/\.(p12|p8|pem|key|mobileprovision)$/i.test(name)) throw new Error('Signing material must not be in the source archive');
        zip.file(name, fs.readFileSync(file));
    }
}
for (const name of ['www', 'ios', 'tests', 'package.json', 'package-lock.json', 'config.xml', 'README.md', '.github/workflows/build-ios.yml',
    'scripts/prepare-ios.js', 'scripts/package-ios-source.js', 'scripts/serve.js']) add(name);
zip.file('.gitignore', 'node_modules/\nbuild/\n*.p12\n*.p8\n*.key\n*.mobileprovision\n.DS_Store\n');
fs.mkdirSync(path.join(root, 'build'), { recursive: true });
const file = path.join(root, `build/parts-manager-ios-source-${version}.zip`);
zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }).then(data => {
    fs.writeFileSync(file, data);
    console.log(file);
}).catch(error => { console.error(error.message); process.exitCode = 1; });
