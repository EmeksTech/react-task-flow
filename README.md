# TaskFlow React classroom proof of concept

This isolated React + Vite + TypeScript app can use the existing JSON Server or
the authenticated TaskFlow API. It never connects to PostgreSQL directly.

## Run mock mode

From the repository root, start JSON Server:

```powershell
npm run dev:api
```

In another terminal:

```powershell
Set-Location .\classroom\taskflow-react-poc
npm install
Copy-Item .env.example .env.local
npm run dev
```

The starter `.env.example` selects mock mode. The Vite app reads and updates the
same `mock-api/db.json` served by the root JSON Server.

## Run TaskFlow API mode

Set these values in `classroom/taskflow-react-poc/.env.local`:

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

Use dedicated classroom accounts and disposable tasks. For API architecture
and security details, see
[`docs/REACT_API_INTEGRATION.md`](../../docs/REACT_API_INTEGRATION.md) and
[`docs/TASKFLOW_EXTERNAL_API.md`](../../docs/TASKFLOW_EXTERNAL_API.md).

## Validation

```powershell
npm run build
npm run lint
```
