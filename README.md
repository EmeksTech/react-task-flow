# TaskFlow React classroom proof of concept

This standalone React + Vite + TypeScript app can use the TaskFlow workspace's
JSON Server for mock mode or the authenticated TaskFlow API. It never connects
to PostgreSQL directly.

## Run mock mode

Mock mode's JSON Server is provided by the larger TaskFlow workspace, not this
standalone repository. When working in that workspace, start JSON Server from
the workspace root:

```powershell
npm run dev:api
```

In another terminal:

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

The starter `.env.example` selects mock mode. The Vite app reads and updates
the same `mock-api/db.json` served by the workspace's JSON Server.

## Run TaskFlow API mode

Set these values in `.env.local` at this repository's root:

```dotenv
VITE_API_MODE=taskflow
TASKFLOW_BACKEND_URL=https://task-flow-six-rouge.vercel.app
VITE_TASKFLOW_CALLBACK_URL=https://task-flow-six-rouge.vercel.app/
TASKFLOW_DEV_PORT=5173
```

The Vite dev server proxies `/api/*` to `TASKFLOW_BACKEND_URL`. Login, CSRF,
session, sign-out, and task requests all pass through this proxy. The browser
keeps Auth.js cookies; the React code never reads them or stores credentials.
The password is used only for the sign-in request and is cleared from the form
after a successful login. `TASKFLOW_DEV_PORT` is server-only and defaults to
5173; use another local port if needed, for example 5174.

The sign-in screen also links to student registration, which calls TaskFlow's
existing `POST /api/register` endpoint. Registration creates the account but
does not sign in automatically; sign in afterward with the same credentials.
TaskFlow validates and hashes the password on the server. Use only a
classroom-approved backend and account because registration and task writes
persist to that backend's database.

For cookie-authenticated requests, the Vite server accepts only the exact local
origin for its configured port. It rejects missing or different origins on
state-changing requests, then forwards the validated write to TaskFlow as a
same-origin request. Auth.js CSRF token validation remains enabled. Vite CORS
is disabled in TaskFlow mode; the dev server binds to localhost and must not be
exposed to a network. This development proxy does not require adding localhost
origins to production `TASKFLOW_ALLOWED_ORIGINS` and is not a production hosting
pattern.

TaskFlow mode supports task creation, editing, deletion, title/description
search, status and priority filters, assignee and due-date filters, and
server-side pagination. Mock mode offers the same interface and filters the
JSON Server response locally. After changes made in either client, refetch the
task list in the other client to demonstrate shared persistence; updates are
not realtime.

The separate `/api/v1/*` API accepts bearer tokens only and returns
`Access-Control-Allow-Origin: *` without credentialed CORS. Do not place a
personal access token in this React app, a `VITE_` variable, source code,
localStorage, or a browser bundle. Browser OAuth/PKCE is not implemented; a
deployed independent browser app needs an approved OAuth authorization server
or a separately reviewed backend-for-frontend.

## Render deployment

This standalone repository (`EmeksTech/react-task-flow`) is deployed as a
Render **Web Service** using the [`render.yaml`](./render.yaml) Blueprint at
the Git repository root. Do not deploy it as a Static Site or set a
`rootDir`: this root contains `package.json`, `server.mjs`, and the Blueprint.
The Web Service serves the Vite build and proxies relative `/api/*` requests
server-to-server to the TaskFlow Vercel backend. Static Site rewrites are not a
replacement for this proxy because authentication also depends on preserving
cookies, request bodies, and redirects.

### Create the Render service

1. Push this repository, including `render.yaml` and `server.mjs`, to the
   branch you want Render to deploy.
2. In Render, choose **New + → Blueprint**, connect the
   `EmeksTech/react-task-flow` GitHub repository, and select that branch.
   Confirm Render finds `render.yaml` at the repository root.
3. Review the Blueprint. It creates a new Web Service named
   `taskflow-react-proxy` with `npm ci && npm run build`, `npm start`, and
   `/healthz` as its health check. Apply the Blueprint and wait for the first
   deploy to finish.
4. Open the service in Render and copy its generated HTTPS `onrender.com`
   origin (for example, `https://taskflow-react-proxy.onrender.com`).

The Blueprint configures `VITE_API_MODE=taskflow` and
`TASKFLOW_BACKEND_URL=https://task-flow-six-rouge.vercel.app`. The former is a
build-time Vite setting; the latter is server-only and is not included in the
browser bundle. Render provides `RENDER_EXTERNAL_URL` automatically for Host
and Origin validation. No Auth.js secret, database password, or personal
access token is needed in Render. If using a custom domain, set
`PUBLIC_APP_ORIGIN` in the Web Service to that exact HTTPS origin.

### Allow the Render origin in Vercel

In the TaskFlow Vercel project's environment settings, add the new Render
origin to `TASKFLOW_ALLOWED_ORIGINS`. Preserve existing origins and follow the
format already used by that variable. Redeploy the Vercel backend so the
updated environment value is applied. This is required for registration and
state-changing task requests: the proxy forwards the browser's real Origin
and does not bypass backend origin checks or Auth.js CSRF validation. No
Vercel code change is required.

### Verify before switching traffic

The existing Render Static Site cannot be converted in place. Keep it
available until the new Web Service is checked; the Web Service has its own
URL. From a browser, verify `/api/auth/providers`, `/api/auth/csrf`, and
`/api/auth/session` load from the new Render origin. Then use an approved
classroom test account to verify registration (if needed), sign-in, session
retrieval, task listing and CRUD, search/filter/pagination, and sign-out.
Registration and task changes persist to the backend, so use a dedicated test
account and disposable tasks. Do not consider authentication or CRUD verified
until tested with an actual account.

The Blueprint selects Render's free Web Service plan, which may sleep while
idle and cold-start on the next request.

## Validation

```powershell
npm run build
npm run lint
npm run test:server
```
