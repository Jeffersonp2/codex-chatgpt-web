const { contextBridge, ipcRenderer } = require("electron");

function subscription(channel, listener) {
  const wrapped = (_event, value) => listener(value);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

contextBridge.exposeInMainWorld("codexWebLauncher", {
  snapshot: () => ipcRenderer.invoke("launcher:snapshot"),
  setLanguage: (language) => ipcRenderer.invoke("launcher:set-language", language),
  openSocial: (target) => ipcRenderer.invoke("launcher:open-social", target),
  completeOnboarding: (language, browserInteractionMode) => ipcRenderer.invoke(
    "launcher:complete-onboarding",
    language,
    browserInteractionMode,
  ),
  openExternal: (url) => ipcRenderer.invoke("launcher:open-external", url),
  setBrowserBounds: (bounds) => ipcRenderer.invoke("launcher:browser-bounds", bounds),
  setBrowserSurfaceActive: (active) => ipcRenderer.invoke("launcher:browser-surface-active", active),
  showBrowser: () => ipcRenderer.invoke("launcher:browser-show"),
  hideBrowser: () => ipcRenderer.invoke("launcher:browser-hide"),
  navigateBrowser: (action) => ipcRenderer.invoke("launcher:browser-navigate", action),
  zoomBrowser: (action) => ipcRenderer.invoke("launcher:browser-zoom", action),
  selectBrowserTab: (tabId) => ipcRenderer.invoke("launcher:browser-tab-select", tabId),
  closeBrowserTab: (tabId) => ipcRenderer.invoke("launcher:browser-tab-close", tabId),
  copyManualPrompt: (tabId) => ipcRenderer.invoke("launcher:manual-prompt-copy", tabId),
  confirmManualSent: (tabId) => ipcRenderer.invoke("launcher:manual-prompt-sent", tabId),
  openLogin: () => ipcRenderer.invoke("launcher:browser-login"),
  openPasskeyLogin: () => ipcRenderer.invoke("launcher:browser-passkey-login"),
  continuePasskeyLogin: () => ipcRenderer.invoke("launcher:browser-passkey-login-continue"),
  logoutChatGpt: () => ipcRenderer.invoke("launcher:browser-logout"),
  dismissSessionReminder: () => ipcRenderer.invoke("launcher:session-reminder-dismiss"),
  smokeTest: () => ipcRenderer.invoke("launcher:browser-smoke"),
  verifyMcp: () => ipcRenderer.invoke("launcher:mcp-verify"),
  doctor: () => ipcRenderer.invoke("launcher:doctor"),
  cancelTurns: () => ipcRenderer.invoke("launcher:cancel-turns"),
  uninstallIntegration: () => ipcRenderer.invoke("launcher:uninstall-integration"),
  setupCore: () => ipcRenderer.invoke("launcher:setup-core"),
  setupMcp: (input) => ipcRenderer.invoke("launcher:setup-mcp", input),
  setMcpStep: (step) => ipcRenderer.invoke("launcher:set-mcp-step", step),
  setAutostart: (enabled) => ipcRenderer.invoke("launcher:autostart", enabled),
  setBiggerContext: (enabled) => ipcRenderer.invoke("launcher:bigger-context", enabled),
  setZeroRiskPro: (enabled) => ipcRenderer.invoke("launcher:zero-risk-pro", enabled),
  setBrowserInteractionMode: (mode) => ipcRenderer.invoke("launcher:browser-interaction-mode", mode),
  setPreference: (key, value) => ipcRenderer.invoke("launcher:set-preference", key, value),
  setSidebarState: (state) => ipcRenderer.invoke("launcher:sidebar-state", state),
  logs: (limit) => ipcRenderer.invoke("launcher:logs", limit),
  exportLogs: () => ipcRenderer.invoke("launcher:export-logs"),
  installUpdate: () => ipcRenderer.invoke("launcher:update-install"),
  windowState: () => ipcRenderer.invoke("launcher:window-state"),
  windowControl: (action) => ipcRenderer.send("launcher:window-control", action),
  onWindowStateChanged: (listener) => subscription("launcher:window-state-changed", listener),
  onStateChanged: (listener) => subscription("launcher:state-changed", listener),
  onBrowserState: (listener) => subscription("launcher:browser-state", listener),
  onOperation: (listener) => subscription("launcher:operation", listener),
  onLog: (listener) => subscription("launcher:log", listener),
  onUpdateState: (listener) => subscription("launcher:update-state", listener),
});

const DEFAULT_PROVIDER_SETTINGS = Object.freeze({
  version: 1,
  enabled: true,
  url: "http://127.0.0.1",
  port: 11435,
});

function providerCopy() {
  const language = document.documentElement.lang.toLowerCase();
  if (language.startsWith("pt")) {
    return {
      title: "Provider 9Router",
      enabled: "Ativar provider 9Router",
      enabledBody: "Disponibiliza os modelos ChatGPT Web para o 9Router usando OpenAI Responses.",
      url: "URL local",
      port: "Porta",
      endpoint: "Endpoint",
      save: "Salvar configurações",
      saved: "Salvo. Reinicie o Codex Web GPT para aplicar as alterações.",
      invalid: "Não foi possível salvar as configurações do provider.",
      restart: "As alterações entram em vigor no próximo reinício do aplicativo.",
    };
  }
  return {
    title: "9Router Provider",
    enabled: "Enable 9Router provider",
    enabledBody: "Expose ChatGPT Web models to 9Router using the OpenAI Responses protocol.",
    url: "Local URL",
    port: "Port",
    endpoint: "Endpoint",
    save: "Save settings",
    saved: "Saved. Restart Codex Web GPT to apply the changes.",
    invalid: "Could not save the provider settings.",
    restart: "Changes take effect the next time the application starts.",
  };
}

let providerPanelPending = false;

async function readProviderSettings() {
  try {
    const settings = await ipcRenderer.invoke("launcher:provider-settings-read");
    return settings && typeof settings === "object"
      ? settings
      : { ...DEFAULT_PROVIDER_SETTINGS };
  } catch {
    return { ...DEFAULT_PROVIDER_SETTINGS };
  }
}

async function ensureProviderSettingsPanel() {
  if (providerPanelPending || !document.body) return;
  const settingsList = document.querySelector(".settings-list");
  if (!settingsList) return;
  const content = settingsList.closest(".content-scroll");
  if (!content || content.querySelector("#router-provider-settings")) return;

  providerPanelPending = true;
  try {
    const copy = providerCopy();
    let settings = await readProviderSettings();
    if (!document.body || !settingsList.isConnected || content.querySelector("#router-provider-settings")) return;

    const section = document.createElement("section");
    section.id = "router-provider-settings";
    section.style.marginTop = "24px";
    section.innerHTML = `
      <div class="section-heading is-spaced">
        <span>${copy.title}</span>
      </div>
      <div class="settings-list">
        <div class="setting-row">
          <div>
            <strong>${copy.enabled}</strong>
            <p>${copy.enabledBody}</p>
          </div>
          <button aria-checked="${settings.enabled ? "true" : "false"}" class="switch${settings.enabled ? " is-on" : ""}" id="router-provider-enabled" role="switch" type="button"><span></span></button>
        </div>
        <div class="field-list" style="margin-top:12px">
          <label class="field-row">
            <span>${copy.url}</span>
            <input id="router-provider-url" value="${settings.url}" autocomplete="off" spellcheck="false" />
          </label>
          <label class="field-row">
            <span>${copy.port}</span>
            <input id="router-provider-port" value="${settings.port}" min="1" max="65535" inputmode="numeric" type="number" />
          </label>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:12px;flex-wrap:wrap">
          <small id="router-provider-endpoint" style="opacity:.72">${copy.endpoint}: ${settings.url}:${settings.port}/v1</small>
          <button class="button-secondary" id="router-provider-save" type="button"><span>${copy.save}</span></button>
        </div>
        <small id="router-provider-status" style="display:block;margin-top:8px;opacity:.72">${copy.restart}</small>
      </div>
    `;

    settingsList.insertAdjacentElement("afterend", section);

    const enabledButton = section.querySelector("#router-provider-enabled");
    const urlInput = section.querySelector("#router-provider-url");
    const portInput = section.querySelector("#router-provider-port");
    const endpoint = section.querySelector("#router-provider-endpoint");
    const status = section.querySelector("#router-provider-status");
    const saveButton = section.querySelector("#router-provider-save");

    const renderEnabled = (enabled) => {
      enabledButton?.setAttribute("aria-checked", enabled ? "true" : "false");
      enabledButton?.classList.toggle("is-on", enabled);
      if (urlInput) urlInput.disabled = !enabled;
      if (portInput) portInput.disabled = !enabled;
    };
    const renderEndpoint = () => {
      if (!endpoint || !urlInput || !portInput) return;
      endpoint.textContent = `${copy.endpoint}: ${urlInput.value.trim()}:${portInput.value.trim()}/v1`;
    };

    renderEnabled(settings.enabled);
    enabledButton?.addEventListener("click", () => {
      settings = { ...settings, enabled: enabledButton.getAttribute("aria-checked") !== "true" };
      renderEnabled(settings.enabled);
    });
    urlInput?.addEventListener("input", renderEndpoint);
    portInput?.addEventListener("input", renderEndpoint);
    saveButton?.addEventListener("click", async () => {
      if (!urlInput || !portInput || !status) return;
      saveButton.disabled = true;
      try {
        settings = await ipcRenderer.invoke("launcher:provider-settings-write", {
          enabled: settings.enabled,
          url: urlInput.value,
          port: Number(portInput.value),
        });
        urlInput.value = settings.url;
        portInput.value = String(settings.port);
        renderEnabled(settings.enabled);
        renderEndpoint();
        status.textContent = copy.saved;
        status.style.opacity = "1";
      } catch (error) {
        status.textContent = `${copy.invalid} ${error instanceof Error ? error.message : String(error)}`;
        status.style.opacity = "1";
      } finally {
        saveButton.disabled = false;
      }
    });
  } finally {
    providerPanelPending = false;
  }
}

window.addEventListener("DOMContentLoaded", () => {
  void ensureProviderSettingsPanel();
  const observer = new MutationObserver(() => { void ensureProviderSettingsPanel(); });
  observer.observe(document.body, { childList: true, subtree: true });
});
