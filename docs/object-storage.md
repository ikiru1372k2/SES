# Object Storage

SES stores uploaded sample files (PDFs, workbooks) in S3-compatible
object storage. Postgres holds only metadata.

The same code targets MinIO (local dev) and AWS S3 (production) — switch
by changing `OBJECT_STORAGE_*` environment variables only. No code change.

## Local dev (MinIO)

```bash
# brings up Postgres + Redis + MinIO + applies migrations + seeds + starts dev servers
./run.sh
```

The bucket named by `OBJECT_STORAGE_BUCKET` (default `ses-ai-files`) is
created idempotently by the `minio-init` compose service on every `up`.
Console: <http://localhost:9001> (login `minioadmin`/`minioadmin`).

## Production (AWS S3)

In your `.env`:

```
OBJECT_STORAGE_DRIVER=s3
OBJECT_STORAGE_ENDPOINT=
OBJECT_STORAGE_REGION=ap-south-1
OBJECT_STORAGE_BUCKET=your-production-bucket
OBJECT_STORAGE_ACCESS_KEY=...
OBJECT_STORAGE_SECRET_KEY=...
OBJECT_STORAGE_FORCE_PATH_STYLE=false
```

Leaving `OBJECT_STORAGE_ENDPOINT` empty triggers AWS default endpoint
resolution. `OBJECT_STORAGE_FORCE_PATH_STYLE=false` selects virtual-host
addressing (S3 default).

## Bucket policy

Buckets must be **private** (no public ACLs). The application uses
pre-signed URLs for any browser- or sidecar-side reads. Recommended
least-privilege IAM policy for the access key the API uses:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject", "s3:ListBucket"],
      "Resource": [
        "arn:aws:s3:::your-production-bucket",
        "arn:aws:s3:::your-production-bucket/*"
      ]
    }
  ]
}
```

No `s3:PutBucketAcl`, no `*` resource. The credential should not be able
to read other buckets in the account.

## What lives where

- **Object storage**: raw bytes (PDF / xlsx / etc).
- **Postgres `uploaded_object`**: pointer + content hash + size + status.
- **Postgres `AiPilotSandboxSession`**: links a session to its
  `uploadedObjectId`. The legacy `fileBytes` BYTEA column is now nullable
  and only retains historical rows.

Raw bytes are never logged. The `redactedConfig()` helper in
`apps/api/src/object-storage/object-storage.config.ts` is the only way
config values appear in logs.

## Key shape

```
ai-pilot/{tenantId}/{sessionId}/{ULID}-{safeFileName}
```

The embedded ULID guarantees uniqueness for repeated uploads of the same
filename. See `apps/api/src/object-storage/object-key.ts`.

## Testing

```bash
# Unit tests run without infrastructure (config, key generation skip DB-bound bits).
npm run test --workspace @ses/api

# DB and MinIO integration tests run when DATABASE_URL and OBJECT_STORAGE_*
# are set (run.sh exports both).
DATABASE_URL=... OBJECT_STORAGE_*=... npm run test --workspace @ses/api
```
