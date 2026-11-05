# Deploying

The game is a static build (`dist/`) hosted on **S3 behind CloudFront**:

- **Bucket:** `kylewillett.com`, objects under the `archery-game/` prefix (`s3://kylewillett.com/archery-game/`)
- **Region:** `us-east-1`
- **Served at a subdomain root** (e.g. `archery.kylewillett.com`). CloudFront's
  **Origin Path** is set to `/archery-game`, so the app sees itself at `/` — that's
  why Vite's `base` stays the default `/` and no path rewriting is needed
  (including the absolute `/models/kaykit_props.glb` URL `KitScenery` loads).
- Bucket stays **private**; CloudFront reads it via an **Origin Access Control (OAC)**.

## One-time setup

1. **Install & configure the AWS CLI** with credentials that can deploy:
   ```bash
   aws configure
   ```
   The credentials need: `s3:PutObject`, `s3:DeleteObject`, `s3:ListBucket` on the
   bucket, and `cloudfront:CreateInvalidation` on the distribution. A ready-to-use
   least-privilege policy is in [`deploy/iam-policy.json`](deploy/iam-policy.json) —
   see [IAM permissions](#iam-permissions) below.

2. **Provide your CloudFront distribution ID.** Copy the example config and fill it in
   (the real file is gitignored via `*.local`, so the ID never gets committed):
   ```bash
   cp scripts/deploy.config.local.example scripts/deploy.config.local
   # edit scripts/deploy.config.local and set CLOUDFRONT_DISTRIBUTION_ID
   ```
   Alternatively, export it in your shell instead of using the file:
   ```bash
   export CLOUDFRONT_DISTRIBUTION_ID=EXXXXXXXXXXXXX
   ```

3. **Analytics key.** The build reads `VITE_PUBLIC_POSTHOG_KEY` from `.env.local`
   at build time (see `.env.example`). If it's missing, the deployed game simply
   ships without analytics.

## Deploy

```bash
npm run deploy
```

That runs [`scripts/deploy.sh`](scripts/deploy.sh), which:

1. **Builds** the game (`npm run build` → `dist/`).
2. **Syncs `dist/assets/`** with a 1-year immutable cache. Vite content-hashes
   these filenames, so they can be cached forever; `--delete` prunes old bundles.
3. **Syncs the remaining files** (copied verbatim from `public/`, e.g.
   `models/kaykit_props.glb`) with `Cache-Control: no-cache`. Their names are
   *not* hashed, so they must revalidate or a rebuilt model would stay stale;
   ETags make unchanged files a cheap 304.
4. **Uploads `index.html`** with `Cache-Control: no-cache` so new deploys are
   picked up immediately.
5. **Invalidates CloudFront** (`/*`) so edge caches serve the new files.

## Config overrides

The script reads these from the environment or `scripts/deploy.config.local`:

| Variable | Default | Purpose |
| --- | --- | --- |
| `CLOUDFRONT_DISTRIBUTION_ID` | *(required)* | Distribution to invalidate |
| `DEPLOY_BUCKET` | `kylewillett.com` | Target bucket |
| `DEPLOY_PREFIX` | `archery-game` | Key prefix within the bucket |
| `DEPLOY_REGION` | `us-east-1` | Bucket region |

## IAM permissions

Give the deploying identity only what the script needs — don't use your root
account or an admin/`AmazonS3FullAccess` identity. For a human deploying from a
laptop, **IAM Identity Center (SSO)** is preferred (short-lived credentials, no
stored secret key). A dedicated IAM user with access keys also works if you scope
it tightly and rotate the key periodically.

The least-privilege policy is in [`deploy/iam-policy.json`](deploy/iam-policy.json).
Before attaching it, replace the placeholders in the CloudFront statement:

- `ACCOUNT_ID` — your 12-digit AWS account ID
- `DIST_ID` — the CloudFront distribution ID (same one as `CLOUDFRONT_DISTRIBUTION_ID`)

It grants exactly what `scripts/deploy.sh` calls:

- `s3:ListBucket` on `kylewillett.com`, limited to the `archery-game/` prefix (so `s3 sync` can diff)
- `s3:PutObject` / `s3:DeleteObject` under `archery-game/*`
- `cloudfront:CreateInvalidation` on the one distribution

If `s3 sync` ever reports a permission error, add `s3:GetObject` on
`arn:aws:s3:::kylewillett.com/archery-game/*` — some sync comparisons use it.

**Tip:** attach it to a named profile rather than your shell default, e.g.
`aws configure --profile archery-deploy`, then deploy with
`AWS_PROFILE=archery-deploy npm run deploy`, so this limited identity isn't your
default credentials.

## Notes

- **If you ever serve the game under a URL path** (e.g. `kylewillett.com/archery-game/`
  instead of a subdomain root), set `base: '/archery-game/'` in `vite.config.ts`
  *and* make the `/models/...` URL in `KitScenery.ts` base-relative
  (`import.meta.env.BASE_URL`) — otherwise the hashed assets and the GLB will 404.
- The CloudFront invalidation uses `/*`. Narrowing it to `/index.html` is only
  safe if you also invalidate any changed `public/` files, since those aren't hashed.
