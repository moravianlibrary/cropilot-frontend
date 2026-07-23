# Cropilot frontend

This repository contains the browser-based user interface for
[Cropilot](https://github.com/moravianlibrary/cropilot), an AI-powered system
for detecting, reviewing, and applying crop instructions to scanned documents.

The frontend connects to the Cropilot API. It does not contain the backend,
processing workers, machine-learning models, or database required to run the
complete system.

## Cropilot ecosystem

| Repository | Responsibility |
| --- | --- |
| [moravianlibrary/cropilot](https://github.com/moravianlibrary/cropilot) | Main Cropilot backend, API, processing workers, model integration, persistence, and deployment documentation. |
| This repository | Angular web application for administration and manual review of generated crop instructions. |
| [moravianlibrary/cropilot-utils](https://github.com/moravianlibrary/cropilot-utils) | Model training code and batch tools for uploading scans, downloading crop instructions, and applying them to source files. |


## Technology

- Angular 19 and Angular CDK
- TypeScript 5.7
- RxJS
- SCSS
- OverlayScrollbars

## Local development

### Prerequisites

- Node.js and npm
- A running [Cropilot API](https://github.com/moravianlibrary/cropilot)
  instance accessible from the browser

Install the locked dependencies:

```bash
npm ci
```

Create the ignored local environment file:

```bash
npm run prestart
```

Edit `src/environments/environment.local.ts` and point `serverBaseUrl` to the
Cropilot API:

```ts
export const environment = {
  useStaticRuntimeConfig: false,
  devMode: true,
  environmentName: 'local',
  environmentCode: 'local',
  serverBaseUrl: 'http://localhost:8000',
  authToken: '',
};
```

Start the development server:

```bash
npm start
```

The application is available at <http://localhost:4400/> and reloads when
source files change.

`npm start` runs two preparatory scripts automatically:

- `scripts/bootstrap_file_environment-local-ts.js` creates
  `environment.local.ts` when it is missing;
- `scripts/collect-build-info.js` records the current Git revision and build
  metadata.

## Available commands

| Command | Purpose |
| --- | --- |
| `npm start` | Start the Angular development server on port 4400. |
| `npm run build` | Create a production build in `dist/orezy-frontend/browser/`. |
| `npm run watch` | Rebuild continuously with the development configuration. |
| `npm test` | Start the Karma/Jasmine test runner. |
| `npm run ng -- <command>` | Run another Angular CLI command. |

There are currently no committed application test specifications or
end-to-end test runner in this repository. A production build is the primary
project-wide compilation check.

## Runtime configuration

Production builds use `src/environments/environment.ts`, which loads
`/assets/env.json` before the Angular application starts. This allows the same
frontend bundle or container image to be configured for different Cropilot API
instances.

| Environment variable | Purpose | Default |
| --- | --- | --- |
| `APP_DATA_SERVER_URL` | Base URL of the Cropilot API. | Empty; required for a working deployment. |
| `APP_DEV_MODE` | Boolean environment flag exposed in runtime metadata. | `false` |
| `APP_ENV_NAME` | Human-readable environment name. | Empty during build, `docker runtime` in the container. |
| `APP_ENV_CODE` | Short environment identifier. | Empty during build, `docker` in the container. |
| `APP_DATA_SERVER_AUTH_TOKEN` | Compatibility value written to the browser runtime configuration. User login uses its own bearer access token. | Empty |

All values in `env.json` are downloaded by the browser and must therefore be
treated as public client-side configuration. Do not put confidential secrets
in these variables.

### Production build

Set the runtime values and build the application:

```bash
export APP_DEV_MODE=false
export APP_ENV_NAME=local-build
export APP_ENV_CODE=local
export APP_DATA_SERVER_URL=http://localhost:8000
export APP_DATA_SERVER_AUTH_TOKEN=

npm run build
```

The `prebuild` lifecycle generates:

- `src/assets/env.json` from the `APP_*` variables;
- `src/assets/build-info.json` with the Git commit, nearest tag, dirty state,
  and build time.

Both generated configuration files are ignored by Git.

## Docker

The multi-stage Dockerfile builds the Angular application and serves it from
Nginx with single-page-application routing enabled.

Build the image:

```bash
docker build -t cropilot-frontend .
```

Run it against a Cropilot API:

```bash
docker run --rm \
  -p 8080:80 \
  -e APP_DEV_MODE=false \
  -e APP_ENV_NAME=local-docker \
  -e APP_ENV_CODE=docker \
  -e APP_DATA_SERVER_URL=http://localhost:8000 \
  -e APP_DATA_SERVER_AUTH_TOKEN= \
  cropilot-frontend
```

Open <http://localhost:8080/>.

At container startup, `docker/entrypoint.sh` regenerates
`/usr/share/nginx/html/assets/env.json`. A built image can therefore be reused
without rebuilding it for every environment.

## Project structure

```text
src/app/
├── components/          Reusable dialogs, drawers, menus, inputs, and feedback
├── layout-dashboard/    Group, title, and user administration UI
├── layout-editor/       Scan list, canvas editor, properties, and zoom controls
├── routes/              Login, dashboard, editor, and error route components
├── services/            API, authentication, editor, dashboard, and UI state
└── utils/               Editor geometry and shared helpers

scripts/                 Runtime config and build metadata generators
docker/                  Nginx configuration and container entrypoint
.github/workflows/       Build and deployment automation
main.tf                  Docker/Traefik Terraform deployment
```

## License

This repository is licensed under the
[GNU General Public License v3.0](LICENSE).
