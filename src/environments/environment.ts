export const environment = {

    useStaticRuntimeConfig: true, // DŮLEŽITÉ: pokud je true, konfigurace se načítá z env.json; Pro produkci vždy true, pro lokální vývoj (environment.local.ts) false

    // overriden with env.json if useStaticRuntimeConfig is true
    devMode: false, // pro produkci ziskej z promenne APP_DEV_MODE (přes env.json)
    environmentName: 'deployed (branch main)', // pro produkci ziskej z promenne APP_ENV_NAME (přes env.json)
    environmentCode: 'd_m', // pro produkci ziskej z promenne APP_ENV_CODE (přes env.json)

    serverBaseUrl: '', // pro produkci ziskej z promenne APP_DATA_SERVER_URL (přes env.json)
    authToken: '', // pro produkci ziskej z promenne APP_DATA_SERVER_AUTH_TOKEN (přes env.json)

    telemetryEnabled: true, // pro produkci ziskej z promenne APP_TELEMETRY_ENABLED (přes env.json); false vypne odesílání událostí do /events
        
}