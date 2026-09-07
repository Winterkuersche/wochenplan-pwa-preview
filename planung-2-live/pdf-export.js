const DRIVE_UPLOAD_CONFIG = Object.freeze({
  folderId: window.WOCHENPLAN_DRIVE_CONFIG?.folderId || "",
  clientId: window.WOCHENPLAN_DRIVE_CONFIG?.clientId || "",
  scope: window.WOCHENPLAN_DRIVE_CONFIG?.scope || "https://www.googleapis.com/auth/drive",
  enabled: Boolean(window.WOCHENPLAN_DRIVE_CONFIG?.enabled)
});

let driveTokenClient = null;
let driveAccessToken = "";
let lastOverviewPdfCache = null;

// =============================================================================
// Lokaler PDF-Exportpfad (Capture + PDF-Erzeugung)
// Ziel: export-ready Daten (Canvas) -> PDF-Blob, ohne Cloud-Abhängigkeit.
// =============================================================================

function buildMepPdfFilename() {
  const monthValue = state.activeMonth || (state.weekFrom || new Date().toISOString().slice(0, 10)).slice(0, 7);
  return `mep-${String(monthValue).replace(/[^0-9-]+/g, "-")}.pdf`;
}

function buildOverviewPdfFilename() {
  const monthValue = state.activeMonth || (state.weekFrom || new Date().toISOString().slice(0, 10)).slice(0, 7);
  return `uebersicht-${String(monthValue).replace(/[^0-9-]+/g, "-")}.pdf`;
}

function copyMepLayoutVariablesToNode(targetNode) {
  if (!targetNode) return;

  const sourceStyle = window.getComputedStyle(document.documentElement);
  [
    "--mep-sheet-inner-height",
    "--mep-header-height",
    "--mep-footer-height",
    "--mep-bottom-gap",
    "--mep-table-head-height",
    "--mep-employees-per-sheet",
  ].forEach((varName) => {
    const value = sourceStyle.getPropertyValue(varName).trim();
    if (value) {
      targetNode.style.setProperty(varName, value);
    }
  });
}

function createMepPdfExportRoot() {
  const pagesEl = document.getElementById("mepTemplatePages");
  if (!pagesEl) return null;

  const exportRoot = document.createElement("div");
  Object.assign(exportRoot.style, {
    position: "fixed",
    left: "-200vw",
    top: "0",
    width: "297mm",
    padding: "0",
    margin: "0",
    background: "#fff",
    zIndex: "-1",
    pointerEvents: "none"
  });

  const clonePagesEl = pagesEl.cloneNode(true);
  clonePagesEl.style.display = "block";
  clonePagesEl.style.gap = "0";

  clonePagesEl.querySelectorAll(".mepTplSheet").forEach((sheetEl) => {
    sheetEl.style.margin = "0";
    sheetEl.style.breakAfter = "page";
    sheetEl.style.pageBreakAfter = "always";
  });

  const lastSheetEl = clonePagesEl.querySelector(".mepTplSheet:last-child");
  if (lastSheetEl) {
    lastSheetEl.style.breakAfter = "auto";
    lastSheetEl.style.pageBreakAfter = "auto";
  }

  exportRoot.appendChild(clonePagesEl);
  copyMepLayoutVariablesToNode(exportRoot);
  document.body.appendChild(exportRoot);

  if (typeof syncMepOutsideRunMarkers === "function") {
    syncMepOutsideRunMarkers(clonePagesEl);
  }

  return exportRoot;
}

function isIosLikeDevice() {
  const userAgent = navigator.userAgent || "";
  const platform = navigator.platform || "";
  const touchPoints = Number(navigator.maxTouchPoints || 0);

  return /iPad|iPhone|iPod/.test(userAgent) || (platform === "MacIntel" && touchPoints > 1);
}

function buildMepExportDebugContext(context = {}) {
  const mergedContext = {
    windowInnerWidth: window.innerWidth,
    devicePixelRatio: window.devicePixelRatio || 1,
    isIosLikeDevice: isIosLikeDevice(),
    ...context
  };

  return {
    ...mergedContext,
    currentExportStep: mergedContext.currentExportStep || "init",
    currentSheetIndex: Number.isFinite(mergedContext.currentSheetIndex) ? mergedContext.currentSheetIndex : -1,
    currentPageNumber: Number.isFinite(mergedContext.currentSheetIndex) ? mergedContext.currentSheetIndex + 1 : null,
    totalSheets: Number.isFinite(mergedContext.totalSheets) ? mergedContext.totalSheets : 0,
    currentScale: mergedContext.currentScale || null
  };
}

function logMepExportError(message, error, context = {}) {
  const debugContext = buildMepExportDebugContext(context);
  console.error(message, {
    error,
    currentExportStep: debugContext.currentExportStep,
    currentPageNumber: debugContext.currentPageNumber,
    currentSheetIndex: debugContext.currentSheetIndex,
    currentScale: debugContext.currentScale,
    windowInnerWidth: debugContext.windowInnerWidth,
    devicePixelRatio: debugContext.devicePixelRatio,
    totalSheets: debugContext.totalSheets,
    isIosLikeDevice: debugContext.isIosLikeDevice,
    deliveryMethod: debugContext.deliveryMethod || null,
    filename: debugContext.filename || null
  });
}

function buildMepExportUserMessage(context = {}) {
  const debugContext = buildMepExportDebugContext(context);
  const failedPageHint = debugContext.currentPageNumber
    ? ` Abbruch bei Seite ${debugContext.currentPageNumber} von ${debugContext.totalSheets || "?"}.`
    : "";
  const mobileHint = debugContext.windowInnerWidth <= 820 || debugContext.isIosLikeDevice
    ? " Auf Mobilgeräten kann der Monats-Export zu groß sein."
    : "";

  return `PDF-Export fehlgeschlagen.${failedPageHint}${mobileHint} Bitte Browser-Druckansicht öffnen oder auf Wochenansicht wechseln und dort exportieren.`;
}

function offerMepExportFallback(context = {}) {
  const message = `${buildMepExportUserMessage(context)}

Fallback jetzt öffnen?`;
  const shouldOpenPrint = window.confirm(message);

  if (shouldOpenPrint) {
    window.print();
    return;
  }

  alert("Tipp: Wechsle zur Wochenansicht und nutze dort 'Drucken / PDF', falls der Monats-Export auf diesem Gerät zu groß ist.");
}

// =============================================================================
// Optionale Delivery-/Integrationspfade
// (Teilen/Download lokal + optionaler Drive-Upload bestehender Funktionalität)
// =============================================================================

async function shareOrDownloadPdfBlob(blob, filename, options = {}) {
  const shareTitle = options.shareTitle || "PDF";
  const shareText = options.shareText || "PDF exportiert";
  const file = new File([blob], filename, { type: "application/pdf" });
  const isIos = isIosLikeDevice();
  const canShareFiles = Boolean(navigator.canShare?.({ files: [file] }));

  console.info("MEP PDF Zustellung gestartet", {
    filename,
    isIosLikeDevice: isIos,
    canShareFiles,
    hasNavigatorShare: typeof navigator.share === "function"
  });

  if (canShareFiles && typeof navigator.share === "function") {
    try {
      await navigator.share({
        files: [file],
        title: shareTitle,
        text: shareText
      });
      return { deliveryMethod: "navigator.share" };
    } catch (error) {
      logMepExportError("MEP PDF Teilen via navigator.share fehlgeschlagen", error, {
        currentExportStep: "share:navigator.share",
        filename,
        deliveryMethod: "navigator.share"
      });
    }
  } else if (isIos) {
    console.info("MEP PDF Teilen via navigator.share nicht verfügbar", {
      filename,
      canShareFiles,
      hasNavigatorShare: typeof navigator.share === "function"
    });
  }

  const blobUrl = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = filename;
    link.rel = "noopener";
    document.body.appendChild(link);

    try {
      link.click();
      return { deliveryMethod: "link.click" };
    } catch (error) {
      logMepExportError("MEP PDF Download via link.click fehlgeschlagen", error, {
        currentExportStep: "share:link.click",
        filename,
        deliveryMethod: "link.click"
      });
    } finally {
      link.remove();
    }

    const popup = window.open(blobUrl, "_blank", "noopener");
    if (popup) {
      return { deliveryMethod: "window.open" };
    }

    const openError = new Error("window.open hat kein Fenster geöffnet.");
    logMepExportError("MEP PDF Öffnen via window.open fehlgeschlagen", openError, {
      currentExportStep: "share:window.open",
      filename,
      deliveryMethod: "window.open"
    });

    throw openError;
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
  }
}

function ensureDriveUploadConfigured() {
  if (!DRIVE_UPLOAD_CONFIG.enabled) {
    throw new Error("Drive-Upload ist nicht aktiviert.");
  }
  if (!DRIVE_UPLOAD_CONFIG.folderId) {
    throw new Error("Drive-Upload ist nicht konfiguriert: folderId fehlt.");
  }
  if (!DRIVE_UPLOAD_CONFIG.clientId) {
    throw new Error("Drive-Upload ist nicht konfiguriert: clientId fehlt.");
  }
  if (!window.google?.accounts?.oauth2) {
    throw new Error("Google Identity Services sind nicht geladen.");
  }
}

function createDriveMultipartBody(metadata, fileBlob) {
  const boundary = `wochenplan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const metadataPart = new Blob(
    [`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`],
    { type: "application/json" }
  );
  const filePartHeader = new Blob([`--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`], { type: "text/plain" });
  const closingPart = new Blob([`\r\n--${boundary}--`], { type: "text/plain" });

  return {
    boundary,
    body: new Blob([metadataPart, filePartHeader, fileBlob, closingPart], {
      type: `multipart/related; boundary=${boundary}`
    })
  };
}

function getDriveAccessToken() {
  ensureDriveUploadConfigured();

  if (driveAccessToken) {
    return Promise.resolve(driveAccessToken);
  }

  if (!driveTokenClient) {
    driveTokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: DRIVE_UPLOAD_CONFIG.clientId,
      scope: DRIVE_UPLOAD_CONFIG.scope,
      callback: () => {}
    });
  }

  return new Promise((resolve, reject) => {
    driveTokenClient.callback = (response) => {
      if (response?.error) {
        reject(new Error(response.error_description || response.error));
        return;
      }
      if (!response?.access_token) {
        reject(new Error("Kein Access-Token von Google erhalten."));
        return;
      }
      driveAccessToken = response.access_token;
      resolve(driveAccessToken);
    };

    driveTokenClient.requestAccessToken({ prompt: driveAccessToken ? "" : "consent" });
  });
}

async function driveRequestJson(url, token, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Drive API Fehler (${response.status}): ${errorText || response.statusText}`);
  }

  return response.json();
}

async function findDriveFileByNameInFolder(token, folderId, filename) {
  const query = [
    `'${folderId}' in parents`,
    `name='${String(filename).replace(/'/g, "\\'")}'`,
    "trashed=false",
    "mimeType='application/pdf'"
  ].join(" and ");
  const params = new URLSearchParams({
    q: query,
    fields: "files(id,name)",
    pageSize: "1",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true"
  });

  const result = await driveRequestJson(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, token);
  return result?.files?.[0] || null;
}

async function uploadOverviewPdfToGoogleDrive(pdfBlob, filename) {
  ensureDriveUploadConfigured();
  const token = await getDriveAccessToken();
  const folderId = DRIVE_UPLOAD_CONFIG.folderId;
  const existingFile = await findDriveFileByNameInFolder(token, folderId, filename);

  const metadata = existingFile
    ? { name: filename }
    : { name: filename, parents: [folderId] };
  const { boundary, body } = createDriveMultipartBody(metadata, pdfBlob);
  const uploadUrl = existingFile
    ? `https://www.googleapis.com/upload/drive/v3/files/${existingFile.id}?uploadType=multipart&supportsAllDrives=true`
    : "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true";

  const uploadedFile = await driveRequestJson(uploadUrl, token, {
    method: existingFile ? "PATCH" : "POST",
    headers: {
      "Content-Type": `multipart/related; boundary=${boundary}`
    },
    body
  });

  return {
    action: existingFile ? "updated" : "created",
    fileId: uploadedFile?.id || existingFile?.id || "",
    filename
  };
}

function cacheLastOverviewPdf(blob, filename) {
  lastOverviewPdfCache = {
    blob,
    filename
  };
}

function getCachedOverviewPdf(filename) {
  if (!lastOverviewPdfCache) return null;
  if (lastOverviewPdfCache.filename !== filename) return null;
  return lastOverviewPdfCache;
}

// =============================================================================
// Lokaler PDF-Exportpfad (DOM-Capture -> reine PDF-Builder)
// =============================================================================

function createOverviewPdfExportRoot() {
  const overviewView = document.getElementById("overviewView");
  const overviewContent = document.getElementById("overviewMonthContent");
  if (!overviewView || !overviewContent) return null;

  const exportRoot = document.createElement("div");
  exportRoot.className = "overviewPdfExportRoot";

  const clonedView = overviewView.cloneNode(true);
  clonedView.classList.remove("hidden", "no-print");
  clonedView.classList.add("overviewPdfExportView");

  clonedView.querySelectorAll("button").forEach((buttonEl) => buttonEl.remove());
  clonedView.querySelectorAll(".internalOnly, .noExport").forEach((el) => el.remove());
  const clonedWrapEls = clonedView.querySelectorAll(".tableWrap, .compactTableWrap, .overviewWeekTableWrap");
  clonedWrapEls.forEach((wrapEl) => {
    wrapEl.style.overflow = "visible";
    wrapEl.style.maxHeight = "none";
    wrapEl.style.height = "auto";
  });

  exportRoot.appendChild(clonedView);
  document.body.appendChild(exportRoot);
  return exportRoot;
}

async function exportMepTemplatePdf() {
  const jsPdfCtor = window.jspdf?.jsPDF;
  const captureFn = window.html2canvas;

  if (typeof jsPdfCtor !== "function" || typeof captureFn !== "function") {
    alert("PDF-Export ist noch nicht verfügbar. Bitte Seite neu laden und erneut versuchen.");
    return;
  }

  const previousView = uiState?.currentView || "week";
  const restoreView = previousView !== "mep";
  const originalButtonLabel = btnPrintEl?.textContent || "Drucken / PDF";
  let exportRoot = null;
  const exportState = buildMepExportDebugContext({
    currentExportStep: "prepare",
    currentSheetIndex: -1,
    currentScale: null,
    totalSheets: 0,
    filename: buildMepPdfFilename()
  });

  const runExportAttempt = async (sheetEls, scale, attemptLabel) => {
    exportState.currentScale = scale;
    exportState.currentExportStep = `capture:init:${attemptLabel}`;
    const pageCanvases = [];

    for (let index = 0; index < sheetEls.length; index += 1) {
      const sheetEl = sheetEls[index];
      exportState.currentSheetIndex = index;
      exportState.currentExportStep = `capture:${attemptLabel}`;

      let canvas;
      try {
        canvas = await captureFn(sheetEl, {
          backgroundColor: "#ffffff",
          scale,
          useCORS: true
        });
      } catch (error) {
        logMepExportError(`MEP-Seite ${index + 1} konnte nicht gerendert werden`, error, exportState);
        throw new Error(`Rendern von Seite ${index + 1} fehlgeschlagen.`, { cause: error });
      }
      pageCanvases.push(canvas);
    }

    exportState.currentExportStep = `pdf.build:${attemptLabel}`;
    let blob;
    try {
      blob = buildMepPdfBlobFromCanvases(pageCanvases, { jsPdfCtor });
    } catch (error) {
      logMepExportError("MEP-PDF konnte aus Canvas-Seiten nicht erzeugt werden", error, exportState);
      throw new Error("PDF-Datei konnte nicht erzeugt werden.", { cause: error });
    }

    exportState.currentExportStep = `shareOrDownload:${attemptLabel}`;
    try {
      const deliveryResult = await shareOrDownloadPdfBlob(blob, exportState.filename);
      exportState.deliveryMethod = deliveryResult?.deliveryMethod || null;
    } catch (error) {
      logMepExportError("shareOrDownloadPdfBlob fehlgeschlagen", error, exportState);
      throw new Error("PDF wurde erstellt, konnte aber nicht auf dem Gerät geöffnet oder geteilt werden.", {
        cause: error
      });
    }
  };

  try {
    if (btnPrintEl) {
      btnPrintEl.disabled = true;
      btnPrintEl.textContent = "PDF wird erstellt …";
    }

    if (restoreView) {
      uiState.currentView = "mep";
      renderView();
      renderAllViews();
    } else if (typeof renderMepTemplateView === "function") {
      renderMepTemplateView({ scope: "month" });
    }

    await waitForAnimationFrames(3);

    exportState.currentExportStep = "prepare:clone";
    exportRoot = createMepPdfExportRoot();
    if (!exportRoot) {
      throw new Error("MEP-Exportansicht nicht gefunden.");
    }

    await waitForAnimationFrames(2);

    const sheetEls = [...exportRoot.querySelectorAll(".mepTplSheet")];
    exportState.totalSheets = sheetEls.length;
    if (!sheetEls.length) {
      throw new Error("Keine MEP-Seiten zum Export gefunden.");
    }

    const exportScale = 2;
    await runExportAttempt(sheetEls, exportScale, "default");
  } catch (error) {
    logMepExportError("PDF-Export fehlgeschlagen", error, exportState);
    offerMepExportFallback(exportState);
  } finally {
    exportRoot?.remove();

    if (restoreView) {
      uiState.currentView = previousView;
      renderView();
      renderAllViews();
    }

    if (btnPrintEl) {
      btnPrintEl.disabled = false;
      updatePrintButtonLabel();
      if (!restoreView && originalButtonLabel && btnPrintEl.textContent !== originalButtonLabel) {
        updatePrintButtonLabel();
      }
    }
  }
}

function buildMepPdfBlobFromCanvases(pageCanvases, options = {}) {
  const jsPdfCtor = options.jsPdfCtor || window.jspdf?.jsPDF;
  if (typeof jsPdfCtor !== "function") {
    throw new Error("PDF-Export ist noch nicht verfügbar.");
  }

  if (!Array.isArray(pageCanvases) || !pageCanvases.length) {
    throw new Error("Keine MEP-Canvas-Seiten zum Export vorhanden.");
  }

  const pdf = new jsPdfCtor({
    orientation: "landscape",
    unit: "mm",
    format: "a4",
    compress: true
  });

  pageCanvases.forEach((canvas, index) => {
    if (!canvas) {
      throw new Error(`MEP-Canvas für Seite ${index + 1} fehlt.`);
    }
    if (index > 0) {
      pdf.addPage("a4", "landscape");
    }
    pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, 297, 210, undefined, "FAST");
  });

  return pdf.output("blob");
}

async function exportOverviewPdf() {
  const jsPdfCtor = window.jspdf?.jsPDF;
  const captureFn = window.html2canvas;
  if (typeof jsPdfCtor !== "function" || typeof captureFn !== "function") {
    alert("PDF-Export ist noch nicht verfügbar. Bitte Seite neu laden und erneut versuchen.");
    return;
  }

  const originalButtonLabel = btnPrintEl?.textContent || "Drucken / PDF";

  try {
    if (btnPrintEl) {
      btnPrintEl.disabled = true;
      btnPrintEl.textContent = "Übersicht wird exportiert …";
    }

    const blob = await buildOverviewPdfBlob({ jsPdfCtor, captureFn });
    const overviewFilename = buildOverviewPdfFilename();
    cacheLastOverviewPdf(blob, overviewFilename);
    await shareOrDownloadPdfBlob(blob, overviewFilename, {
      shareTitle: "Monatsübersicht PDF",
      shareText: "Übersicht als PDF"
    });
  } catch (error) {
    console.error("Übersichts-Export fehlgeschlagen", error);
    alert("Der Export der Übersicht ist fehlgeschlagen. Bitte erneut versuchen.");
  } finally {
    if (btnPrintEl) {
      btnPrintEl.disabled = false;
      updatePrintButtonLabel();
      if (originalButtonLabel && btnPrintEl.textContent !== originalButtonLabel) {
        updatePrintButtonLabel();
      }
    }
  }
}

async function buildOverviewPdfBlob(options = {}) {
  const jsPdfCtor = options.jsPdfCtor || window.jspdf?.jsPDF;
  const captureFn = options.captureFn || window.html2canvas;
  if (typeof jsPdfCtor !== "function" || typeof captureFn !== "function") {
    throw new Error("PDF-Export ist noch nicht verfügbar.");
  }

  let exportRoot = null;
  try {
    renderOverviewView();
    await waitForAnimationFrames(2);

    exportRoot = createOverviewPdfExportRoot();
    if (!exportRoot) {
      throw new Error("Übersicht konnte nicht für den Export vorbereitet werden.");
    }

    await waitForAnimationFrames(2);

    const exportViewEl = exportRoot.querySelector(".overviewPdfExportView");
    const exportBlocks = [
      ...exportRoot.querySelectorAll(".overviewPdfExportView .sectionhead, .overviewPdfExportView .overviewWeekSection")
    ];
    if (!exportViewEl || !exportBlocks.length) {
      throw new Error("Keine Wochenblöcke für den Export gefunden.");
    }

    const scale = 2;
    const blockCanvases = [];

    for (const blockEl of exportBlocks) {
      const canvas = await captureFn(blockEl, {
        backgroundColor: "#ffffff",
        scale,
        useCORS: true
      });
      blockCanvases.push(canvas);
    }

    return buildOverviewPdfBlobFromCanvases(blockCanvases, { jsPdfCtor });
  } finally {
    exportRoot?.remove();
  }
}

function buildOverviewPdfBlobFromCanvases(blockCanvases, options = {}) {
  const jsPdfCtor = options.jsPdfCtor || window.jspdf?.jsPDF;
  if (typeof jsPdfCtor !== "function") {
    throw new Error("PDF-Export ist noch nicht verfügbar.");
  }
  if (!Array.isArray(blockCanvases) || !blockCanvases.length) {
    throw new Error("Keine Übersichts-Blöcke zum Export gefunden.");
  }

  const pdf = new jsPdfCtor({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
    compress: true
  });

  const pageWidth = 210;
  const pageHeight = 297;
  const margin = 8;
  const contentWidthMm = pageWidth - margin * 2;
  let currentY = margin;
  let hasContentOnPage = false;

  blockCanvases.forEach((canvas, index) => {
    if (!canvas || !canvas.width || !canvas.height) {
      throw new Error(`Ungültiger Canvas-Block für Übersicht an Position ${index + 1}.`);
    }

    const renderedHeightMm = (canvas.height * contentWidthMm) / canvas.width;
    const remainingMm = pageHeight - margin - currentY;

    if (hasContentOnPage && renderedHeightMm > remainingMm) {
      pdf.addPage("a4", "portrait");
      currentY = margin;
      hasContentOnPage = false;
    }

    pdf.addImage(canvas.toDataURL("image/png"), "PNG", margin, currentY, contentWidthMm, renderedHeightMm, undefined, "FAST");
    currentY += renderedHeightMm + 3;
    hasContentOnPage = true;
  });

  return pdf.output("blob");
}

async function uploadOverviewPdf() {
  const originalLabel = btnOverviewUploadEl?.textContent || "Übersicht hochladen";
  const filename = buildOverviewPdfFilename();
  try {
    if (btnOverviewUploadEl) {
      btnOverviewUploadEl.disabled = true;
      btnOverviewUploadEl.textContent = "Übersicht wird hochgeladen …";
    }

    const cachedPdf = getCachedOverviewPdf(filename);
    const blob = cachedPdf?.blob || await buildOverviewPdfBlob();
    cacheLastOverviewPdf(blob, filename);

    const uploadResult = await uploadOverviewPdfToGoogleDrive(blob, filename);
    const actionLabel = uploadResult.action === "updated" ? "aktualisiert" : "neu hochgeladen";
    alert(`Drive-Upload erfolgreich: ${uploadResult.filename} wurde im Zielordner ${actionLabel}.`);
  } catch (driveError) {
    console.error("Drive-Upload fehlgeschlagen", driveError);
    alert(`Drive-Upload fehlgeschlagen: ${driveError.message || driveError}`);
  } finally {
    if (btnOverviewUploadEl) {
      btnOverviewUploadEl.disabled = false;
      btnOverviewUploadEl.textContent = originalLabel;
    }
  }
}

// Hinweis:
// `uploadOverviewPdf`/Drive-Helfer sind bewusst optional und nutzen den bereits
// erzeugten lokalen PDF-Blob. Neue Cloud-/API-Funktionalität wird hier nicht
// eingeführt; der lokale Exportpfad bleibt unabhängig nutzbar.
