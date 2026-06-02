# Cloud Run Deployment Templates

These templates make the production security choices explicit:

- `chessapp-backend` uses `chessapp-backend-sa`.
- `chessapp-frontend` uses `chessapp-frontend-sa`.
- Both services declare ingress, max scale, concurrency, and timeouts.
- Secrets are read from Secret Manager instead of env files or image contents.

Replace `PROJECT_ID`, `REGION`, `FRONTEND_DOMAIN`, `BACKEND_DOMAIN`, and
`CLOUD_SQL_INSTANCE` before deployment.

Deploy:

```sh
gcloud run services replace deploy/cloud-run/backend.yaml --region REGION
gcloud run services replace deploy/cloud-run/frontend.yaml --region REGION
```

If local-auth login returns `Database unavailable for login`, verify the deployed
backend configuration rather than the template file:

```sh
gcloud run services describe chessapp-backend \
  --region REGION \
  --format="value(spec.template.metadata.annotations['run.googleapis.com/cloudsql-instances'])"

gcloud run services describe chessapp-backend \
  --region REGION \
  --format="value(spec.template.spec.serviceAccountName)"

gcloud secrets versions access latest --secret chessapp-db-user
gcloud secrets versions access latest --secret chessapp-db-name
```

The service account must have Cloud SQL Client and Secret Manager Secret
Accessor permissions:

```sh
gcloud projects add-iam-policy-binding PROJECT_ID \
  --member serviceAccount:chessapp-backend-sa@PROJECT_ID.iam.gserviceaccount.com \
  --role roles/cloudsql.client

gcloud projects add-iam-policy-binding PROJECT_ID \
  --member serviceAccount:chessapp-backend-sa@PROJECT_ID.iam.gserviceaccount.com \
  --role roles/secretmanager.secretAccessor
```

For temporary runtime diagnostics, deploy the backend with
`ALLOW_AUTH_DEBUG_CONFIG=true`, then call `/auth/debug-db`. The endpoint reports
whether DB env vars are present and whether the Cloud SQL Unix socket path exists.
Disable the flag again after checking.

Public access should be granted only when intentional:

```sh
gcloud run services add-iam-policy-binding chessapp-frontend \
  --region REGION \
  --member allUsers \
  --role roles/run.invoker

gcloud run services add-iam-policy-binding chessapp-backend \
  --region REGION \
  --member allUsers \
  --role roles/run.invoker
```

For a stricter backend posture, put the backend behind an external HTTPS load
balancer or API gateway and change backend ingress to
`internal-and-cloud-load-balancing`.
