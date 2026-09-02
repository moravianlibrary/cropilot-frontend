#!/bin/sh

echo "Generating runtime environment file..."

cat <<EOF > /usr/share/nginx/html/assets/env.json
{
  "devMode": ${APP_DEV_MODE:-false},
  "environmentName": "${APP_ENV_NAME:-docker runtime}",
  "environmentCode": "${APP_ENV_CODE:-docker}",

  "serverBaseUrl": "${APP_DATA_SERVER_URL}",
  "authToken": "${APP_DATA_SERVER_AUTH_TOKEN}",

  "telemetryEnabled": ${APP_TELEMETRY_ENABLED:-true}
}
EOF

echo "✔️  env.json generated."

exec nginx -g "daemon off;"
