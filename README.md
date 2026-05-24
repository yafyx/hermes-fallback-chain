# hermes-fallback

A small dashboard plugin for editing the Hermes fallback chain from the Models page.

Hermes already supports `fallback_providers` in `config.yaml`. This plugin gives that config a focused UI: add backup models, reorder them, promote a fallback to primary, then save the chain back to the canonical config keys.

This is a dashboard plugin, not a tool or gateway plugin. It registers into the `models:top` slot and mounts two local backend routes under `/api/plugins/hermes-fallback/`.

## Requirements

- Hermes Agent v0.14.0 or newer.
- A Hermes dashboard that can load dashboard plugins from `~/.hermes/plugins/`.

The v0.14.0 requirement is intentional. That version renders the `models:top` dashboard slot used by this plugin.

## Install

Clone the repo into the Hermes plugin directory:

```bash
git clone <repo-url> ~/.hermes/plugins/hermes-fallback
```

Restart the dashboard after installing:

```bash
hermes dashboard
```

Open the Models page. The fallback editor appears above the built-in model analytics.

## Verify

Check that Hermes can discover the manifest:

```bash
curl http://127.0.0.1:9119/api/dashboard/plugins/rescan
```

Check the plugin backend route:

```bash
curl http://127.0.0.1:9119/api/plugins/hermes-fallback/state
```

If the UI bundle changes, a dashboard rescan is usually enough. If `dashboard/plugin_api.py` changes, restart `hermes dashboard`; backend routes are mounted at startup.

## What it writes

The plugin writes this top-level config key:

```yaml
fallback_providers:
  - provider: openrouter
    model: anthropic/claude-sonnet-4
```

When saving, it removes the legacy `fallback_model` key so there is one source of truth. Reads still merge `fallback_providers` and legacy `fallback_model` through Hermes' own fallback helper.

## Development

Run the local checks:

```bash
python -m pip install fastapi pydantic pytest
python -m py_compile dashboard/plugin_api.py
python -m json.tool dashboard/manifest.json >/dev/null
node --check dashboard/dist/index.js
pytest -q
```

The dashboard bundle is plain JavaScript loaded by Hermes. React comes from `window.__HERMES_PLUGIN_SDK__`, so it is not bundled here.

## Uninstall

Remove the plugin directory and restart the dashboard:

```bash
rm -rf ~/.hermes/plugins/hermes-fallback
hermes dashboard
```
