const { execSync } = require('child_process');

// Get git hash with fallback
const getGitHash = () => {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return 'no-git-info';
  }
};

let commitJson = {
  hash: JSON.stringify(getGitHash()),
  version: JSON.stringify(process.env.npm_package_version),
};

console.log(`
★═══════════════════════════════════════★
          B O L T . D I Y
         ⚡️  Welcome  ⚡️
★═══════════════════════════════════════★
`);
console.log('📍 Current Version Tag:', `v${commitJson.version}`);
console.log('📍 Current Commit Version:', commitJson.hash);
console.log('  Please wait until the URL appears here');
console.log('★═══════════════════════════════════════★');

// Auto-start embedded services (vector DB, skill directories, etc.)
try {
  const { execSync } = require('child_process');
  const path = require('path');

  const autoStartScript = path.join(__dirname, 'scripts', 'auto-start-services.mjs');

  if (require('fs').existsSync(autoStartScript)) {
    // Run the auto-start script as a child process
    const result = execSync(`node "${autoStartScript}"`, {
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 10000,
    });
    if (result && result.trim()) {
      console.log(result.trim());
    }
    console.log('  ✓ Embedded services initialized');
  }
} catch (e) {
  console.warn('  ⚠ Auto-start services warning:', e.message || e);
}
