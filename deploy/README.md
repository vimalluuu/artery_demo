# Deployment reference and routing verification

Optional experimental CPU inference uses `compose.model.yaml` as an overlay.
See [model setup, artifact mounting, API contract and limits](../backend/app/services/segmentation/README.md).
The default image still runs ordinary APIs without PyTorch. Review and apply the
new `0005_segmentation_results` migration before starting an updated backend.

The Vite preview is a local development service. The reference configuration here serves the compiled frontend with nginx and proxies the API and health routes to FastAPI. It does not deploy a trained model.

## Routing contract

| Public path | Destination | Required behavior |
| --- | --- | --- |
| `/api/v1/*` | `api:8000/api/v1/*` | Preserve path, query string, HTTP method, body, and bearer authentication |
| `/health` | `api:8000/health` | Liveness JSON; no SPA fallback |
| `/health/ready` | `api:8000/health/ready` | Database readiness JSON; preserve failures |
| `/assets/*` | Compiled assets | Immutable caching; missing files return 404 |
| Frontend routes, e.g. `/dashboard` | `index.html` | Browser refresh works; index is not cached |

The frontend defaults to same-origin `/api/v1` and `/health`. The Docker build explicitly sets these values. Vite environment variables are **build-time public values**, so rebuild the frontend when changing `VITE_API_URL` or `VITE_HEALTH_URL`. Never put secrets in them.

Health probes use a separate unauthenticated HTTP client. A separately hosted health-check URL does not receive the user's API bearer token. A liveness response is not treated as database readiness.

nginx uses the Docker network resolver to refresh the API container address. When using this configuration outside Docker, replace `127.0.0.11` and `api:8000` with the actual resolver and upstream. `proxy_pass` does not append a replacement URI, preserving the API prefix. See [nginx proxy URI handling](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_pass).

## Container reference

From the repository root, for a **new deployment**:

1. Copy `deploy/.env.example` to `deploy/.env`. Set a generated database password and signing key. Set `DATABASE_URL` to the same database credentials using the private service hostname `db`; URL-encode credentials when required. The configuration refuses empty required values.
2. Validate without starting services:

   ```sh
   docker compose -f deploy/compose.yaml --env-file deploy/.env config --quiet
   ```

3. Build the images and start the database:

   ```sh
   docker compose -f deploy/compose.yaml --env-file deploy/.env build
   docker compose -f deploy/compose.yaml --env-file deploy/.env up -d db
   ```

4. Apply reviewed migrations and bootstrap the first administrator:

   ```sh
   docker compose -f deploy/compose.yaml --env-file deploy/.env run --rm api python -m alembic upgrade head
   docker compose -f deploy/compose.yaml --env-file deploy/.env run --rm api python -m app.database.create_admin
   ```

5. Start the API and frontend:

   ```sh
   docker compose -f deploy/compose.yaml --env-file deploy/.env up -d
   ```

The frontend binds to host loopback port 8080 by default. The API and PostgreSQL do not publish host ports. Configure the actual domain and HTTPS at the host's trusted reverse proxy; a remote browser cannot use its own `127.0.0.1` to access this host. Same-origin routing needs no CORS exceptions. Split frontend/API hosting requires exact allowed frontend origins and correctly configured build-time URLs.

PostgreSQL and study files have separate persistent named volumes. PostgreSQL 18 uses the `/var/lib/postgresql` mount location; see the [official image documentation](https://github.com/docker-library/docs/blob/master/postgres/README.md#pgdata). Service ordering waits for database/API health, following [Compose health-based dependencies](https://docs.docker.com/compose/how-tos/startup-order/). Migrations are explicit rather than automatically run at API startup.

For existing data, use the backend migration/backup procedure. Separate the runtime database role from a privileged migration role, pin image digests, reserve upload-spool storage, configure concurrency/storage limits, and verify backups and HTTPS before using a real hosted environment. This is a deployment reference, not a claim that a remote production system has been validated.

The nginx body limit allows a 2,000 MiB raw NIfTI plus multipart framing. FastAPI applies the smaller compressed-file limit and the decompression, payload, and voxel limits. If backend limits change, update proxy limits and available storage together. No raw study directory is mounted into the frontend's static document root.

## Executable routing check

Build the frontend, then run against an installed nginx binary:

```sh
cd frontend-react
npm run build
cd ..
python deploy/verify_routing.py --nginx /path/to/nginx
```

This checks the **same `nginx.conf`**, substituting only test addresses, the local document root, and a temporary listening port. It starts a disposable loopback API, validates nginx syntax, and verifies API prefix/query/auth forwarding, multipart POST forwarding, liveness/readiness, SPA refresh, asset caching, and backend 404/503 propagation. It never connects to an application database or uploads a real study.

For this local audit, Compose configuration validation and nginx routing checks passed. The Docker daemon was unavailable, so Linux image builds and the full container stack could not be executed. No remote deployment or existing database migration was performed.
