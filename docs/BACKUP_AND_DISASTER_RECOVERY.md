# 💾 TrustLink Escrow - Database Backup & Disaster Recovery Runbook

> **Mission Critical:** This runbook defines automated backup schedules, Point-in-Time Recovery (PITR) procedures, and disaster recovery runbooks to guarantee 99.99% data durability and business continuity for all financial escrow records.

---

## 🏛️ Backup Architecture & Retention Policies

| Tier | Backup Type | Frequency | Retention Window | Target Location |
| :--- | :--- | :--- | :--- | :--- |
| **Tier 1** | Point-in-Time Recovery (PITR) | Continuous (per-second) | 7 Days | Google Cloud Firestore PITR Log |
| **Tier 2** | Full Database Snapshot Export | Daily @ 02:00 UTC | 30 Days | `gs://trustlink-escrow-backups/daily/` |
| **Tier 3** | Cold Storage Archive | Monthly (1st of month) | 365 Days (1 Year) | `gs://trustlink-escrow-backups/archive/` (GCS Coldline) |

---

## ⚙️ Enabling Point-In-Time Recovery (PITR)

Execute via Google Cloud CLI:

```bash
# Enable continuous PITR for the default Firestore database
gcloud firestore databases update --enable-pitr --project=trustlink-escrow

# Verify PITR status
gcloud firestore databases describe --project=trustlink-escrow
```

---

## 🚀 Automated Scheduled Exports (Cloud Scheduler)

To configure automated daily exports to Cloud Storage:

### 1. Create a Secure Cloud Storage Bucket
```bash
gsutil mb -p trustlink-escrow -c standard -l europe-west1 gs://trustlink-escrow-backups/
```

### 2. Set Up Cloud Function Export Scheduler
Schedule daily execution using Google Cloud Scheduler:
```bash
gcloud scheduler jobs create http firestore-daily-backup \
  --project=trustlink-escrow \
  --location=europe-west1 \
  --schedule="0 2 * * *" \
  --time-zone="UTC" \
  --uri="https://firestore.googleapis.com/v1/projects/trustlink-escrow/databases/(default):exportDocuments" \
  --http-method=POST \
  --message-body='{"outputUriPrefix": "gs://trustlink-escrow-backups/daily"}' \
  --oauth-service-account-email="trustlink-escrow@appspot.gserviceaccount.com"
```

---

## 🔄 Disaster Recovery & Restoration Procedures

### Scenario A: Rollback to a Point-in-Time (PITR)
If an accidental data corruption or schema error occurred at a known time (e.g. `2026-08-06T10:00:00Z`):

```bash
# Restore to a new database instance or point-in-time snapshot
gcloud firestore databases restore \
  --source-database='(default)' \
  --destination-database='restored-db' \
  --recovery-time='2026-08-06T10:00:00Z' \
  --project=trustlink-escrow
```

### Scenario B: Restoring from a GCS Snapshot Export
```bash
# Import all collections from a specific GCS backup directory
gcloud firestore import gs://trustlink-escrow-backups/daily/2026-08-06T02:00:00_12345/ \
  --project=trustlink-escrow
```

---

## 🚨 Incident Response Checklist

1. **Assess Impact**: Identify affected collections (`users`, `escrows`, `transactions`).
2. **Lock Vulnerable Operations**: Temporarily set read-only mode via Firebase Security Rules if required.
3. **Identify Recovery Point**: Determine the most recent clean timestamp prior to the incident.
4. **Execute Restoration**: Follow Scenario A or B above.
5. **Verify Financial Ledger**: Run `node scripts/backup-firestore.js --verify` to assert ledger balance parity.
6. **Resume Service**: Re-enable live traffic.
