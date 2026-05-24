(function () {
  "use strict";

  const SDK = window.__HERMES_PLUGIN_SDK__;
  if (!SDK || !window.__HERMES_PLUGINS__) return;

  const React = SDK.React;
  const hooks = SDK.hooks;
  const C = SDK.components;
  const api = SDK.api;
  const fetchJSON = SDK.fetchJSON;

  const PLUGIN = "hermes-fallback";
  const BASE = "/api/plugins/hermes-fallback";

  function h(type, props, ...children) {
    return React.createElement(type, props, ...children);
  }

  function entryKey(entry) {
    return `${entry.provider || ""}\u0000${entry.model || ""}`;
  }

  function displayEntry(entry) {
    if (!entry || (!entry.provider && !entry.model)) return "(unset)";
    return `${entry.provider || "(unknown provider)"} / ${entry.model || "(provider default)"}`;
  }

  function modelLabel(entry) {
    if (!entry || !entry.model) return "(provider default)";
    return entry.model;
  }

  function providerLabel(entry) {
    if (!entry || !entry.provider) return "(unknown provider)";
    return entry.provider;
  }

  function cx(...classes) {
    return classes.filter(Boolean).join(" ");
  }

  function sameEntry(a, b) {
    return !!a && !!b && (a.provider || "") === (b.provider || "") && (a.model || "") === (b.model || "");
  }

  function hasIdentity(entry) {
    return !!entry && !!entry.provider && !!entry.model;
  }

  function chainCountLabel(count) {
    return count === 1 ? "1 fallback" : `${count} fallbacks`;
  }

  function syncLabel(dirty, saving) {
    if (saving) return "Saving...";
    if (dirty) return "Unsaved changes";
    return "Synced with config.yaml";
  }

  function sourceLabel(state) {
    if (!state) return "config";
    if (state.legacy_present && state.source === "fallback_model") return "Legacy fallback model";
    if (state.source === "fallback_providers") return "Fallback providers";
    return "No fallback key";
  }

  function stageNumber(index) {
    return String(index + 1).padStart(2, "0");
  }

  function optionLabel(provider) {
    return provider && (provider.name || provider.slug) ? (provider.name || provider.slug) : "(unknown provider)";
  }

  function Button(props) {
    return h(C.Button, props, props.children);
  }

  function SmallButton(props) {
    const className = cx("hf-action-button hf-small-button text-[10px]", props.className);
    const next = Object.assign({ size: "sm", outlined: true }, props, { className });
    return h(C.Button, next, props.children);
  }

  function SearchSelect(props) {
    const [open, setOpen] = hooks.useState(false);
    const [query, setQuery] = hooks.useState("");
    const selected = props.options.find((option) => option.value === props.value) || null;
    const filtered = hooks.useMemo(() => {
      const needle = query.trim().toLowerCase();
      if (!needle) return props.options;
      return props.options.filter((option) => {
        const label = String(option.label || "").toLowerCase();
        const value = String(option.value || "").toLowerCase();
        return label.includes(needle) || value.includes(needle);
      });
    }, [props.options, query]);

    function choose(option) {
      props.onValueChange(option.value);
      setQuery("");
      setOpen(false);
    }

    function handleFocus() {
      if (props.disabled) return;
      setQuery("");
      setOpen(true);
      if (props.onFocus) props.onFocus();
    }

    function handleKeyDown(event) {
      if (props.disabled) return;
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        setQuery("");
      }
      if (event.key === "Enter" && open && filtered.length > 0) {
        event.preventDefault();
        choose(filtered[0]);
      }
      if (event.key === "ArrowDown") {
        setOpen(true);
      }
    }

    return h("div", { className: "hf-search-select" },
      h(C.Input, {
        className: "hf-search-input",
        disabled: props.disabled,
        role: "combobox",
        "aria-expanded": open ? "true" : "false",
        "aria-autocomplete": "list",
        value: open ? query : (selected ? selected.label : ""),
        placeholder: open && selected ? selected.label : props.placeholder,
        onFocus: handleFocus,
        onChange: (event) => {
          setQuery(event.target.value);
          setOpen(true);
        },
        onKeyDown: handleKeyDown,
        onBlur: () => window.setTimeout(() => setOpen(false), 120),
      }),
      open && !props.disabled
        ? h("div", { className: "hf-search-list", role: "listbox" },
          filtered.length === 0
            ? h("div", { className: "hf-search-empty" }, props.emptyLabel || "No matches")
            : filtered.slice(0, 80).map((option) => h("button", {
              className: cx("hf-search-option", option.value === props.value && "is-selected"),
              key: option.value,
              type: "button",
              role: "option",
              "aria-selected": option.value === props.value ? "true" : "false",
              onMouseDown: (event) => {
                event.preventDefault();
                choose(option);
              },
            },
              h("span", { className: "hf-search-option-label" }, option.label),
              option.meta ? h("span", { className: "hf-search-option-meta" }, option.meta) : null,
            )),
        )
        : null,
    );
  }

  function FallbackPanel() {
    const [state, setState] = hooks.useState(null);
    const [primaryDraft, setPrimaryDraft] = hooks.useState({ provider: "", model: "" });
    const [chain, setChain] = hooks.useState([]);
    const [loading, setLoading] = hooks.useState(true);
    const [saving, setSaving] = hooks.useState(false);
    const [error, setError] = hooks.useState("");
    const [notice, setNotice] = hooks.useState("");
    const [options, setOptions] = hooks.useState([]);
    const [optionsLoading, setOptionsLoading] = hooks.useState(false);
    const [selectedProvider, setSelectedProvider] = hooks.useState("");
    const [selectedModel, setSelectedModel] = hooks.useState("");
    const [adding, setAdding] = hooks.useState(false);
    const [dragIndex, setDragIndex] = hooks.useState(null);
    const [dropIndex, setDropIndex] = hooks.useState(null);
    const [dropPrimary, setDropPrimary] = hooks.useState(false);

    const dirty = !!state && (
      JSON.stringify(chain) !== JSON.stringify(state.chain || []) ||
      !sameEntry(primaryDraft, state.primary)
    );

    const selectedProviderRow = hooks.useMemo(
      () => options.find((p) => p.slug === selectedProvider) || null,
      [options, selectedProvider],
    );
    const models = selectedProviderRow && Array.isArray(selectedProviderRow.models)
      ? selectedProviderRow.models
      : [];

    const loadState = hooks.useCallback(() => {
      setLoading(true);
      setError("");
      setNotice("");
      fetchJSON(`${BASE}/state`)
        .then((next) => {
          setState(next);
          setChain(Array.isArray(next.chain) ? next.chain : []);
          setPrimaryDraft(next.primary || { provider: "", model: "" });
        })
        .catch((err) => setError(err instanceof Error ? err.message : String(err)))
        .finally(() => setLoading(false));
    }, []);

    hooks.useEffect(() => {
      loadState();
    }, [loadState]);

    const loadOptions = hooks.useCallback(() => {
      if (options.length > 0 || optionsLoading) return;
      setOptionsLoading(true);
      setError("");
      api.getModelOptions()
        .then((resp) => {
          const providers = Array.isArray(resp.providers) ? resp.providers : [];
          setOptions(providers);
          const initial = providers.find((p) => p.slug !== primaryDraft.provider) || providers[0];
          setSelectedProvider(initial ? initial.slug : "");
        })
        .catch((err) => setError(err instanceof Error ? err.message : String(err)))
        .finally(() => setOptionsLoading(false));
    }, [api, options.length, optionsLoading, primaryDraft]);

    hooks.useEffect(() => {
      setSelectedModel("");
    }, [selectedProvider]);

    function validationFor(entry, nextChain) {
      if (!entry.provider || !entry.model) return "Choose a provider and model.";
      if (sameEntry(entry, primaryDraft)) return "Fallback cannot match the primary model.";
      const count = nextChain.filter((item) => sameEntry(item, entry)).length;
      if (count > 0) return "This fallback is already in the list.";
      return "";
    }

    function addFallback() {
      const entry = { provider: selectedProvider, model: selectedModel };
      const problem = validationFor(entry, chain);
      if (problem) {
        setError(problem);
        return;
      }
      setError("");
      setNotice("");
      setChain(chain.concat([entry]));
      setSelectedModel("");
      setAdding(false);
    }

    function removeAt(index) {
      setError("");
      setNotice("");
      setChain(chain.filter((_, i) => i !== index));
    }

    function move(index, direction) {
      const target = index + direction;
      if (target < 0 || target >= chain.length) return;
      const next = chain.slice();
      const temp = next[index];
      next[index] = next[target];
      next[target] = temp;
      setError("");
      setNotice("");
      setChain(next);
    }

    function promoteToPrimary(index) {
      const picked = chain[index];
      const currentPrimary = primaryDraft;
      if (!picked || !hasIdentity(picked)) return;
      const remaining = chain.filter((_, i) => i !== index);
      const canDemoteCurrent = hasIdentity(currentPrimary) &&
        !sameEntry(currentPrimary, picked) &&
        !remaining.some((entry) => sameEntry(entry, currentPrimary));
      const nextChain = canDemoteCurrent ? [currentPrimary].concat(remaining) : remaining;
      setError("");
      setNotice("");
      setPrimaryDraft(picked);
      setChain(nextChain);
    }

    function moveTo(fromIndex, toIndex) {
      if (fromIndex === null || fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;
      if (fromIndex >= chain.length || toIndex >= chain.length) return;
      const next = chain.slice();
      const moved = next.splice(fromIndex, 1)[0];
      next.splice(toIndex, 0, moved);
      setError("");
      setNotice("");
      setChain(next);
    }

    function openAdd() {
      setAdding(true);
      loadOptions();
    }

    function handleDragStart(event, index) {
      setDragIndex(index);
      setDropIndex(index);
      setDropPrimary(false);
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", String(index));
      }
    }

    function handleDragOver(event, index) {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      setDropPrimary(false);
      if (dropIndex !== index) setDropIndex(index);
    }

    function handlePrimaryDragOver(event) {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      setDropPrimary(true);
      setDropIndex(null);
    }

    function handlePrimaryDrop(event) {
      event.preventDefault();
      promoteToPrimary(dragIndex);
      setDragIndex(null);
      setDropIndex(null);
      setDropPrimary(false);
    }

    function handleDrop(event, index) {
      event.preventDefault();
      moveTo(dragIndex, index);
      setDragIndex(null);
      setDropIndex(null);
      setDropPrimary(false);
    }

    function handleDragEnd() {
      setDragIndex(null);
      setDropIndex(null);
      setDropPrimary(false);
    }

    function handleCardKeyDown(event, index) {
      if (saving) return;
      if (event.key === "ArrowUp") {
        event.preventDefault();
        move(index, -1);
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        move(index, 1);
      }
    }

    function clearChain() {
      setError("");
      setNotice("");
      setAdding(false);
      setChain([]);
    }

    function resetEdits() {
      setError("");
      setNotice("");
      setAdding(false);
      setDropPrimary(false);
      setDropIndex(null);
      setDragIndex(null);
      setChain(state && Array.isArray(state.chain) ? state.chain : []);
      setPrimaryDraft(state && state.primary ? state.primary : { provider: "", model: "" });
    }

    function saveChain() {
      setSaving(true);
      setError("");
      setNotice("");
      fetchJSON(`${BASE}/chain`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chain, primary: primaryDraft }),
      })
        .then((next) => {
          setState(next);
          setChain(Array.isArray(next.chain) ? next.chain : []);
          setPrimaryDraft(next.primary || { provider: "", model: "" });
          setAdding(false);
          setNotice("Fallbacks saved. New sessions will use this order.");
        })
        .catch((err) => setError(err instanceof Error ? err.message : String(err)))
        .finally(() => setSaving(false));
    }

    function renderPrimary() {
      return h("section", {
        className: cx("hf-node-card hf-primary-card", dropPrimary && dragIndex !== null && "is-drop-primary"),
        onDragOver: handlePrimaryDragOver,
        onDrop: handlePrimaryDrop,
        title: "Drop here to make primary",
        "aria-label": `Primary model: ${displayEntry(primaryDraft)}`,
      },
        h("div", { className: "hf-node-index", "aria-hidden": "true" }, "P0"),
        h("div", { className: "hf-node-main min-w-0" },
          h("div", { className: "hf-node-kicker text-display" }, "primary"),
          h("div", { className: "hf-model-name" }, modelLabel(primaryDraft)),
          h("div", { className: "hf-model-provider" }, providerLabel(primaryDraft)),
        ),
          h("div", { className: "hf-node-side" },
            h(C.Badge, { tone: "secondary", className: "hf-badge" }, "active"),
          h("span", { className: "hf-model-note" }, "Drop a fallback here"),
          ),
      );
    }

    function renderEmptyState() {
      return h("div", { className: "hf-empty-card" },
        h("div", { className: "hf-empty-mark", "aria-hidden": "true" }, "00"),
        h("div", { className: "min-w-0" },
          h("div", { className: "hf-empty-title" }, "No fallbacks yet"),
          h("p", { className: "hf-empty-copy" },
            "Add backup models for outages, rate limits, or provider errors.",
          ),
        ),
        Button({
          size: "sm",
          onClick: openAdd,
          disabled: saving,
          className: "hf-action-button hf-add-inline",
          children: "Add fallback",
        }),
      );
    }

    function renderFallback(entry, index) {
      return h("div", {
        className: cx(
          "hf-node-card hf-fallback-card",
          dragIndex === index && "is-dragging",
          dropIndex === index && dragIndex !== index && "is-drop-target",
        ),
        draggable: !saving,
        key: `${entryKey(entry)}-${index}`,
        onDragStart: (event) => handleDragStart(event, index),
        onDragOver: (event) => handleDragOver(event, index),
        onDrop: (event) => handleDrop(event, index),
        onDragEnd: handleDragEnd,
        onKeyDown: (event) => handleCardKeyDown(event, index),
        role: "listitem",
        tabIndex: 0,
        title: "Drag or use arrow keys to reorder.",
        "aria-label": `Fallback ${index + 1}: ${displayEntry(entry)}`,
        "aria-grabbed": dragIndex === index ? "true" : "false",
      },
        h("div", { className: "hf-node-index hf-route-number", "aria-hidden": "true" }, stageNumber(index)),
        h("div", { className: "hf-node-main min-w-0" },
          h("div", { className: "hf-node-kicker text-display" }, `stage ${stageNumber(index)}`),
          h("div", { className: "hf-model-name" }, modelLabel(entry)),
          h("div", { className: "hf-model-provider" },
            providerLabel(entry),
            entry.base_url ? ` / ${entry.base_url}` : "",
          ),
        ),
        h("div", { className: "hf-row-actions" },
          SmallButton({ onClick: () => move(index, -1), disabled: index === 0 || saving, children: "Up" }),
          SmallButton({ onClick: () => move(index, 1), disabled: index === chain.length - 1 || saving, children: "Down" }),
          SmallButton({ onClick: () => promoteToPrimary(index), disabled: saving, children: "Primary" }),
          SmallButton({ onClick: () => removeAt(index), disabled: saving, className: "hf-remove-button", children: "Remove" }),
        ),
      );
    }

    function renderAddPanel() {
      const providerDisabled = optionsLoading || options.length === 0;
      const modelDisabled = optionsLoading || !selectedProvider || models.length === 0;
      const providerOptions = options.map((provider) => ({
        value: provider.slug,
        label: optionLabel(provider),
        meta: provider.slug,
      }));
      const modelOptions = models.map((model) => ({
        value: model,
        label: model,
      }));
      return h("div", { className: "hf-add-panel" },
        h("div", { className: "hf-add-head" },
          h("div", { className: "min-w-0" },
            h("div", { className: "hf-section-title text-display" }, "add fallback"),
            h("p", { className: "hf-section-copy" }, "Choose a backup model. Hermes tries it after the primary fails."),
          ),
          SmallButton({
            onClick: loadOptions,
            disabled: optionsLoading,
            children: optionsLoading ? "Loading..." : "Reload",
          }),
        ),
        h("div", { className: "hf-add-fields" },
          h("div", { className: "hf-field" },
            h(C.Label, { className: "hf-label" }, "Provider"),
            h(SearchSelect, {
              options: providerOptions,
              value: selectedProvider,
              onValueChange: setSelectedProvider,
              disabled: providerDisabled,
              placeholder: optionsLoading ? "Loading providers..." : options.length === 0 ? "No providers loaded" : "Choose provider",
              emptyLabel: "No providers found",
              onFocus: loadOptions,
            }),
          ),
          h("div", { className: "hf-field" },
            h(C.Label, { className: "hf-label" }, "Model"),
            h(SearchSelect, {
              options: modelOptions,
              value: selectedModel,
              onValueChange: setSelectedModel,
              disabled: modelDisabled,
              placeholder: !selectedProvider ? "Choose provider first" : models.length === 0 ? "No models loaded" : "Choose model",
              emptyLabel: "No models found",
              onFocus: loadOptions,
            }),
          ),
        ),
        selectedProviderRow
          ? h("div", { className: "hf-add-preview" },
            h("span", { className: "hf-preview-label text-display" }, "provider"),
            h("span", { className: "hf-preview-value" }, optionLabel(selectedProviderRow)),
          )
          : null,
        h("div", { className: "hf-add-actions" },
          Button({
            size: "sm",
            onClick: addFallback,
            disabled: !selectedProvider || !selectedModel,
            className: "hf-action-button hf-primary-action",
            children: "Add",
          }),
          SmallButton({ onClick: () => setAdding(false), disabled: saving, children: "Cancel" }),
        ),
      );
    }

    return h(C.Card, { className: "hf-panel min-w-0 max-w-full overflow-hidden" },
      h(C.CardHeader, { className: "hf-card-header" },
        h("div", { className: "hf-console-head" },
          h("div", { className: "hf-title-block min-w-0" },
            h("div", { className: "hf-title-row" },
              h("span", { className: "hf-eyebrow text-display" }, "fallbacks"),
              state && state.legacy_present && state.source === "fallback_model"
                ? h(C.Badge, { tone: "outline", className: "hf-badge" }, "legacy")
                : null,
            ),
            h(C.CardTitle, { className: "hf-title" }, "Fallback routing"),
            h("p", { className: "hf-subtitle" },
              "Set the backup order Hermes uses when the primary model fails.",
            ),
          ),
          h("div", { className: "hf-head-actions" },
            SmallButton({ onClick: loadState, disabled: loading || saving, children: "Refresh" }),
            SmallButton({ onClick: resetEdits, disabled: !dirty || saving, children: "Reset" }),
          ),
        ),
        h("div", { className: "hf-head-metrics" },
          h("div", { className: "hf-metric" },
            h("span", { className: "hf-metric-value" }, String(chain.length)),
            h("span", { className: "hf-metric-label" }, chainCountLabel(chain.length)),
          ),
          h("div", { className: "hf-metric" },
            h("span", { className: cx("hf-metric-value", dirty && "hf-dirty") }, dirty ? "Dirty" : "Clean"),
            h("span", { className: "hf-metric-label" }, syncLabel(dirty, saving)),
          ),
          h("div", { className: "hf-metric hf-source-metric" },
            h("span", { className: "hf-metric-value" }, sourceLabel(state)),
            h("span", { className: "hf-metric-label" }, "source"),
          ),
        ),
      ),
      h(C.CardContent, { className: "hf-card-content" },
        loading
          ? h("div", { className: "hf-loading", "aria-live": "polite" },
            h("div", { className: "hf-loading-bar" }),
            h("p", { className: "hf-status" }, "Loading..."),
          )
          : null,
        error
          ? h("div", { className: "hf-alert hf-alert-error", role: "alert" }, error)
          : null,
        notice
          ? h("div", { className: "hf-alert hf-alert-ok", role: "status" }, notice)
          : null,
        !loading && state
          ? h("div", { className: "hf-routing-stack" },
            renderPrimary(),
            h(C.Separator, { className: "hf-route-separator" }),
            h("div", { className: "hf-chain-section" },
              h("div", { className: "hf-section-head" },
                h("div", { className: "min-w-0" },
                  h("div", { className: "hf-section-title text-display" }, "fallback order"),
                  h("p", { className: "hf-section-copy" },
                    chain.length > 0
                      ? "Drag, use arrow keys, or use the buttons to reorder."
                      : "No backup models yet.",
                  ),
                ),
                !adding
                  ? Button({
                    size: "sm",
                    onClick: openAdd,
                    disabled: saving,
                    className: "hf-action-button hf-add-toggle",
                    children: "Add fallback",
                  })
                  : null,
              ),
              h("div", { className: "hf-chain-list", role: "list", "aria-label": "Fallback models" },
                chain.length === 0
                  ? renderEmptyState()
                  : chain.map((entry, index) => renderFallback(entry, index)),
              ),
            ),
            adding ? renderAddPanel() : null,
            h("div", { className: "hf-footer" },
              h("span", { className: dirty ? "hf-sync hf-dirty" : "hf-sync" },
                syncLabel(dirty, saving),
              ),
              h("div", { className: "hf-footer-actions" },
                SmallButton({ onClick: clearChain, disabled: chain.length === 0 || saving, children: "Clear all" }),
                Button({
                  size: "sm",
                  disabled: !dirty || saving,
                  onClick: saveChain,
                  className: "hf-action-button hf-save-button",
                  children: saving ? "Saving..." : "Save",
                }),
              ),
            ),
          )
          : null,
      ),
    );
  }

  window.__HERMES_PLUGINS__.register(PLUGIN, function HiddenFallbackPage() {
    return null;
  });
  window.__HERMES_PLUGINS__.registerSlot(PLUGIN, "models:top", FallbackPanel);
})();
