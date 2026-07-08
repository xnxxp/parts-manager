const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BASE = 'D:/APK';
const JAVA = 'C:/Program Files/Eclipse Adoptium/jdk-17.0.19.10-hotspot';
const SDK = 'E:/SDK';
const GRADLE = 'C:/gradle-8.10.2/gradle-8.10.2';

process.env.JAVA_HOME = JAVA;
process.env.ANDROID_HOME = SDK;
process.env.Path = GRADLE + '/bin;' + JAVA + '/bin;' + SDK + '/cmdline-tools/latest/bin;' + SDK + '/platform-tools;' + process.env.Path;

function copyRecursive(src, dst) {
    if (fs.existsSync(dst)) fs.rmSync(dst, { recursive: true });
    fs.mkdirSync(dst, { recursive: true });
    fs.readdirSync(src).forEach(f => {
        const s = path.join(src, f);
        const d = path.join(dst, f);
        if (fs.statSync(s).isDirectory()) copyRecursive(s, d);
        else fs.copyFileSync(s, d);
    });
}

function run(cmd, opts) {
    console.log('  > ' + cmd);
    try {
        return execSync(cmd, { encoding: 'utf8', timeout: 1800000, stdio: 'pipe', ...opts });
    } catch (e) {
        const out = (e.stdout || '') + (e.stderr || '');
        console.log('--- OUTPUT (last 3000) ---');
        console.log(out.slice(-3000));
        console.log('--------------------------');
        throw e;
    }
}

async function main() {
    console.log('============================================');
    console.log('  Parts Manager - Build APK');
    console.log('============================================\n');

    // Step 0: Version bump
    console.log('[0/5] Auto version bump...');
    const vf = path.join(BASE, 'VERSION.txt');
    let vr = fs.existsSync(vf) ? fs.readFileSync(vf, 'utf8').trim() : '2.0.0';
    if (!vr) vr = '2.0.0';
    const parts = vr.split('.');
    parts[2] = String(parseInt(parts[2]) + 1);
    const newVer = parts.join('.');
    fs.writeFileSync(vf, newVer + '\n');
    console.log('  ' + vr + ' -> ' + newVer + '\n');

    // Step 1: Clean
    console.log('[1/5] Cleaning...');
    for (const p of [
        path.join(BASE, 'platforms/android/app/build'),
        path.join(BASE, 'platforms/android/.gradle')
    ]) {
        if (fs.existsSync(p)) {
            try { execSync('rmdir /s /q "' + p + '"', { timeout: 30000 }); } catch(e) {}
        }
    }
    console.log('  Cleaned\n');

    // Step 2: Sync www/ contents directly into destination root
    // Cordova packages from platform_www/ root and assets/ root
    console.log('[2/5] Syncing web assets...');
    const srcWww = path.join(BASE, 'www');
    const dst1 = path.join(BASE, 'platforms/android/platform_www');
    const dst2 = path.join(BASE, 'platforms/android/app/src/main/assets');

    // Remove old root files and any stale www/ subdirectory
    for (const dst of [dst1, dst2]) {
        // Remove old root-level files that Cordova packages from
        const oldRootFiles = ['index.html', 'config.xml', 'cordova.js', 'service-worker.js'];
        for (const f of oldRootFiles) {
            const fp = path.join(dst, f);
            if (fs.existsSync(fp)) fs.unlinkSync(fp);
        }
        // Remove old subdirectories
        const oldDirs = ['css', 'img', 'js', 'libs', 'plugins', 'www', 'manifest.json'];
        for (const d of oldDirs) {
            const dp = path.join(dst, d);
            if (fs.existsSync(dp)) fs.rmSync(dp, { recursive: true });
        }
        // Now copy fresh www/ contents into root
        copyRecursive(srcWww, dst);
    }
    console.log('  Synced\n');

    // Step 2.5: Force wrapper to use local gradle (Cordova resets it)
    console.log('[2.5/5] Patching gradle wrapper...');
    const wrapperProps = path.join(BASE, 'platforms/android/gradle/wrapper/gradle-wrapper.properties');
    if (fs.existsSync(wrapperProps)) {
        let content = fs.readFileSync(wrapperProps, 'utf8');
        if (content.includes('services.gradle.org')) {
            content = content.replace(
                /distributionUrl=.*/,
                'distributionUrl=file\\:///C:/gradle-8.10.2/gradle-8.10.2'
            );
            fs.writeFileSync(wrapperProps, content);
            console.log('  Patched wrapper to local gradle\n');
        } else {
            console.log('  Already using local gradle\n');
        }
    }

    // Step 3: Build debug APK
    console.log('[3/5] Building APK (arm64-v8a)...');
    run('cordova build android --debug -- --arm64-v8a', { cwd: BASE });

    // Step 4: Locate APK
    console.log('\n[4/5] Locating APK...');
    const unsigned = path.join(BASE, 'platforms/android/app/build/outputs/apk/debug/app-debug.apk');
    if (!fs.existsSync(unsigned)) {
        console.error('  ERROR: APK not found at ' + unsigned);
        process.exit(1);
    }
    console.log('  Found (' + (fs.statSync(unsigned).size / 1024 / 1024).toFixed(1) + ' MB)');

    const outDir = path.join(BASE, 'build_output');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const outApk = path.join(outDir, 'parts_manager_v' + newVer + '.apk');
    fs.copyFileSync(unsigned, outApk);

    // Step 5: Sign
    console.log('\n[5/5] Signing APK...');
    const keystore = path.join(BASE, 'build/release-key.jks');
    const apksigner = path.join(SDK, 'build-tools/35.0.0/apksigner.bat');
    const signed = path.join(outDir, 'parts_manager_v' + newVer + '_signed.apk');

    if (fs.existsSync(keystore)) {
        run('"' + apksigner + '" sign --ks "' + keystore + '" --ks-key-alias parts-manager --ks-pass pass:123456 --key-pass pass:123456 --out "' + signed + '" "' + outApk + '"');
        console.log('  Signed');
    } else {
        console.log('  [WARN] Keystore not found, output unsigned.');
        fs.copyFileSync(outApk, signed);
    }

    const size = (fs.statSync(signed).size / 1024 / 1024).toFixed(1);
    console.log('\n============================================');
    console.log('  BUILD SUCCESS! v' + newVer);
    console.log('  ' + signed);
    console.log('  Size: ' + size + ' MB');
    console.log('============================================');
}

main().catch(e => { console.error('\nBuild FAILED:', e.message); process.exit(1); });
