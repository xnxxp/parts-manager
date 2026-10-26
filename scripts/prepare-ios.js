// Create an isolated iOS Cordova project without changing the Android sources.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const destination = path.join(root, 'build/ios-project');
const version = require('../package.json').version;
const settings = require('../ios/build-settings.json');
const bundleId = process.env.IOS_BUNDLE_ID || settings.bundleId;
if (!/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(bundleId)) throw new Error('Invalid IOS_BUNDLE_ID');
fs.mkdirSync(destination, { recursive: true });
fs.cpSync(path.join(root, 'www'), path.join(destination, 'www'), { recursive: true });
fs.cpSync(path.join(root, 'ios/parts-native'), path.join(destination, 'local-plugins/parts-ios'), { recursive: true });
for (const name of ['app', 'parts', 'export']) {
    const file = path.join(destination, `www/js/${name}.js`);
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replaceAll('AndroidBridge', 'IOSBridge'));
}
let html = fs.readFileSync(path.join(destination, 'www/index.html'), 'utf8');
if (!html.includes('<script src="js/export.js"></script>')) throw new Error('Shared script order changed; review iOS adapter loading');
html = html.replace('<script src="js/database.js"></script>', '<script src="cordova.js"></script>\n<script src="js/database.js"></script>')
    .replace('<script src="js/export.js"></script>', '<script src="js/export.js"></script>\n<script src="js/ios-platform.js"></script>')
    .replace('退出时自动存到 Download/PartsManager', '自动保存到本机应用文件夹；卸载应用会删除')
    .replace('保存到手机 Downloads 文件夹', '在“文件”中选择保存位置')
    .replace('本 App 数据保存在手机本地，若误点「清除应用数据」会全部丢失。', '本 App 数据保存在手机本地，卸载应用会删除本机数据与本机备份。')
    .replace('已为你开启「退出时自动备份」，文件保存到手机 <b>Download/PartsManager</b> 文件夹（清应用数据也不会丢）。',
        '已开启本机自动备份，在“文件”App 的 <b>我的 iPhone / 配件库存管理 / Backups</b> 中查看。请定期手动导出到 iCloud Drive 或其他位置。');
fs.writeFileSync(path.join(destination, 'www/index.html'), html);
fs.copyFileSync(path.join(root, 'ios/web/ios-platform.js'), path.join(destination, 'www/js/ios-platform.js'));
fs.appendFileSync(path.join(destination, 'www/css/style.css'), '\n/* iOS touch and safe-area adjustments */\ninput, select, textarea { font-size: 16px !important; }\n#modal-image-viewer > .modal-close { top: calc(16px + env(safe-area-inset-top)); }\n');
fs.writeFileSync(path.join(destination, 'config.xml'), `<?xml version="1.0" encoding="utf-8"?>
<widget id="${bundleId}" version="${version}" xmlns="http://www.w3.org/ns/widgets" xmlns:cdv="http://cordova.apache.org/ns/1.0">
    <name>PartsManager</name>
    <description>配件库存管理</description>
    <content src="index.html" />
    <access origin="*" />
    <allow-intent href="https://*/*" />
    <platform name="ios">
        <preference name="deployment-target" value="${settings.minimumIOSVersion}" />
        <preference name="Orientation" value="portrait" />
        <preference name="DisallowOverscroll" value="true" />
        <preference name="scheme" value="app" />
        <preference name="hostname" value="localhost" />
    </platform>
</widget>
`);
fs.writeFileSync(path.join(destination, 'package.json'), JSON.stringify({ name: 'parts-manager-ios', version, private: true,
    description: 'Isolated iOS build for PartsManager', cordova: { platforms: [], plugins: {} } }, null, 2) + '\n');
console.log(destination);
