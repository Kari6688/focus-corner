// electron-builder afterPack hook.
// Gives the macOS app an "ad-hoc" code signature. Apple Silicon Macs refuse to run
// apps with a missing or broken signature and report them as "damaged"; an ad-hoc
// signature fixes that. (It is not a Developer ID signature, so macOS still asks
// you to confirm the first launch.) Replace this with real signing once you have
// an Apple Developer certificate.

const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  console.log(`  • ad-hoc signing  ${appPath}`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath], { stdio: 'inherit' });
};
