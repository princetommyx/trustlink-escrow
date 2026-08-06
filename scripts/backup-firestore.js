/**
 * Firestore Database Snapshot & Backup Utility Script
 * 
 * Usage:
 *   node scripts/backup-firestore.js --export [optional output prefix]
 *   node scripts/backup-firestore.js --verify
 */

const { execSync } = require('child_process');

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'trustlink-escrow';
const BUCKET_NAME = process.env.BACKUP_BUCKET || 'trustlink-escrow-backups';

function runGcloudCommand(cmd) {
    try {
        console.log(`[DR-BACKUP] Running: ${cmd}`);
        const output = execSync(cmd, { encoding: 'utf8', stdio: 'pipe' });
        return { success: true, output };
    } catch (err) {
        return { success: false, error: err.stderr || err.message };
    }
}

async function exportFirestore() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const destination = `gs://${BUCKET_NAME}/manual/${timestamp}`;
    
    console.log(`\n📦 Initializing Firestore Database Snapshot Export`);
    console.log(`   Project:     ${PROJECT_ID}`);
    console.log(`   Destination: ${destination}\n`);

    const command = `gcloud firestore export ${destination} --project=${PROJECT_ID}`;
    const result = runGcloudCommand(command);

    if (result.success) {
        console.log(`✅ Snapshot export initiated successfully!`);
        console.log(result.output);
    } else {
        console.warn(`⚠️ Note: If running locally without gcloud auth or GCP permissions, export commands must be run in your authenticated GCP Cloud Shell.`);
        console.warn(`Error details: ${result.error}`);
    }
}

function verifyPITRStatus() {
    console.log(`\n🔍 Verifying Point-In-Time Recovery (PITR) Configuration...`);
    const command = `gcloud firestore databases describe --project=${PROJECT_ID} --format=json`;
    const result = runGcloudCommand(command);

    if (result.success) {
        try {
            const data = JSON.parse(result.output);
            const pitrEnabled = data.pointInTimeRecoveryEnablement === 'POINT_IN_TIME_RECOVERY_ENABLED';
            console.log(`   PITR Status: ${pitrEnabled ? '🟢 ENABLED (Continuous per-second recovery)' : '🟡 DISABLED'}`);
        } catch (e) {
            console.log(result.output);
        }
    } else {
        console.log(`   ℹ️ Run 'gcloud auth login' and 'gcloud firestore databases update --enable-pitr' to enable continuous PITR.`);
    }
}

const args = process.argv.slice(2);
if (args.includes('--verify')) {
    verifyPITRStatus();
} else {
    exportFirestore();
}
