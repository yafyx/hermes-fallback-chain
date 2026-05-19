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
    return `${entry.provider || "(unknown provider)"} · ${entry.model || "(provider default)"}`;
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

  function Button(props) {
    return h(C.Button, props, props.children);
  }

  function SmallButton(props) {
    const className = cx("hf-small-button text-[10px] h-7", props.className);
    const next = Object.assign({ size: "sm", outlined: true }, props, { className });
    return h(C.Button, next, props.children);
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
          const initial = providers.find((p) => !state || p.slug !== state.primary.provider) || providers[0];
          setSelectedProvider(initial ? initial.slug : "");
        })
        .catch((err) => setError(err instanceof Error ? err.message : String(err)))
        .finally(() => setOptionsLoading(false));
    }, [api, options.length, optionsLoading, state]);

    hooks.useEffect(() => {
      if (!selectedProviderRow) {
        setSelectedModel("");
        return;
      }
      setSelectedModel("");
    }, [selectedProvider]);

    function validationFor(entry, nextChain) {
      if (!entry.provider || !entry.model) return "Choose a provider and model first.";
      if (state && sameEntry(entry, state.primary)) return "Fallback cannot match the current primary model.";
      const count = nextChain.filter((item) => sameEntry(item, entry)).length;
      if (count > 0) return "That provider/model is already in the fallback chain.";
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
          setNotice("Fallback chain saved. Changes apply to new sessions and gateway runs.");
        })
        .catch((err) => setError(err instanceof Error ? err.message : String(err)))
        .finally(() => setSaving(false));
    }

    return h(C.Card, { className: "hf-panel min-w-0 max-w-full overflow-hidden" },
      h(C.CardHeader, { className: "pb-3" },
        h("div", { className: "flex min-w-0 flex-wrap items-start justify-between gap-3" },
          h("div", { className: "min-w-0" },
            h("div", { className: "flex items-center gap-2" },
              h(C.CardTitle, { className: "text-sm" }, "Default Fallback Routing"),
              state && state.legacy_present && state.source === "fallback_model"
                ? h(C.Badge, { tone: "outline", className: "text-[10px]" }, "legacy")
                : null,
            ),
            h("p", { className: "mt-1 text-xs hf-muted" },
              "Pick one primary model and configure fallbacks. Hermes tries fallbacks in order when the primary fails. Drag a fallback onto primary to promote it.",
            ),
          ),
          h("div", { className: "hf-head-actions" },
            SmallButton({ onClick: loadState, disabled: loading || saving, children: "Refresh" }),
            SmallButton({ onClick: resetEdits, disabled: !dirty || saving, children: "Reset" }),
          ),
        ),
      ),
      h(C.CardContent, { className: "space-y-3 pt-3 pb-3" },
        loading
          ? h("p", { className: "hf-status hf-muted" }, "Loading fallback settings...")
          : null,
        error
          ? h("div", { className: "hf-alert hf-alert-error" }, error)
          : null,
        notice
          ? h("div", { className: "hf-alert hf-alert-ok" }, notice)
          : null,
        !loading && state
          ? h("div", { className: "hf-routing-stack" },
            h("div", {
              className: cx("hf-model-card hf-primary-card", dropPrimary && dragIndex !== null && "is-drop-primary"),
              onDragOver: handlePrimaryDragOver,
              onDrop: handlePrimaryDrop,
              title: "Drop a fallback here to promote it to primary",
            },
              h("div", { className: "hf-model-topline" },
                h("div", { className: "min-w-0" },
                  h("div", { className: "hf-model-name" }, modelLabel(primaryDraft)),
                  h("div", { className: "hf-model-provider" }, providerLabel(primaryDraft)),
                ),
                h(C.Badge, { tone: "secondary", className: "text-[10px]" }, "primary"),
              ),
              h("div", { className: "hf-model-note" }, "Drop a fallback card here to promote it. Changes apply after Save chain."),
            ),

            h("div", { className: "hf-chain-list", role: "list", "aria-label": "Fallback providers" },
              chain.length === 0
                ? h("div", { className: "hf-empty-card" },
                  h("div", { className: "hf-empty-title" }, "No fallbacks configured"),
                  h("div", { className: "hf-empty-copy" }, "Add backup models to recover from outages, rate limits, or transient failures."),
                )
                : chain.map((entry, index) => h("div", {
                  className: cx(
                    "hf-model-card hf-fallback-card",
                    dragIndex === index && "is-dragging",
                    dropIndex === index && dragIndex !== index && "is-drop-target",
                  ),
                  draggable: !saving,
                  key: `${entryKey(entry)}-${index}`,
                  onDragStart: (event) => handleDragStart(event, index),
                  onDragOver: (event) => handleDragOver(event, index),
                  onDrop: (event) => handleDrop(event, index),
                  onDragEnd: handleDragEnd,
                  role: "listitem",
                  tabIndex: 0,
                  title: "Drag to reorder",
                },
                  h("span", { className: "hf-drag-handle", "aria-hidden": "true" }, "::"),
                  h("div", { className: "min-w-0" },
                    h("div", { className: "hf-model-name" }, modelLabel(entry)),
                    h("div", { className: "hf-model-provider" },
                      providerLabel(entry),
                      entry.base_url ? ` / ${entry.base_url}` : "",
                    ),
                  ),
                  h("div", { className: "hf-row-actions" },
                    SmallButton({ onClick: () => move(index, -1), disabled: index === 0 || saving, children: "Up" }),
                    SmallButton({ onClick: () => move(index, 1), disabled: index === chain.length - 1 || saving, children: "Down" }),
                    SmallButton({ onClick: () => removeAt(index), disabled: saving, className: "hf-remove-button", children: "Remove" }),
                  ),
                )),
            ),

            adding
              ? h("div", { className: "hf-add-panel" },
                h("div", { className: "hf-add-fields" },
                  h("label", { className: "hf-field" },
                    h("span", null, "Provider"),
                    h("select", {
                      className: "hf-select",
                      value: selectedProvider,
                      onFocus: loadOptions,
                      onChange: (event) => setSelectedProvider(event.target.value),
                      disabled: optionsLoading,
                    },
                      optionsLoading
                        ? h("option", { value: "" }, "Loading...")
                        : options.length === 0
                          ? h("option", { value: "" }, "Click to load")
                          : options.map((provider) => h("option", { key: provider.slug, value: provider.slug }, provider.name || provider.slug)),
                    ),
                  ),
                  h("label", { className: "hf-field" },
                    h("span", null, "Model"),
                    h("select", {
                      className: "hf-select",
                      value: selectedModel,
                      onFocus: loadOptions,
                      onChange: (event) => setSelectedModel(event.target.value),
                      disabled: optionsLoading || !selectedProvider || models.length === 0,
                    },
                      !selectedProvider
                        ? h("option", { value: "" }, "Choose provider first")
                        : models.length === 0
                          ? h("option", { value: "" }, "No models loaded")
                          : [
                            h("option", { key: "__empty", value: "" }, "Choose a model"),
                            ...models.map((model) => h("option", { key: model, value: model }, model)),
                          ],
                    ),
                  ),
                ),
                h("div", { className: "hf-add-actions" },
                  Button({
                    size: "sm",
                    onClick: addFallback,
                    disabled: !selectedProvider || !selectedModel,
                    className: "hf-primary-action",
                    children: "Add selected",
                  }),
                  SmallButton({ onClick: () => setAdding(false), disabled: saving, children: "Cancel" }),
                ),
              )
              : Button({
                size: "sm",
                onClick: openAdd,
                disabled: saving,
                className: "hf-add-toggle",
                children: "Add fallback",
              }),

            h("div", { className: "hf-footer" },
              h("span", { className: dirty ? "hf-sync hf-dirty" : "hf-sync hf-muted" },
                dirty ? "Unsaved fallback edits" : "Fallback chain is in sync with config.yaml",
              ),
              h("div", { className: "hf-footer-actions" },
                SmallButton({ onClick: clearChain, disabled: chain.length === 0 || saving, children: "Clear all" }),
                Button({
                  size: "sm",
                  disabled: !dirty || saving,
                  onClick: saveChain,
                  className: "hf-save-button",
                  children: saving ? "Saving..." : "Save chain",
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
