from __future__ import annotations

import asyncio
import importlib.util
import sys
import types
from pathlib import Path
from typing import Any

import pytest
from fastapi import HTTPException


MODULE_PATH = Path(__file__).resolve().parents[1] / "dashboard" / "plugin_api.py"


def _normalized_base_url(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return value.strip().rstrip("/")


def _fallback_entries(raw: Any) -> list[dict[str, Any]]:
    if isinstance(raw, dict):
        candidates = [raw]
    elif isinstance(raw, list):
        candidates = raw
    else:
        return []

    entries: list[dict[str, Any]] = []
    for entry in candidates:
        if not isinstance(entry, dict):
            continue
        provider = str(entry.get("provider") or "").strip()
        model = str(entry.get("model") or "").strip()
        if not provider or not model:
            continue
        normalized = dict(entry)
        normalized["provider"] = provider
        normalized["model"] = model
        base_url = _normalized_base_url(entry.get("base_url"))
        if base_url:
            normalized["base_url"] = base_url
        entries.append(normalized)
    return entries


def _fallback_identity(entry: dict[str, Any]) -> tuple[str, str, str]:
    return (
        str(entry.get("provider") or "").strip().lower(),
        str(entry.get("model") or "").strip().lower(),
        _normalized_base_url(entry.get("base_url")).lower(),
    )


def _canonical_fallback_chain(config: dict[str, Any] | None) -> list[dict[str, Any]]:
    config = config or {}
    chain: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str]] = set()

    for key in ("fallback_providers", "fallback_model"):
        for entry in _fallback_entries(config.get(key)):
            identity = _fallback_identity(entry)
            if identity in seen:
                continue
            seen.add(identity)
            chain.append(entry)

    return chain


def _load_plugin(monkeypatch: pytest.MonkeyPatch, config: dict[str, Any]):
    saved: dict[str, Any] = {}

    hermes_cli = types.ModuleType("hermes_cli")
    config_module = types.ModuleType("hermes_cli.config")
    fallback_module = types.ModuleType("hermes_cli.fallback_config")

    def load_config() -> dict[str, Any]:
        return config

    def save_config(next_config: dict[str, Any]) -> None:
        saved["config"] = next_config

    config_module.load_config = load_config
    config_module.save_config = save_config
    fallback_module.get_fallback_chain = _canonical_fallback_chain

    monkeypatch.setitem(sys.modules, "hermes_cli", hermes_cli)
    monkeypatch.setitem(sys.modules, "hermes_cli.config", config_module)
    monkeypatch.setitem(sys.modules, "hermes_cli.fallback_config", fallback_module)

    module_name = f"hermes_fallback_plugin_test_{id(config)}"
    spec = importlib.util.spec_from_file_location(module_name, MODULE_PATH)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    monkeypatch.setitem(sys.modules, module_name, module)
    spec.loader.exec_module(module)
    return module, saved


def test_state_reads_merged_canonical_fallback_chain(monkeypatch: pytest.MonkeyPatch):
    config = {
        "model": {"provider": "nous", "default": "Hermes-4"},
        "fallback_providers": [
            {
                "provider": "openrouter",
                "model": "anthropic/claude-sonnet-4",
                "base_url": "https://openrouter.ai/api/v1/",
            },
        ],
        "fallback_model": [
            {
                "provider": "openrouter",
                "model": "anthropic/claude-sonnet-4",
                "base_url": "https://openrouter.ai/api/v1",
            },
            {"provider": "deepseek", "model": "deepseek-chat"},
        ],
    }
    plugin, _ = _load_plugin(monkeypatch, config)

    state = plugin._state(config)

    assert state == {
        "primary": {"provider": "nous", "model": "Hermes-4"},
        "chain": [
            {
                "provider": "openrouter",
                "model": "anthropic/claude-sonnet-4",
                "base_url": "https://openrouter.ai/api/v1",
            },
            {"provider": "deepseek", "model": "deepseek-chat"},
        ],
        "source": "fallback_providers",
        "legacy_present": True,
    }


def test_validate_chain_rejects_duplicate_identity(monkeypatch: pytest.MonkeyPatch):
    plugin, _ = _load_plugin(monkeypatch, {})

    with pytest.raises(HTTPException) as exc:
        plugin._validate_chain(
            [
                {"provider": "openrouter", "model": "m", "base_url": "https://example.com/"},
                {"provider": "OpenRouter", "model": "m", "base_url": "https://example.com"},
            ],
            {"provider": "nous", "model": "primary"},
        )

    assert exc.value.status_code == 400
    assert "duplicate fallback entry" in exc.value.detail


def test_validate_chain_rejects_primary_match(monkeypatch: pytest.MonkeyPatch):
    plugin, _ = _load_plugin(monkeypatch, {})

    with pytest.raises(HTTPException) as exc:
        plugin._validate_chain(
            [{"provider": "Nous", "model": "Hermes-4", "base_url": "https://models.example/v1/"}],
            {"provider": "nous", "model": "Hermes-4", "base_url": "https://models.example/v1"},
        )

    assert exc.value.status_code == 400
    assert exc.value.detail == "fallback cannot match the current primary model"


def test_validate_chain_allows_same_provider_model_with_different_base_url(monkeypatch: pytest.MonkeyPatch):
    plugin, _ = _load_plugin(monkeypatch, {})

    plugin._validate_chain(
        [
            {"provider": "custom", "model": "Hermes-4", "base_url": "https://one.example/v1"},
            {"provider": "custom", "model": "Hermes-4", "base_url": "https://two.example/v1"},
        ],
        {"provider": "nous", "model": "primary"},
    )


def test_put_chain_saves_canonical_config_and_clears_stale_primary_fields(
    monkeypatch: pytest.MonkeyPatch,
):
    config = {
        "model": {
            "provider": "old",
            "default": "old-model",
            "model": "old-model",
            "base_url": "https://old.example/v1",
            "api_mode": "responses",
        },
        "fallback_model": {"provider": "legacy", "model": "legacy-model"},
    }
    plugin, saved = _load_plugin(monkeypatch, config)

    body = plugin.ChainUpdate(
        primary=plugin.FallbackEntry(provider="nous", model="Hermes-4"),
        chain=[plugin.FallbackEntry(provider="openrouter", model="anthropic/claude-sonnet-4")],
    )
    response = asyncio.run(plugin.put_chain(body))

    assert response["ok"] is True
    assert saved["config"]["model"] == {
        "provider": "nous",
        "default": "Hermes-4",
        "model": "Hermes-4",
    }
    assert saved["config"]["fallback_providers"] == [
        {"provider": "openrouter", "model": "anthropic/claude-sonnet-4"},
    ]
    assert "fallback_model" not in saved["config"]
