"""Manifest-style fallback dashboard plugin routes.

Mounted by Hermes at /api/plugins/hermes-fallback/.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from hermes_cli.config import load_config, save_config


router = APIRouter()


class FallbackEntry(BaseModel):
    provider: str = Field(min_length=1)
    model: str = Field(min_length=1)
    base_url: Optional[str] = ""
    api_mode: Optional[str] = ""


class ChainUpdate(BaseModel):
    chain: List[FallbackEntry]
    primary: Optional[FallbackEntry] = None


def _clean_entry(entry: Dict[str, Any]) -> Dict[str, str]:
    provider = str(entry.get("provider") or "").strip()
    model = str(entry.get("model") or entry.get("default") or "").strip()
    if not provider or not model:
        return {}

    cleaned: Dict[str, str] = {"provider": provider, "model": model}
    base_url = str(entry.get("base_url") or "").strip()
    if base_url:
        cleaned["base_url"] = base_url
    api_mode = str(entry.get("api_mode") or "").strip()
    if api_mode:
        cleaned["api_mode"] = api_mode
    return cleaned


def _read_chain(config: Dict[str, Any]) -> tuple[List[Dict[str, str]], str, bool]:
    """Return normalized chain, source key, and whether legacy config exists."""
    fallback_providers = config.get("fallback_providers")
    if isinstance(fallback_providers, list):
        chain = [
            cleaned
            for entry in fallback_providers
            if isinstance(entry, dict) and (cleaned := _clean_entry(entry))
        ]
        if chain:
            return chain, "fallback_providers", bool(config.get("fallback_model"))

    legacy = config.get("fallback_model")
    if isinstance(legacy, dict):
        cleaned = _clean_entry(legacy)
        if cleaned:
            return [cleaned], "fallback_model", True
    if isinstance(legacy, list):
        chain = [
            cleaned
            for entry in legacy
            if isinstance(entry, dict) and (cleaned := _clean_entry(entry))
        ]
        if chain:
            return chain, "fallback_model", True

    return [], "none", bool(legacy)


def _primary(config: Dict[str, Any]) -> Dict[str, str]:
    model_cfg = config.get("model")
    if isinstance(model_cfg, dict):
        cleaned = _clean_entry(model_cfg)
        if cleaned:
            return cleaned
        provider = str(model_cfg.get("provider") or "").strip()
        model = str(model_cfg.get("default") or model_cfg.get("model") or model_cfg.get("name") or "").strip()
        return {"provider": provider, "model": model}
    if isinstance(model_cfg, str) and model_cfg.strip():
        return {"provider": "", "model": model_cfg.strip()}
    return {"provider": "", "model": ""}


def _validate_chain(chain: List[Dict[str, str]], primary: Dict[str, str]) -> None:
    seen = set()
    primary_key = (primary.get("provider") or "", primary.get("model") or "")
    for index, entry in enumerate(chain, start=1):
        key = (entry.get("provider") or "", entry.get("model") or "")
        if not key[0] or not key[1]:
            raise HTTPException(status_code=400, detail=f"fallback entry {index} needs provider and model")
        if key == primary_key:
            raise HTTPException(status_code=400, detail="fallback cannot match the current primary model")
        if key in seen:
            raise HTTPException(status_code=400, detail=f"duplicate fallback entry: {key[0]} / {key[1]}")
        seen.add(key)


def _set_primary(config: Dict[str, Any], primary: Dict[str, str]) -> None:
    model_cfg = config.get("model")
    if isinstance(model_cfg, dict):
        model_cfg["provider"] = primary["provider"]
        model_cfg["default"] = primary["model"]
        if "model" in model_cfg:
            model_cfg["model"] = primary["model"]
        if primary.get("base_url"):
            model_cfg["base_url"] = primary["base_url"]
        if primary.get("api_mode"):
            model_cfg["api_mode"] = primary["api_mode"]
        return

    config["model"] = {
        "provider": primary["provider"],
        "default": primary["model"],
    }
    if primary.get("base_url"):
        config["model"]["base_url"] = primary["base_url"]
    if primary.get("api_mode"):
        config["model"]["api_mode"] = primary["api_mode"]


def _state(config: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    cfg = config if config is not None else load_config()
    chain, source, legacy_present = _read_chain(cfg)
    primary = _primary(cfg)
    return {
        "primary": primary,
        "chain": chain,
        "source": source,
        "legacy_present": legacy_present,
    }


@router.get("/state")
async def get_state() -> Dict[str, Any]:
    return _state()


@router.put("/chain")
async def put_chain(body: ChainUpdate) -> Dict[str, Any]:
    config = load_config()
    current_primary = _primary(config)
    requested_primary = _clean_entry(body.primary.dict()) if body.primary else current_primary
    if body.primary and not requested_primary:
        raise HTTPException(status_code=400, detail="primary needs provider and model")
    chain = [_clean_entry(entry.dict()) for entry in body.chain]
    chain = [entry for entry in chain if entry]
    _validate_chain(chain, requested_primary)

    _set_primary(config, requested_primary)
    config["fallback_providers"] = chain
    config.pop("fallback_model", None)
    save_config(config)
    return {"ok": True, **_state(config)}
