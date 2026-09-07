"use strict";

(function initAppOrchestration(global) {
  function getMobileErrorPanelElements() {
    return {
      panel: document.getElementById("mobileErrorPanel"),
      text: document.getElementById("mobileErrorPanelText")
    };
  }

  function isMobileDebugPanelEnabled() {
    try {
      const params = new URLSearchParams(window.location.search || "");
      return params.get("debug") === "1";
    } catch {
      return false;
    }
  }

  function showMobileRuntimeError(details, options = {}) {
    const { force = false } = options;
    if (!force && !isMobileDebugPanelEnabled()) return;

    const { panel, text } = getMobileErrorPanelElements();
    if (!panel || !text) return;

    const nextMessage = [
      `Zeit: ${new Date().toISOString()}`,
      `Fehler: ${details.message || "Unbekannter Fehler"}`,
      `Datei: ${details.file || "-"}`,
      `Zeile: ${details.line || "-"}`,
      details.column ? `Spalte: ${details.column}` : ""
    ].filter(Boolean).join("\n");

    text.textContent = `${nextMessage}\n\n${text.textContent || ""}`.trim();
    panel.classList.remove("hidden");
  }

  function bindRuntimeErrorListeners() {
    window.addEventListener("error", (event) => {
      showMobileRuntimeError({
        message: event.message,
        file: event.filename,
        line: event.lineno,
        column: event.colno
      });
    });

    window.addEventListener("unhandledrejection", (event) => {
      const reason = event.reason;
      const message = typeof reason === "string"
        ? reason
        : reason?.message || JSON.stringify(reason);

      showMobileRuntimeError({
        message,
        file: reason?.fileName || reason?.sourceURL || "",
        line: reason?.line || reason?.lineNumber || ""
      });
    });
  }

  function sanitizeCurrentView(view) {
    if (view === "form") return "mep";
    if (["day", "week", "month", "overview", "mep"].includes(view)) return view;
    return "week";
  }

  function sanitizeUiState(rawUi, defaultUiStateFactory) {
    const mergedUi = { ...defaultUiStateFactory(), ...(rawUi || {}) };
    return {
      ...mergedUi,
      currentView: sanitizeCurrentView(mergedUi.currentView),
      mepAnonymized: Boolean(mergedUi.mepAnonymized)
    };
  }

  function createResponsiveViewController(config) {
    const {
      getCurrentView,
      renderMepTemplateView,
      postRenderSync,
      debugLogger = () => {}
    } = config;

    let timerIds = [];
    let lastMepFitMetricsKey = "";
    let lastRefreshView = "";
    let pageShowTriggered = false;
    let traceCounter = 0;

    function createTraceId() {
      traceCounter += 1;
      return `mep-refresh-${Date.now()}-${traceCounter}`;
    }

    function logTrace(traceId, stage, payload = {}) {
      debugLogger(`[responsive-mep][${traceId}] ${stage}`, payload);
    }

    function isMepViewActive() {
      return (getCurrentView?.() || "week") === "mep";
    }

    function updateAppViewportHeightVar() {
      const viewportHeight = window.visualViewport?.height || window.innerHeight;
      if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) return;

      const onePercent = viewportHeight * 0.01;
      document.documentElement.style.setProperty("--app-vh", `${onePercent}px`);
      document.documentElement.style.setProperty("--app-dvh", `${viewportHeight}px`);
    }

    function updateEmbeddedViewMaxHeightVar(selector, cssVar) {
      const viewportHeight = window.visualViewport?.height || window.innerHeight;
      const targetEl = document.querySelector(selector);

      if (!targetEl || !Number.isFinite(viewportHeight) || viewportHeight <= 0) {
        document.documentElement.style.removeProperty(cssVar);
        return;
      }

      const rect = targetEl.getBoundingClientRect();
      const topOffset = Math.max(rect.top, 0);
      const availableHeight = Math.max(240, Math.floor(viewportHeight - topOffset - 12));
      document.documentElement.style.setProperty(cssVar, `${availableHeight}px`);
    }

    function updateResponsiveViewportMetrics() {
      updateAppViewportHeightVar();
      updateEmbeddedViewMaxHeightVar("#mepTemplateView", "--mep-template-view-max-height");
    }

    function getMepFitMetricsKey() {
      const viewEl = document.getElementById("mepTemplateView");
      const pagesEl = document.getElementById("mepTemplatePages");
      const viewportWidth = Math.round(window.visualViewport?.width || window.innerWidth || 0);
      const viewportHeight = Math.round(window.visualViewport?.height || window.innerHeight || 0);
      const viewRect = viewEl?.getBoundingClientRect?.() || null;
      const pagesRect = pagesEl?.getBoundingClientRect?.() || null;

      return [
        viewportWidth,
        viewportHeight,
        window.screen?.orientation?.type || window.orientation || "",
        viewRect ? `${Math.round(viewRect.width)}x${Math.round(viewRect.height)}@${Math.round(viewRect.top)}` : "",
        pagesRect ? `${Math.round(pagesRect.width)}x${Math.round(pagesRect.height)}` : "",
        pagesEl?.childElementCount || 0
      ].join("|");
    }

    async function refreshMepTemplateViewIfNeeded(options = {}) {
      const { force = false, traceId = "no-trace" } = options;
      if (!isMepViewActive() || typeof renderMepTemplateView !== "function") return false;

      const metricsKey = getMepFitMetricsKey();
      const metricsChanged = metricsKey !== lastMepFitMetricsKey;
      logTrace(traceId, "metrics-check", {
        force,
        metricsChanged,
        previousKey: lastMepFitMetricsKey,
        nextKey: metricsKey
      });

      if (!force && !metricsChanged) {
        logTrace(traceId, "refresh-skip");
        return false;
      }

      lastMepFitMetricsKey = metricsKey;
      logTrace(traceId, "render-start", { scope: "month" });
      renderMepTemplateView({ scope: "month" });
      logTrace(traceId, "render-end");

      if (typeof postRenderSync === "function") {
        logTrace(traceId, "post-render-sync-start");
        await Promise.resolve(postRenderSync());
        logTrace(traceId, "post-render-sync-end");
      }

      return true;
    }

    function scheduleRefresh(options = {}) {
      const {
        delays = [120],
        force = false,
        traceId = createTraceId()
      } = options;

      timerIds.forEach((timerId) => window.clearTimeout(timerId));
      timerIds = [];
      let hasRenderedInBatch = false;

      logTrace(traceId, "schedule", { delays, force });

      delays.forEach((delay) => {
        const safeDelay = Number.isFinite(delay) ? Math.max(0, delay) : 0;
        const timerId = window.setTimeout(async () => {
          try {
            timerIds = timerIds.filter((id) => id !== timerId);
            if (!isMepViewActive()) {
              logTrace(traceId, "timer-skip-inactive", { delay: safeDelay });
              return;
            }

            const shouldForceFit = force && !hasRenderedInBatch;
            updateResponsiveViewportMetrics();
            const hasRendered = await refreshMepTemplateViewIfNeeded({
              force: shouldForceFit,
              traceId
            });
            hasRenderedInBatch = hasRenderedInBatch || hasRendered;
            logTrace(traceId, "timer-run", {
              delay: safeDelay,
              force: shouldForceFit,
              hasRendered,
              hasRenderedInBatch
            });
          } catch (error) {
            logTrace(traceId, "timer-error", {
              delay: safeDelay,
              message: error?.message || String(error)
            });
          }
        }, safeDelay);

        timerIds.push(timerId);
      });
    }

    function requestActiveViewRefresh(options = {}) {
      const { force = false } = options;
      const currentView = getCurrentView?.() || "week";
      const switchedToMep = currentView === "mep" && lastRefreshView !== "mep";
      lastRefreshView = currentView;

      if (currentView !== "mep") return;
      if (!force && !switchedToMep) return;
      scheduleRefresh({ force: true });
    }

    function triggerFirstPageShowRefresh() {
      if (pageShowTriggered) return false;
      pageShowTriggered = true;
      scheduleRefresh({ force: true });
      return true;
    }

    return {
      requestActiveViewRefresh,
      scheduleRefresh,
      triggerFirstPageShowRefresh,
      updateResponsiveViewportMetrics
    };
  }

  function createStartupSelfTest(options = {}) {
    const startupMutableHelpers = { warnedUnknownShiftCodes: null };
    const {
      getShiftRuleByCode,
      normalizeShiftCode
    } = options;

    function isStartupSelfTestEnabled() {
      const isDebugFlagEnabled = isMobileDebugPanelEnabled();
      const hostName = (window.location?.hostname || "").toLowerCase();
      const isLocalHost = ["localhost", "127.0.0.1", "::1"].includes(hostName);
      const isLocalFile = window.location?.protocol === "file:";
      return isDebugFlagEnabled || isLocalHost || isLocalFile;
    }

    function runStartupSelfTest() {
      if (!isStartupSelfTestEnabled()) return;
      const globalChecks = [
        ["getShiftRuleByCode", typeof getShiftRuleByCode === "function"],
        ["normalizeShiftCode", typeof normalizeShiftCode === "function"],
        ["warnedUnknownShiftCodes", "warnedUnknownShiftCodes" in startupMutableHelpers]
      ];
      const failedChecks = globalChecks.filter(([, ok]) => !ok);
      if (!failedChecks.length) return;
      const missingNames = failedChecks.map(([name]) => name).join(", ");
      throw new Error(`Startup-Selbsttest fehlgeschlagen. Fehlende Globals: ${missingNames}`);
    }

    function getWarnedUnknownShiftCodesSet() {
      if (!(startupMutableHelpers.warnedUnknownShiftCodes instanceof Set)) {
        startupMutableHelpers.warnedUnknownShiftCodes = new Set();
      }
      return startupMutableHelpers.warnedUnknownShiftCodes;
    }

    return {
      getWarnedUnknownShiftCodesSet,
      isStartupSelfTestEnabled,
      runStartupSelfTest
    };
  }

  global.AppOrchestration = {
    bindRuntimeErrorListeners,
    createResponsiveViewController,
    createStartupSelfTest,
    isMobileDebugPanelEnabled,
    sanitizeUiState,
    showMobileRuntimeError
  };
})(window);
