import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";

const CFG = {
  headerRow: 2,
  firstDataRow: 3,
  requiredHeaders: [
    "Country",
    "Business Unit (Project)",
    "Customer Name",
    "Project No.",
    "Project",
    "Project State",
    "Project Country Manager",
    "Project Manager",
    "Email",
    "Project Category",
    "PSP Type",
    "Effort (H)",
  ],
  auditHeaders: ["Audit Status", "Audit Severity", "Audit Notes"],
  thresholds: { elevated: 600, high: 800 },
  colors: { High: "#f4cccc", Medium: "#fff2cc", Low: "#e2f0d9" },
};

const txt = (v) => (v == null ? "" : String(v).trim());
const effort = (v) => (typeof v === "number" ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v.trim())) ? Number(v.trim()) : null);
const rank = (v) => ({ OK: 0, Low: 1, Medium: 2, High: 3 }[v] ?? 0);
const fmtDate = (v) => (v ? new Date(v).toLocaleString() : "-");
const sourceLabel = (t) => (t === "uploadedFile" ? "Upload Files" : "Current Workbook");
const base64FromArrayBuffer = (buffer) => {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
};
const groupKey = (row) => `${txt(row.projectManager)}||${txt(row.email)}`;
async function api(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    const e = new Error(err.error || "Request failed");
    e.status = res.status;
    throw e;
  }
  return res.json();
}
function statusFor(issues) {
  if (!issues.length) return "OK";
  if (issues.some((i) => i.code === "AUTHORISED_WITH_ZERO_EFFORT")) return "Authorised Without Effort";
  if (issues.some((i) => i.code === "PENDING_ESTIMATION")) return "Pending Estimation";
  if (issues.some((i) => i.code === "HIGH_EFFORT_PROJECT")) return "High Effort";
  return issues[0].label;
}
function highest(issues) {
  return issues.reduce((h, i) => (!h || rank(i.severity) > rank(h) ? i.severity : h), null);
}
function issuesFor(row, dupNos) {
  const out = [];
  const e = row.effortHours;
  const s = row.projectState;
  if (e === null) out.push({ code: "MISSING_EFFORT", label: "Missing Effort", category: "Data Quality", severity: "Medium", details: "Effort value is missing or non-numeric." });
  if (!row.projectManager || !row.projectCountryManager || !row.email) out.push({ code: "MISSING_CONTACT_DATA", label: "Missing Contact Data", category: "Data Quality", severity: "Medium", details: "Project manager, country manager, or email is missing." });
  if (dupNos.has(row.projectNo)) out.push({ code: "DUPLICATE_PROJECT_NUMBER", label: "Duplicate Project Number", category: "Data Quality", severity: "High", details: `Project number ${row.projectNo} appears more than once.` });
  if (s === "In Planning" && e === 0) out.push({ code: "PENDING_ESTIMATION", label: "Pending Estimation", category: "Planning Issue", severity: "Medium", details: "Project is still in planning with zero effort." });
  if (s === "On Hold" && e === 0) out.push({ code: "ON_HOLD_WITH_NO_EFFORT", label: "On Hold With No Effort", category: "Planning Issue", severity: "Low", details: "On hold project currently carries zero effort." });
  if (s === "Authorised" && e === 0) out.push({ code: "AUTHORISED_WITH_ZERO_EFFORT", label: "Authorised Without Effort", category: "Planning Issue", severity: "High", details: "Authorised project should not have zero effort." });
  if ((s === "In Planning" || s === "On Hold") && typeof e === "number" && e > 0) out.push({ code: "PRE_APPROVAL_EFFORT_ENTERED", label: "Pre-Approval Effort Entered", category: "Planning Issue", severity: "Medium", details: "Pre-approval project already has effort assigned." });
  if (typeof e === "number" && e >= CFG.thresholds.high) out.push({ code: "HIGH_EFFORT_PROJECT", label: "High Effort", category: "Capacity Risk", severity: "High", details: `Effort is ${e}h, above the ${CFG.thresholds.high}h high-risk threshold.` });
  else if (typeof e === "number" && e >= CFG.thresholds.elevated) out.push({ code: "ELEVATED_EFFORT_PROJECT", label: "Elevated Effort", category: "Capacity Risk", severity: "Medium", details: `Effort is ${e}h, above the ${CFG.thresholds.elevated}h elevated threshold.` });
  return out;
}
function computeSummary(rows) {
  const s = { totalRows: rows.length, flaggedRows: rows.filter((r) => r.issues.length).length, issueCount: rows.reduce((n, r) => n + r.issues.length, 0), bySeverity: { High: 0, Medium: 0, Low: 0 }, byCategory: { "Data Quality": 0, "Planning Issue": 0, "Capacity Risk": 0 } };
  rows.forEach((r) => r.issues.forEach((i) => {
    s.bySeverity[i.severity] += 1;
    s.byCategory[i.category] = (s.byCategory[i.category] ?? 0) + 1;
  }));
  return s;
}
function buildDrafts(rows, sum) {
  const by = new Map();
  rows.filter((r) => r.issues.length && r.email).forEach((r) => {
    const key = groupKey(r);
    const current = by.get(key) || [];
    current.push(r);
    by.set(key, current);
  });
  return [...by.entries()].map(([key, grouped]) => {
    const [, email] = key.split("||");
    const pm = grouped[0]?.projectManager || "Project Manager";
    const text = ["Effort audit findings for " + pm, `Flagged projects: ${grouped.length}`, `High: ${sum.bySeverity.High}, Medium: ${sum.bySeverity.Medium}, Low: ${sum.bySeverity.Low}`, "", ...grouped.map((r) => `${r.projectNo} | ${r.project} | ${r.projectState} | Effort ${r.effortHours ?? "N/A"} | ${r.auditStatus}`)].join("\n");
    const html = `<div style="font-family:Segoe UI,Arial,sans-serif"><h2>Effort Audit Findings</h2><p><strong>Project Manager:</strong> ${pm}</p><p><strong>Flagged Projects:</strong> ${grouped.length}</p><table border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse;width:100%"><tr><th>Project No.</th><th>Project</th><th>State</th><th>Effort</th><th>Status</th><th>Sheet</th></tr>${grouped.map((r) => `<tr><td>${r.projectNo}</td><td>${r.project}</td><td>${r.projectState}</td><td>${r.effortHours ?? "N/A"}</td><td>${r.auditStatus}</td><td>${r.sourceSheetName}</td></tr>`).join("")}</table></div>`;
    return {
      recipientEmail: email,
      projectManager: pm,
      subject: `Effort audit findings for ${pm} (${grouped.length})`,
      summary: sum,
      rows: grouped,
      text,
      html,
    };
  });
}

const NOTIFICATION_THEMES = {
  companyReminder: {
    label: "Company Reminder",
    accent: "#0f5f3b",
    subjectPrefix: "Action Required",
    intro: "This is a friendly reminder to review and update the flagged effort records listed below.",
  },
  executiveSummary: {
    label: "Executive Summary",
    accent: "#7b1f3a",
    subjectPrefix: "Audit Summary",
    intro: "Please review the current audit exceptions and confirm the required corrective actions for the affected projects.",
  },
  compactUpdate: {
    label: "Compact Update",
    accent: "#1f4f8a",
    subjectPrefix: "Audit Update",
    intro: "The latest workbook audit identified the following items that need attention.",
  },
};

function themedNotificationDraft(draft, themeKey, template, deadline) {
  const theme = NOTIFICATION_THEMES[themeKey] || NOTIFICATION_THEMES.companyReminder;
  const draftSummary = draft.summary || { bySeverity: { High: 0, Medium: 0, Low: 0 } };
  const context = { ...draft, deadline };
  const greeting = applyTemplatePlaceholders(template.greeting, context);
  const intro = applyTemplatePlaceholders(template.intro, context);
  const actionLine = applyTemplatePlaceholders(template.actionLine, context);
  const deadlineText = applyTemplatePlaceholders(template.deadlineText, context);
  const closing = applyTemplatePlaceholders(template.closing, context);
  const signatureLine1 = applyTemplatePlaceholders(template.signatureLine1, context);
  const signatureLine2 = applyTemplatePlaceholders(template.signatureLine2, context);
  const rowsHtml = draft.rows.map((row) => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #dde5dd;">${row.projectNo}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #dde5dd;">${row.project}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #dde5dd;">${row.projectState}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #dde5dd;">${row.effortHours ?? "N/A"}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #dde5dd;">${row.auditStatus}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #dde5dd;">${row.auditNotes}</td>
    </tr>
  `).join("");
  const html = `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <title>${theme.subjectPrefix} - ${draft.projectManager}</title>
    </head>
    <body style="margin:0;padding:24px;background:#eef3ee;font-family:Segoe UI,Arial,sans-serif;color:#1f2e24;">
      <table role="presentation" cellspacing="0" cellpadding="0" width="100%" style="max-width:920px;margin:0 auto;background:#ffffff;border:1px solid #d9e4da;border-radius:18px;overflow:hidden;">
        <tr>
          <td style="padding:24px 28px;background:${theme.accent};color:#ffffff;">
            <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;opacity:.85;">MSG Global Project Controls</div>
            <div style="font-size:28px;font-weight:700;margin-top:8px;">Effort Audit Reminder</div>
            <div style="font-size:15px;margin-top:8px;opacity:.95;">${theme.intro}</div>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 28px;">
            <div style="font-size:15px;line-height:1.6;margin-bottom:16px;">${greeting}</div>
            <div style="font-size:14px;line-height:1.7;margin-bottom:8px;">${intro}</div>
            <div style="font-size:14px;line-height:1.7;margin-bottom:8px;">${actionLine}</div>
            <div style="font-size:14px;line-height:1.7;margin-bottom:18px;"><strong>${deadlineText}</strong></div>
            <table role="presentation" cellspacing="0" cellpadding="0" width="100%" style="margin-bottom:18px;">
              <tr>
                <td style="padding:0 14px 0 0;">
                  <div style="font-size:12px;color:#637165;text-transform:uppercase;">Project Manager</div>
                  <div style="font-size:18px;font-weight:700;">${draft.projectManager}</div>
                </td>
                <td style="padding:0 14px 0 0;">
                  <div style="font-size:12px;color:#637165;text-transform:uppercase;">Recipient</div>
                  <div style="font-size:16px;font-weight:600;">${draft.recipientEmail}</div>
                </td>
                <td style="padding:0 14px 0 0;">
                  <div style="font-size:12px;color:#637165;text-transform:uppercase;">Flagged Projects</div>
                  <div style="font-size:18px;font-weight:700;">${draft.rows.length}</div>
                </td>
              </tr>
            </table>
            <table role="presentation" cellspacing="0" cellpadding="0" width="100%" style="margin-bottom:22px;">
              <tr>
                <td style="padding:14px 16px;background:#f6faf6;border:1px solid #dce8de;border-radius:14px;">
                  <div style="font-size:12px;color:#637165;text-transform:uppercase;">Issue Distribution</div>
                  <div style="font-size:15px;font-weight:600;margin-top:6px;">High: ${draftSummary.bySeverity.High} | Medium: ${draftSummary.bySeverity.Medium} | Low: ${draftSummary.bySeverity.Low}</div>
                </td>
              </tr>
            </table>
            <table role="presentation" cellspacing="0" cellpadding="0" width="100%" style="border-collapse:collapse;border:1px solid #dce6dd;border-radius:14px;overflow:hidden;">
              <thead>
                <tr style="background:#f4f8f4;color:#314539;">
                  <th align="left" style="padding:12px;border-bottom:1px solid #dce6dd;">Project No.</th>
                  <th align="left" style="padding:12px;border-bottom:1px solid #dce6dd;">Project Name</th>
                  <th align="left" style="padding:12px;border-bottom:1px solid #dce6dd;">Project State</th>
                  <th align="left" style="padding:12px;border-bottom:1px solid #dce6dd;">Effort (H)</th>
                  <th align="left" style="padding:12px;border-bottom:1px solid #dce6dd;">Problem</th>
                  <th align="left" style="padding:12px;border-bottom:1px solid #dce6dd;">Action Needed</th>
                </tr>
              </thead>
              <tbody>${rowsHtml}</tbody>
            </table>
            <div style="margin-top:20px;font-size:13px;line-height:1.6;color:#546256;">
              ${closing}
              <br /><br />
              ${signatureLine1}<br />
              ${signatureLine2}
            </div>
          </td>
        </tr>
      </table>
    </body>
  </html>`;
  const text = [
    `${theme.subjectPrefix}: Effort audit reminder for ${draft.projectManager}`,
    "",
    greeting,
    "",
    intro,
    actionLine,
    deadlineText,
    `Recipient: ${draft.recipientEmail}`,
    `Flagged projects: ${draft.rows.length}`,
    `High: ${draftSummary.bySeverity.High}, Medium: ${draftSummary.bySeverity.Medium}, Low: ${draftSummary.bySeverity.Low}`,
    "",
    ...draft.rows.map((row) => `${row.projectNo} | ${row.project} | ${row.projectState} | Effort ${row.effortHours ?? "N/A"} | ${row.auditStatus} | ${row.auditNotes}`),
    "",
    closing,
    "",
    signatureLine1,
    signatureLine2,
  ].join("\n");
  return {
    ...draft,
    subject: `${theme.subjectPrefix}: Effort audit findings for ${draft.projectManager} (${draft.rows.length})`,
    html,
    text,
  };
}

function applyTemplatePlaceholders(value, context) {
  return String(value || "")
    .replaceAll("{{projectManager}}", context.projectManager || "Project Manager")
    .replaceAll("{{deadline}}", context.deadline || "the requested date")
    .replaceAll("{{recipientEmail}}", context.recipientEmail || "");
}

function escalationStage(tracking) {
  if (!tracking || tracking.outlookCount === 0) return "Reminder 1";
  if (tracking.outlookCount === 1) return "Reminder 2";
  return "Teams Escalation";
}

async function getWorkbookIdentity() {
  return Excel.run(async (c) => {
    const wb = c.workbook;
    wb.properties.load("title");
    wb.worksheets.load("items/name");
    await c.sync();
    const title = wb.properties.title || "Excel Workbook";
    const sheetNames = wb.worksheets.items.map((sheet) => sheet.name).sort();
    return `${title}::${sheetNames.join("|")}`;
  });
}

function Modal({ title, children, onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <strong>{title}</strong>
          <button className="btn ghost sm" onClick={onClose}>Close</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

function App() {
  const [status, setStatus] = useState("Loading process dashboard...");
  const [view, setView] = useState("dashboard");
  const [tab, setTab] = useState("overview");
  const [processes, setProcesses] = useState([]);
  const [activeProcess, setActiveProcess] = useState(null);
  const [detectedSheets, setDetectedSheets] = useState([]);
  const [rawRows, setRawRows] = useState([]);
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [history, setHistory] = useState([]);
  const [compare, setCompare] = useState(null);
  const [latestCompare, setLatestCompare] = useState(null);
  const [latestCompareHint, setLatestCompareHint] = useState("");
  const [previewUrls, setPreviewUrls] = useState([]);
  const [sourceWorkbookName, setSourceWorkbookName] = useState("Excel Workbook");
  const [selectedSheetNames, setSelectedSheetNames] = useState([]);
  const [manualSelectedSheetNames, setManualSelectedSheetNames] = useState([]);
  const [activeWorkbookIdentity, setActiveWorkbookIdentity] = useState(null);
  const [workbookStale, setWorkbookStale] = useState(false);
  const [processModal, setProcessModal] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formSourceType, setFormSourceType] = useState("currentWorkbook");
  const [templateEditorOpen, setTemplateEditorOpen] = useState(false);
  const [notificationDeadline, setNotificationDeadline] = useState("within 2 business days");
  const [sheetFilter, setSheetFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [issueSort, setIssueSort] = useState("severity");
  const [searchQuery, setSearchQuery] = useState("");
  const [notificationTheme, setNotificationTheme] = useState("companyReminder");
  const [compareFrom, setCompareFrom] = useState("");
  const [compareTo, setCompareTo] = useState("");

  const activeFile = useMemo(() => activeProcess?.files?.find((f) => f.id === activeProcess?.activeFileId) || null, [activeProcess]);
  const selectedSheetTargets = useMemo(() => {
    if (!activeProcess) return [];
    return activeProcess.sheetScope === "all" ? detectedSheets.map((s) => s.name) : selectedSheetNames;
  }, [activeProcess, detectedSheets, selectedSheetNames]);
  const selectedValidSheetNames = useMemo(() => {
    return selectedSheetTargets.filter((name) => detectedSheets.some((s) => s.name === name && s.auditable && !s.duplicate));
  }, [detectedSheets, selectedSheetTargets]);
  const selectedSkippedSheetNames = useMemo(() => {
    return selectedSheetTargets.filter((name) => !detectedSheets.some((s) => s.name === name && s.auditable && !s.duplicate));
  }, [detectedSheets, selectedSheetTargets]);
  const filteredIssues = useMemo(() => {
    let next = rows.filter((r) => r.issues.length);
    if (sheetFilter !== "all") next = next.filter((r) => r.sourceSheetName === sheetFilter);
    if (severityFilter !== "all") next = next.filter((r) => r.auditSeverity === severityFilter);
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      next = next.filter((r) => [r.projectNo, r.project, r.projectManager, r.email, r.sourceSheetName, r.auditNotes].join(" ").toLowerCase().includes(q));
    }
    return [...next].sort((a, b) => issueSort === "sheet" ? a.sourceSheetName.localeCompare(b.sourceSheetName) || a.sourceRowNumber - b.sourceRowNumber : issueSort === "project" ? a.project.localeCompare(b.project) : rank(b.auditSeverity) - rank(a.auditSeverity) || a.project.localeCompare(b.project));
  }, [rows, sheetFilter, severityFilter, searchQuery, issueSort]);
  const notificationTemplate = activeProcess?.notificationTemplate || {
    greeting: "Hi {{projectManager}},",
    intro: "As part of the ongoing effort audit, we identified discrepancies in the project effort data listed below.",
    actionLine: "Please review the below records and update the project data in the relevant tracking system.",
    deadlineText: "Please complete the update by {{deadline}}.",
    closing: "If any item is already correct, please reply with the justification so the QGC team can review and close it.",
    signatureLine1: "QGC Team",
    signatureLine2: "MSG Global Solutions",
  };
  const notificationTracking = activeProcess?.notificationTracking || {};
  const themedNotifications = useMemo(
    () => notifications.map((draft) => themedNotificationDraft(draft, notificationTheme, notificationTemplate, notificationDeadline)),
    [notifications, notificationTheme, notificationTemplate, notificationDeadline],
  );
  const processLabel = (process) => process?.name?.trim() || "Audit Workspace";

  useEffect(() => { void loadProcesses(); }, []);
  useEffect(() => {
    if (!activeProcess || activeProcess.sourceType === "uploadedFile") {
      setActiveWorkbookIdentity(null);
      setWorkbookStale(false);
      return;
    }
    void getWorkbookIdentity()
      .then((identity) => setActiveWorkbookIdentity(identity))
      .catch(() => {});
  }, [activeProcess?.id]);

  function syncProcessState(process) {
    setActiveProcess(process);
    setSelectedSheetNames(process?.selectedSheetNames || []);
    if (process?.sheetScope === "selected") setManualSelectedSheetNames(process?.selectedSheetNames || []);
    if (process) setProcesses((current) => [process, ...current.filter((p) => p.id !== process.id)]);
  }
  async function loadProcesses() {
    try {
      const out = await api("/api/addin/processes");
      setProcesses(out.processes || []);
      setStatus("Process dashboard ready. Create or open a process.");
    } catch (e) {
      setStatus(e.message);
    }
  }
  async function loadHistory(sessionId = activeProcess?.id, quiet = true) {
    if (!sessionId) return setHistory([]);
    try {
      const out = await api(`/api/addin/session/${encodeURIComponent(sessionId)}`);
      setHistory(out.versions || []);
      if ((out.versions || []).length >= 2) {
        setCompareFrom(String(out.versions[out.versions.length - 2].version));
        setCompareTo(String(out.versions[out.versions.length - 1].version));
      } else {
        setCompareFrom("");
        setCompareTo("");
      }
    } catch (e) {
      if (e.status === 404) {
        setHistory([]);
        setCompare(null);
        setLatestCompare(null);
        setLatestCompareHint("");
        setCompareFrom("");
        setCompareTo("");
        if (!quiet) setStatus("No snapshots saved for this process yet.");
        return;
      }
      throw e;
    }
  }
  function resetWorkspace(process) {
    syncProcessState(process);
    setDetectedSheets(process?.detectedSheets || []);
    setRawRows([]);
    setRows([]);
    setSummary(null);
    setNotifications([]);
    setCompare(null);
    setLatestCompare(null);
    setLatestCompareHint("");
    setPreviewUrls([]);
    setManualSelectedSheetNames(process?.selectedSheetNames || []);
    setActiveWorkbookIdentity(null);
    setWorkbookStale(false);
    setTab("overview");
    setView("workspace");
  }
  function openCreateModal() {
    setFormName("");
    setFormDescription("");
    setFormSourceType("currentWorkbook");
    setProcessModal({ mode: "create" });
  }
  function openEditModal(process) {
    setFormName(process.name);
    setFormDescription(process.description || "");
    setFormSourceType(process.sourceType);
    setProcessModal({ mode: "edit", process });
  }
  async function submitProcessForm() {
    try {
      if (processModal?.mode === "edit") {
        const updated = await api(`/api/addin/processes/${encodeURIComponent(processModal.process.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: formName.trim() || processModal.process.name, description: formDescription.trim() }),
        });
        syncProcessState(updated);
        setProcessModal(null);
        setStatus(`Process "${processLabel(updated)}" updated.`);
        return;
      }
      const created = await api("/api/addin/processes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: formName.trim() || "Audit Workspace", description: formDescription.trim(), sourceType: formSourceType }),
      });
      setProcessModal(null);
      resetWorkspace(created);
      setStatus(created.sourceType === "uploadedFile" ? `Process "${processLabel(created)}" created. Use Upload Files to begin.` : `Process "${processLabel(created)}" created. Scan the current workbook to begin.`);
    } catch (e) {
      setStatus(e.message);
    }
  }
  async function openProcess(id) {
    try {
      const process = await api(`/api/addin/processes/${encodeURIComponent(id)}`);
      resetWorkspace(process);
      await loadHistory(process.id, true);
      setStatus(`Loaded process "${processLabel(process)}".`);
    } catch (e) {
      setStatus(e.message);
    }
  }
  async function persistProcess(extra = {}) {
    if (!activeProcess) return null;
    const updated = await api(`/api/addin/processes/${encodeURIComponent(activeProcess.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        detectedSheets,
        sheetScope: activeProcess.sheetScope,
        selectedSheetNames,
        workbookName: activeProcess.workbookName || sourceWorkbookName,
        activeFileId: activeProcess.activeFileId,
        ...extra,
      }),
    });
    syncProcessState(updated);
    return updated;
  }
  function clearWorkbookResults(message) {
    setDetectedSheets([]);
    setRawRows([]);
    setRows([]);
    setSummary(null);
    setNotifications([]);
    setPreviewUrls([]);
    setSelectedSheetNames([]);
    setManualSelectedSheetNames([]);
    setCompare(null);
    setLatestCompare(null);
    setLatestCompareHint("");
    setWorkbookStale(true);
    if (message) setStatus(message);
  }
  async function ensureWorkbookCurrent() {
    if (!activeProcess || activeProcess.sourceType === "uploadedFile") return true;
    const identity = await getWorkbookIdentity();
    if (!activeWorkbookIdentity) {
      setActiveWorkbookIdentity(identity);
      return true;
    }
    if (identity !== activeWorkbookIdentity) {
      setActiveWorkbookIdentity(identity);
      clearWorkbookResults("Current workbook changed. Scan the new workbook to continue.");
      return false;
    }
    return true;
  }
  async function compareCurrentToLatestSnapshot(currentRows) {
    if (!activeProcess?.id) return null;
    try {
      const out = await api(`/audit/${encodeURIComponent(activeProcess.id)}/compare-current`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: currentRows }),
      });
      setLatestCompare(out);
      setLatestCompareHint("");
      return out;
    } catch (e) {
      if (e.status === 404) {
        setLatestCompare(null);
        setLatestCompareHint("No baseline snapshot yet. Save this audit to start version tracking.");
        return null;
      }
      throw e;
    }
  }
  async function confirmDeleteProcess() {
    if (!deleteTarget) return;
    try {
      await api(`/api/addin/processes/${encodeURIComponent(deleteTarget.id)}`, { method: "DELETE" });
      setProcesses((current) => current.filter((p) => p.id !== deleteTarget.id));
      if (activeProcess?.id === deleteTarget.id) {
        setActiveProcess(null);
        setDetectedSheets([]);
        setRawRows([]);
        setRows([]);
        setSummary(null);
        setNotifications([]);
        setHistory([]);
        setCompare(null);
        setPreviewUrls([]);
        setView("dashboard");
      }
      setDeleteTarget(null);
      setStatus(`Process "${processLabel(deleteTarget)}" deleted.`);
    } catch (e) {
      setStatus(e.message);
    }
  }
  async function setActiveFile(fileId) {
    if (!activeProcess) return;
    try {
      const file = activeProcess.files.find((f) => f.id === fileId);
      const updated = await persistProcess({ activeFileId: fileId, detectedSheets: file?.detectedSheets || [], selectedSheetNames: [] });
      setDetectedSheets(updated?.detectedSheets || []);
      setRows([]);
      setSummary(null);
      setStatus("Active file changed.");
    } catch (e) {
      setStatus(e.message);
    }
  }
  async function uploadFile(file) {
    if (!activeProcess || activeProcess.sourceType !== "uploadedFile") return setStatus("Open an Upload Files process first.");
    if (!file) return setStatus("Choose an Excel file first.");
    try {
      setStatus("Uploading file...");
      const contentBase64 = base64FromArrayBuffer(await file.arrayBuffer());
      const updated = await api(`/api/addin/processes/${encodeURIComponent(activeProcess.id)}/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, contentBase64 }),
      });
      syncProcessState(updated);
      setDetectedSheets(updated.detectedSheets || []);
      setStatus(`Added file "${file.name}" to process.`);
    } catch (e) {
      setStatus(e.message);
    }
  }
  async function scanSource() {
    if (!activeProcess) return setStatus("Create or open a process first.");
    if (activeProcess.sourceType === "uploadedFile") {
      if (!activeFile) return setStatus("Upload a file and set it active first.");
      const nextDetected = activeFile.detectedSheets || [];
      const nextSelected = activeProcess.sheetScope === "all"
        ? nextDetected.map((s) => s.name)
        : manualSelectedSheetNames.filter((name) => nextDetected.some((sheet) => sheet.name === name && sheet.auditable && !sheet.duplicate));
      try {
        const updated = await persistProcess({ detectedSheets: nextDetected, selectedSheetNames: nextSelected });
        setDetectedSheets(updated?.detectedSheets || []);
        setSelectedSheetNames(nextSelected);
        const auditedCount = nextSelected.filter((name) => nextDetected.some((sheet) => sheet.name === name && sheet.auditable && !sheet.duplicate)).length;
        const nextSkipped = nextSelected.length - auditedCount;
        setStatus(`Detected ${nextDetected.length} sheet(s): ${auditedCount} auditable, ${nextSkipped} skipped.`);
      } catch (e) {
        setStatus(e.message);
      }
      return;
    }
    try {
      setStatus("Scanning current workbook...");
      const nextDetected = [];
      const nextRaw = [];
      let workbookTitle = "Excel Workbook";
      await Excel.run(async (c) => {
        const wb = c.workbook;
        wb.properties.load("title");
        wb.worksheets.load("items/name");
        await c.sync();
        workbookTitle = wb.properties.title || "Excel Workbook";
        const raw = [];
        wb.worksheets.items.forEach((sheet) => {
          const used = sheet.getUsedRangeOrNullObject();
          used.load(["values", "rowCount"]);
          raw.push({ name: sheet.name, used });
        });
        await c.sync();
        const all = raw.filter((x) => !x.used.isNullObject && x.used.rowCount >= 1).map((x) => ({ name: x.name, values: x.used.values, rowCount: x.used.rowCount }));
        const seen = new Set();
        all.forEach((sheet) => {
          const auditable = sheet.rowCount >= CFG.headerRow && CFG.requiredHeaders.every((h, i) => txt((sheet.values[CFG.headerRow - 1] || [])[i]) === h);
          let duplicate = false;
          let reason = auditable ? undefined : `Row ${CFG.headerRow} does not match the expected audit template.`;
          if (auditable) {
            const sig = sheet.values.slice(CFG.firstDataRow - 1).map((r) => CFG.requiredHeaders.map((_, i) => txt(r[i])).join("||")).join("##");
            if (seen.has(sig)) {
              duplicate = true;
              reason = "Duplicate/reference tab";
            } else seen.add(sig);
          }
          nextDetected.push({ name: sheet.name, auditable, duplicate, rowCount: sheet.rowCount, reason });
          if (auditable && !duplicate) {
            for (let r = CFG.firstDataRow - 1; r < sheet.values.length; r += 1) {
              const v = sheet.values[r] || [];
              if (CFG.requiredHeaders.every((_, i) => txt(v[i]) === "")) continue;
              nextRaw.push({ sourceSheetName: sheet.name, sourceRowNumber: r + 1, country: txt(v[0]), businessUnit: txt(v[1]), customerName: txt(v[2]), projectNo: txt(v[3]), project: txt(v[4]), projectState: txt(v[5]), projectCountryManager: txt(v[6]), projectManager: txt(v[7]), email: txt(v[8]), projectCategory: txt(v[9]), pspType: txt(v[10]), effortHours: effort(v[11]), rawEffortValue: v[11] });
            }
          }
        });
      });
      setSourceWorkbookName(workbookTitle);
      setDetectedSheets(nextDetected);
      setRawRows(nextRaw);
      const nextSelected = activeProcess.sheetScope === "all"
        ? nextDetected.map((s) => s.name)
        : manualSelectedSheetNames.filter((name) => nextDetected.some((sheet) => sheet.name === name));
      const updated = await api(`/api/addin/processes/${encodeURIComponent(activeProcess.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ detectedSheets: nextDetected, selectedSheetNames: nextSelected, workbookName: workbookTitle }),
      });
      setSelectedSheetNames(nextSelected);
      setActiveWorkbookIdentity(await getWorkbookIdentity());
      setWorkbookStale(false);
      syncProcessState(updated);
      const auditedCount = nextSelected.filter((name) => nextDetected.some((sheet) => sheet.name === name && sheet.auditable && !sheet.duplicate)).length;
      const skippedCount = nextSelected.length - auditedCount;
      setStatus(`Detected ${nextDetected.length} sheet(s): ${auditedCount} auditable, ${skippedCount} skipped.`);
    } catch (e) {
      setStatus(e.message);
    }
  }
  async function writeAudit(nextRows, targetSheets) {
    await Excel.run(async (c) => {
      const sheets = c.workbook.worksheets;
      sheets.load("items/name");
      await c.sync();
      for (const name of targetSheets) {
        const sheet = sheets.getItem(name);
        const used = sheet.getUsedRange();
        used.load("columnCount");
        await c.sync();
        const header = sheet.getRangeByIndexes(CFG.headerRow - 1, 0, 1, used.columnCount);
        header.load("values");
        await c.sync();
        let start = (header.values[0] || []).findIndex((v) => txt(v) === CFG.auditHeaders[0]);
        if (start < 0) start = CFG.requiredHeaders.length;
        sheet.getRangeByIndexes(CFG.headerRow - 1, start, 1, 3).values = [CFG.auditHeaders];
        nextRows.filter((r) => r.sourceSheetName === name).forEach((r) => {
          sheet.getRangeByIndexes(r.sourceRowNumber - 1, start, 1, 3).values = [[r.auditStatus, r.auditSeverity, r.auditNotes]];
          sheet.getRangeByIndexes(r.sourceRowNumber - 1, 0, 1, Math.max(used.columnCount, start + 3)).format.fill.color = r.highestSeverity ? CFG.colors[r.highestSeverity] : "#ffffff";
        });
      }
      await c.sync();
    });
  }
  async function runAudit() {
    if (!activeProcess) return setStatus("Create or open a process first.");
    if (!selectedValidSheetNames.length) return setStatus("Select at least one valid sheet.");
    try {
      if (!(await ensureWorkbookCurrent())) return;
      setStatus("Running audit...");
      await persistProcess();
      let nextRows = [];
      let nextSummary = computeSummary([]);
      let nextNotifications = [];
      if (activeProcess.sourceType === "uploadedFile") {
        const out = await api(`/api/addin/processes/${encodeURIComponent(activeProcess.id)}/analyze`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ selectedSheetNames: selectedValidSheetNames, activeFileId: activeProcess.activeFileId }),
        });
        nextRows = out.rows || [];
        nextSummary = out.summary || computeSummary([]);
        nextNotifications = out.notifications || [];
      } else {
        const source = rawRows.filter((r) => selectedValidSheetNames.includes(r.sourceSheetName));
        const dup = new Set(source.map((r) => r.projectNo).filter((n, i, arr) => n && arr.indexOf(n) !== i));
        nextRows = source.map((r) => {
          const issues = issuesFor(r, dup);
          const sev = highest(issues);
          return { ...r, issues, highestSeverity: sev, auditStatus: statusFor(issues), auditSeverity: sev || "OK", auditNotes: issues.map((i) => i.details || i.label).join("; ") };
        });
        nextSummary = computeSummary(nextRows);
        nextNotifications = buildDrafts(nextRows, nextSummary);
        await writeAudit(nextRows, selectedValidSheetNames);
      }
      setRows(nextRows);
      setSummary(nextSummary);
      setNotifications(nextNotifications);
      setPreviewUrls([]);
      setCompare(null);
      let compared = null;
      compared = await compareCurrentToLatestSnapshot(nextRows);
      const updated = await api(`/api/addin/processes/${encodeURIComponent(activeProcess.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ latestAuditStatus: { flaggedRows: nextSummary.flaggedRows, issueCount: nextSummary.issueCount, updatedAt: new Date().toISOString() } }),
      });
      syncProcessState(updated);
      if (compared) {
        setStatus(`Audit complete. ${selectedSheetTargets.length} sheet(s) chosen, ${selectedValidSheetNames.length} audited, ${selectedSkippedSheetNames.length} skipped, ${nextSummary.flaggedRows} row(s) flagged. Compared against saved version ${compared.baselineVersion}.`);
      } else {
        setStatus(`Audit complete. ${selectedSheetTargets.length} sheet(s) chosen, ${selectedValidSheetNames.length} audited, ${selectedSkippedSheetNames.length} skipped, ${nextSummary.flaggedRows} row(s) flagged.`);
      }
    } catch (e) {
      setStatus(e.message);
    }
  }
  async function saveSnapshot() {
    if (!summary || !activeProcess) return setStatus("Run the audit before saving a snapshot.");
    try {
      if (!(await ensureWorkbookCurrent())) return;
      const out = await api("/api/addin/snapshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: activeProcess.id, workbookName: activeProcess.workbookName || sourceWorkbookName, sourceSheetName: selectedValidSheetNames[0] || "", scannedSheetNames: selectedValidSheetNames, duplicateSheetNames: detectedSheets.filter((s) => s.duplicate).map((s) => s.name), summary, rows, notifications: themedNotifications }),
      });
      setPreviewUrls((out.previewUrls || []).map((u) => new URL(u, window.location.origin).toString()));
      await loadHistory(activeProcess.id, false);
      setLatestCompare(null);
      setLatestCompareHint(`Current audit saved as baseline version ${out.version}. Run the next audit in this process to compare changes.`);
      setStatus(`Snapshot saved as version ${out.version}.`);
    } catch (e) {
      setStatus(e.message);
    }
  }
  async function compareVersions() {
    if (!activeProcess || !compareFrom || !compareTo) return setStatus("Choose two versions to compare.");
    try {
      const out = await api(`/audit/${encodeURIComponent(activeProcess.id)}/compare?from=${encodeURIComponent(compareFrom)}&to=${encodeURIComponent(compareTo)}`);
      setCompare(out);
      setStatus(`Compared version ${compareFrom} with version ${compareTo}.`);
    } catch (e) {
      setStatus(e.message);
    }
  }
  async function openOutlookDraft(draft) {
    if (!activeProcess) return setStatus("Open a process first.");
    try {
      const key = `${draft.projectManager}||${draft.recipientEmail}`;
      const currentTracking = notificationTracking[key] || {
        key,
        recipientEmail: draft.recipientEmail,
        projectManager: draft.projectManager,
        outlookCount: 0,
        teamsCount: 0,
        history: [],
      };
      const nextOutlookCount = currentTracking.outlookCount + 1;
      const stage = nextOutlookCount === 1 ? "reminder1" : "reminder2";
      const updatedTracking = {
        ...notificationTracking,
        [key]: {
          ...currentTracking,
          outlookCount: nextOutlookCount,
          lastChannel: "outlook",
          lastStage: stage,
          lastSentAt: new Date().toISOString(),
          history: [...currentTracking.history, { channel: "outlook", stage, sentAt: new Date().toISOString() }],
        },
      };
      setStatus("Preparing Outlook draft...");
      const out = await api("/api/addin/outlook-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          processId: activeProcess.id,
          recipientEmail: draft.recipientEmail,
          subject: draft.subject,
          html: draft.html,
          text: draft.text,
        }),
      });
      const updated = await persistProcess({ notificationTracking: updatedTracking });
      syncProcessState(updated);
      setStatus(`Outlook ${nextOutlookCount === 1 ? "reminder" : "follow-up"} opened for ${draft.projectManager}. The sender will use your default Outlook account.`);
    } catch (e) {
      setStatus(e.message);
    }
  }
  async function saveNotificationTemplate(patch) {
    if (!activeProcess) return;
    try {
      const updated = await persistProcess({
        notificationTemplate: {
          ...notificationTemplate,
          ...patch,
        },
      });
      syncProcessState(updated);
      setStatus("Notification template updated.");
    } catch (e) {
      setStatus(e.message);
    }
  }
  async function openTeamsEscalation(draft) {
    if (!activeProcess) return setStatus("Open a process first.");
    try {
      const key = `${draft.projectManager}||${draft.recipientEmail}`;
      const currentTracking = notificationTracking[key] || {
        key,
        recipientEmail: draft.recipientEmail,
        projectManager: draft.projectManager,
        outlookCount: 0,
        teamsCount: 0,
        history: [],
      };
      const updatedTracking = {
        ...notificationTracking,
        [key]: {
          ...currentTracking,
          teamsCount: currentTracking.teamsCount + 1,
          lastChannel: "teams",
          lastStage: "teamsEscalation",
          lastSentAt: new Date().toISOString(),
          history: [...currentTracking.history, { channel: "teams", stage: "teamsEscalation", sentAt: new Date().toISOString() }],
        },
      };
      const updated = await persistProcess({ notificationTracking: updatedTracking });
      syncProcessState(updated);
      const teamsText = encodeURIComponent(draft.text);
      window.open(`https://teams.microsoft.com/l/chat/0/0?users=${encodeURIComponent(draft.recipientEmail)}&message=${teamsText}`, "_blank");
      setStatus(`Teams escalation opened for ${draft.projectManager}.`);
    } catch (e) {
      setStatus(e.message);
    }
  }

  const summaryCards = summary ? [{ label: "Scanned Rows", value: summary.totalRows }, { label: "Flagged Rows", value: summary.flaggedRows }, { label: "Issues", value: summary.issueCount }, { label: "Sheets", value: selectedValidSheetNames.length }] : [{ label: "Rows", value: 0 }, { label: "Issues", value: 0 }, { label: "Valid Sheets", value: selectedValidSheetNames.length }, { label: "Snapshots", value: history.length }];
  const renderCompareDetails = (value, emptyTitle, emptyText) => (
    <div className="compare-list">
      {value ? <>
        <div className="compare-card">
          <strong>{value.toVersion == null ? `Latest Saved Version ${value.baselineVersion} vs Current Audit` : `Version ${value.fromVersion} to ${value.toVersion}`}</strong>
          <div className="tiny">
            Baseline saved {fmtDate(value.baselineCreatedAt)} | New issues: {value.newIssues} | Resolved: {value.resolvedIssues} | Severity changes: {value.severityChanges.length} | Manager changes: {value.managerChanges.length}
          </div>
        </div>
        {value.newIssueRows.length ? value.newIssueRows.map((item) => <div className="compare-card" key={`new-${item.projectNo}-${item.projectManager}-${item.sourceSheetName}`}><strong>New: {item.projectNo} - {item.project}</strong><div className="tiny">{item.projectManager} | {item.sourceSheetName} | {item.auditStatus}</div></div>) : null}
        {value.resolvedIssueRows.length ? value.resolvedIssueRows.map((item) => <div className="compare-card" key={`resolved-${item.projectNo}-${item.projectManager}-${item.sourceSheetName}`}><strong>Resolved: {item.projectNo} - {item.project}</strong><div className="tiny">{item.projectManager} | {item.sourceSheetName} | {item.auditStatus}</div></div>) : null}
        {value.severityChanges.length ? value.severityChanges.map((item) => <div className="compare-card" key={`severity-${item.projectNo}-${item.projectManager}-${item.from}-${item.to}`}><strong>Severity: {item.projectNo} - {item.project}</strong><div className="tiny">{item.projectManager} | {item.from} to {item.to}</div></div>) : null}
        {value.managerChanges.length ? value.managerChanges.map((item) => <div className="compare-card" key={`manager-${item.projectNo}-${item.fromManager}-${item.toManager}`}><strong>Manager Change: {item.projectNo} - {item.project}</strong><div className="tiny">{item.fromManager} to {item.toManager}</div></div>) : null}
      </> : <div className="empty"><strong>{emptyTitle}</strong><div>{emptyText}</div></div>}
    </div>
  );
  return (
    <div className="shell">
      <header className="top"><h1>Effort Workbook Auditor</h1><p>Process-based Excel extension for workbook audits, uploads, notifications, and version history.</p></header>
      <div className="statusbar"><span className="dot" /><span>{status}</span></div>
      <main className="content">
        {view === "dashboard" ? (
          <section className="view">
            <div className="panel">
              <div className="panel-head"><div><strong>Process Dashboard</strong><div className="tiny">Open an existing audit process or create a new one.</div></div><button className="btn" onClick={openCreateModal}>Create New Process</button></div>
              <div className="panel-body">
                {!processes.length ? <div className="empty"><strong>No processes yet</strong><div>Create a process to start a workbook audit or use the Upload Files flow.</div><div className="row" style={{ marginTop: 10 }}><button className="btn" onClick={openCreateModal}>Create Your First Process</button></div></div> : <div className="process-grid">{processes.map((p) => <div className={`process-card ${activeProcess?.id === p.id ? "active" : ""}`} key={p.id}><div className="process-card-header"><div><strong>{processLabel(p)}</strong><div className="tiny" style={{ marginTop: 4 }}>{p.description || "No description provided"}</div><div className="process-meta tiny"><span>Created: {fmtDate(p.createdAt)}</span><span>Updated: {fmtDate(p.updatedAt)}</span></div></div><span className="badge">{sourceLabel(p.sourceType)}</span></div><div className="process-meta"><span className="badge">{p.files?.length || 0} files</span>{p.latestAuditStatus ? <span className="badge warn">{p.latestAuditStatus.flaggedRows} flagged</span> : <span className="badge">No audit yet</span>}</div><div className="process-actions" style={{ marginTop: 12 }}><button className="btn sm" onClick={() => void openProcess(p.id)}>Open</button><button className="btn secondary sm" onClick={() => openEditModal(p)}>Edit</button><button className="btn danger sm" onClick={() => setDeleteTarget(p)}>Delete</button></div></div>)}</div>}
              </div>
            </div>
          </section>
        ) : (
          <section className="view">
            <div className="panel">
              <div className="panel-head"><div><strong>{activeProcess ? processLabel(activeProcess) : "Process Workspace"}</strong><div className="tiny">{activeProcess?.description || "No description provided"}</div></div><button className="btn ghost" onClick={() => setView("dashboard")}>Back to Dashboard</button></div>
              <div className="panel-body">
                <div className="source-banner"><div className="row between"><div><strong>{sourceLabel(activeProcess?.sourceType || "currentWorkbook")}</strong><div className="tiny">{activeProcess?.sourceType === "uploadedFile" ? (activeFile?.originalFileName || "No active file selected yet.") : (activeProcess?.workbookName || sourceWorkbookName || "Current workbook")}</div></div><div className="tiny">Created {fmtDate(activeProcess?.createdAt)}</div></div></div>
                {workbookStale ? <div className="empty"><strong>Current workbook changed</strong><div>Scan the new workbook to continue. Previous sheet selection and audit results were cleared to avoid stale data.</div></div> : null}
                <div className="row"><button className="btn secondary" onClick={() => void scanSource()} disabled={!activeProcess}>Scan Source</button><button className="btn" onClick={() => void runAudit()} disabled={!activeProcess || !selectedValidSheetNames.length || workbookStale}>Run Audit</button><button className="btn secondary" onClick={() => void saveSnapshot()} disabled={!activeProcess || !summary || workbookStale}>Save Snapshot</button><button className="btn ghost" onClick={() => void loadHistory(activeProcess?.id, false)} disabled={!activeProcess}>Load History</button></div>
                {activeProcess?.sourceType === "uploadedFile" ? <div className="panel"><div className="panel-head"><strong>Upload Files</strong><span className="tiny">Upload multiple workbooks and choose one active file</span></div><div className="panel-body">{!activeProcess.files.length ? <div className="empty"><strong>Add one or more Excel files to this process</strong><div>After upload, choose an active file, scan its sheets, and run the audit.</div></div> : null}<div className="row"><input type="file" accept=".xlsx,.xlsm,.xls" onChange={(e) => { const file = e.target.files?.[0] || null; void uploadFile(file); e.target.value = ""; }} /></div><div className="file-list">{activeProcess.files.map((file) => <div className="file-card" key={file.id}><div className="row between"><strong>{file.originalFileName}</strong>{activeProcess.activeFileId === file.id ? <span className="badge">Active File</span> : <button className="btn secondary sm" onClick={() => void setActiveFile(file.id)}>Use File</button>}</div><div className="tiny">Uploaded: {fmtDate(file.uploadedAt)}</div><div className="tiny">{file.detectedSheets.filter((s) => s.auditable && !s.duplicate).length} valid sheet(s)</div></div>)}</div></div></div> : null}
                <div className="grid2"><div className="field"><label htmlFor="sheetScope">Sheet Scope</label><select id="sheetScope" value={activeProcess?.sheetScope || "all"} onChange={async (e) => { if (!activeProcess) return; const nextScope = e.target.value === "selected" ? "selected" : "all"; const nextSelected = nextScope === "all" ? detectedSheets.map((s) => s.name) : manualSelectedSheetNames.filter((name) => detectedSheets.some((sheet) => sheet.name === name)); try { setSelectedSheetNames(nextSelected); if (nextScope === "selected") setManualSelectedSheetNames(nextSelected); const updated = await api(`/api/addin/processes/${encodeURIComponent(activeProcess.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sheetScope: nextScope, selectedSheetNames: nextSelected, detectedSheets }) }); syncProcessState(updated); } catch (err) { setStatus(err.message); } }}><option value="all">All Sheets</option><option value="selected">Selected Sheets</option></select></div><div className="field"><label>Detected Sheets</label><div className="tiny">{selectedValidSheetNames.length} audited, {selectedSkippedSheetNames.length} skipped</div></div></div>
                <div className="sheet-list">{detectedSheets.length ? detectedSheets.map((sheet) => <div className="sheet-card" key={sheet.name}><div><div className="row"><input type="checkbox" checked={selectedSheetNames.includes(sheet.name)} disabled={activeProcess?.sheetScope === "all"} onChange={async (e) => { if (!activeProcess) return; const nextSelected = e.target.checked ? [...new Set([...selectedSheetNames, sheet.name])] : selectedSheetNames.filter((name) => name !== sheet.name); try { setSelectedSheetNames(nextSelected); setManualSelectedSheetNames(nextSelected); const updated = await api(`/api/addin/processes/${encodeURIComponent(activeProcess.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ selectedSheetNames: nextSelected, detectedSheets }) }); syncProcessState(updated); } catch (err) { setStatus(err.message); } }} /><strong>{sheet.name}</strong></div><div className="tiny">{sheet.duplicate ? (selectedSheetNames.includes(sheet.name) ? "Selected but will be skipped: duplicate/reference tab" : "Duplicate/reference tab") : !sheet.auditable ? (selectedSheetNames.includes(sheet.name) ? "Selected but will be skipped: invalid template" : (sheet.reason || "Invalid template")) : selectedSheetNames.includes(sheet.name) ? "Selected valid audit sheet" : "Valid but not selected"}</div></div><div className="row"><span className={`badge ${!sheet.auditable || sheet.duplicate || !selectedSheetNames.includes(sheet.name) ? "warn" : ""}`}>{sheet.rowCount} rows</span></div></div>) : <div className="empty"><strong>No sheets detected yet</strong><div>Scan the current source to discover valid workbook tabs.</div></div>}</div>
                <div className="tabs">{["overview", "issues", "notifications", "history"].map((item) => <button key={item} className={`tab ${tab === item ? "active" : ""}`} onClick={() => setTab(item)}>{item === "overview" ? "Overview" : item === "issues" ? "Issues" : item === "notifications" ? "Notifications" : "Version History"}</button>)}</div>
              </div>
            </div>
            {tab === "overview" ? <><div className="panel"><div className="panel-head"><strong>Audit Summary</strong><span className="tiny">{activeProcess?.sourceType === "uploadedFile" ? (activeFile?.originalFileName || "Uploaded file") : (activeProcess?.workbookName || sourceWorkbookName || "Workbook")}</span></div><div className="panel-body"><div className="metric-grid">{summaryCards.map((card) => <div className="metric" key={card.label}><div className="label">{card.label}</div><div className="value">{card.value}</div></div>)}</div></div></div><div className="panel"><div className="panel-head"><strong>Change Summary</strong><span className="tiny">Latest saved version vs current audit</span></div><div className="panel-body">{latestCompare ? renderCompareDetails(latestCompare, "", "") : <div className="empty"><strong>{history.length ? "No new comparison yet" : "No baseline snapshot yet"}</strong><div>{latestCompareHint || (history.length ? "Run the audit again after workbook updates to compare it with the latest saved version." : "Save this audit once to create a baseline, then rerun the process later to see resolved and new changes.")}</div></div>}</div></div><div className="panel"><div className="panel-head"><strong>Sheet Coverage</strong><span className="tiny">Valid, invalid, and duplicate tabs</span></div><div className="panel-body"><div className="sheet-list">{detectedSheets.length ? detectedSheets.map((sheet) => { const xs = (rows.length ? rows : rawRows).filter((r) => r.sourceSheetName === sheet.name); const flagged = rows.filter((r) => r.sourceSheetName === sheet.name && r.issues.length).length; return <div className="sheet-card" key={sheet.name}><div><strong>{sheet.name}</strong><div className="tiny">{sheet.auditable ? (sheet.duplicate ? "Duplicate/reference tab" : "Valid sheet") : (sheet.reason || "Invalid template")}</div></div><div className="row"><span className="badge">{xs.length} rows</span>{flagged > 0 ? <span className="badge warn">{flagged} flagged</span> : null}</div></div>; }) : <div className="empty"><strong>No sheets detected yet</strong><div>Run a scan to populate workbook coverage.</div></div>}</div></div></div></> : null}
            {tab === "issues" ? <div className="panel"><div className="panel-head"><strong>Issues</strong><span className="tiny">Filtered audit results for the active process</span></div><div className="panel-body"><div className="grid3"><div className="field"><label>Sheet</label><select value={sheetFilter} onChange={(e) => setSheetFilter(e.target.value)}><option value="all">All Sheets</option>{selectedValidSheetNames.map((sheet) => <option key={sheet} value={sheet}>{sheet}</option>)}</select></div><div className="field"><label>Severity</label><select value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)}><option value="all">All Severities</option><option value="High">High</option><option value="Medium">Medium</option><option value="Low">Low</option></select></div><div className="field"><label>Sort</label><select value={issueSort} onChange={(e) => setIssueSort(e.target.value)}><option value="severity">Severity</option><option value="sheet">Sheet</option><option value="project">Project</option></select></div></div><div className="field"><label>Search</label><input value={searchQuery} placeholder="Search by project, manager, email or notes" onChange={(e) => setSearchQuery(e.target.value)} /></div><div className="issue-list">{filteredIssues.length ? filteredIssues.map((r) => <div className={`issue-card ${String(r.auditSeverity).toLowerCase()}`} key={`${r.sourceSheetName}-${r.sourceRowNumber}`}><strong>{r.projectNo} - {r.project}</strong><div className="issue-meta"><span className="badge">{r.sourceSheetName}</span><span className={`badge ${String(r.auditSeverity).toLowerCase() === "high" ? "danger" : String(r.auditSeverity).toLowerCase() === "medium" ? "warn" : ""}`}>{r.auditSeverity}</span><span className="badge">{r.projectManager}</span></div><div className="tiny">{r.projectState} | Effort: {r.effortHours ?? "N/A"} | {r.auditStatus}</div><div style={{ marginTop: 6 }}>{r.issues.map((i) => i.details || i.label).join("; ")}</div></div>) : <div className="empty"><strong>No matching issues</strong><div>Adjust the filters or run an audit.</div></div>}</div></div></div> : null}
            {tab === "notifications" ? <div className="panel"><div className="panel-head"><strong>Notification Drafts</strong><span className="tiny">Company reminder template, Outlook follow-ups, and Teams escalation</span></div><div className="panel-body"><div className="grid3"><div className="field"><label>Email Theme</label><select value={notificationTheme} onChange={(e) => setNotificationTheme(e.target.value)}>{Object.entries(NOTIFICATION_THEMES).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}</select></div><div className="field"><label>Reminder Deadline</label><input value={notificationDeadline} onChange={(e) => setNotificationDeadline(e.target.value)} placeholder="within 2 business days" /></div><div className="field"><label>Template Editor</label><div className="row"><button className="btn secondary sm" onClick={() => setTemplateEditorOpen((current) => !current)}>{templateEditorOpen ? "Hide Template" : "Edit Template"}</button></div></div></div>{templateEditorOpen ? <div className="panel"><div className="panel-head"><strong>Email Template</strong><span className="tiny">Use placeholders like {"{{projectManager}}"} and {"{{deadline}}"}</span></div><div className="panel-body"><div className="field"><label>Greeting</label><input value={notificationTemplate.greeting} onChange={(e) => void saveNotificationTemplate({ greeting: e.target.value })} /></div><div className="field"><label>Intro</label><textarea value={notificationTemplate.intro} onChange={(e) => void saveNotificationTemplate({ intro: e.target.value })} /></div><div className="field"><label>Action Line</label><textarea value={notificationTemplate.actionLine} onChange={(e) => void saveNotificationTemplate({ actionLine: e.target.value })} /></div><div className="field"><label>Deadline Line</label><input value={notificationTemplate.deadlineText} onChange={(e) => void saveNotificationTemplate({ deadlineText: e.target.value })} /></div><div className="field"><label>Closing</label><textarea value={notificationTemplate.closing} onChange={(e) => void saveNotificationTemplate({ closing: e.target.value })} /></div><div className="grid2"><div className="field"><label>Signature Line 1</label><input value={notificationTemplate.signatureLine1} onChange={(e) => void saveNotificationTemplate({ signatureLine1: e.target.value })} /></div><div className="field"><label>Signature Line 2</label><input value={notificationTemplate.signatureLine2} onChange={(e) => void saveNotificationTemplate({ signatureLine2: e.target.value })} /></div></div></div></div> : null}<div className="notification-list">{themedNotifications.length ? themedNotifications.map((d, i) => { const trackingKey = `${d.projectManager}||${d.recipientEmail}`; const tracking = notificationTracking[trackingKey]; const stageLabel = escalationStage(tracking); const outlookLabel = !tracking || tracking.outlookCount === 0 ? "Send Outlook Reminder 1" : tracking.outlookCount === 1 ? "Send Outlook Reminder 2" : "Outlook Follow-ups Done"; return <div className="notification-card" key={`${d.recipientEmail}-${i}`}><strong>{d.projectManager}</strong><div className="notification-meta"><span className="badge">{d.recipientEmail}</span><span className="badge">{d.rows.length} rows</span><span className="badge">{NOTIFICATION_THEMES[notificationTheme].label}</span><span className={`badge ${tracking?.lastChannel === "teams" ? "danger" : tracking?.outlookCount ? "warn" : ""}`}>{stageLabel}</span></div><div className="tiny">{d.subject}</div><div className="tiny">Tracking: Outlook {tracking?.outlookCount || 0}/2, Teams {tracking?.teamsCount || 0}, Last sent {tracking?.lastSentAt ? fmtDate(tracking.lastSentAt) : "-"}</div><div className="row" style={{ marginTop: 8 }}><button className="btn secondary sm" onClick={() => void navigator.clipboard.writeText(d.text)}>Copy</button><button className="btn secondary sm" onClick={() => void openOutlookDraft(d)} disabled={(tracking?.outlookCount || 0) >= 2}>{outlookLabel}</button><button className="btn secondary sm" onClick={() => void openTeamsEscalation(d)} disabled={(tracking?.outlookCount || 0) < 2}>Teams Escalation</button>{previewUrls[i] ? <a href={previewUrls[i]} target="_blank" rel="noreferrer"><button className="btn ghost sm" type="button">Saved Preview</button></a> : null}</div><div className="preview" dangerouslySetInnerHTML={{ __html: d.html }} /></div>; }) : <div className="empty"><strong>No notification drafts yet</strong><div>Run an audit to generate PM-facing drafts.</div></div>}</div></div></div> : null}
            {tab === "history" ? <><div className="panel"><div className="panel-head"><strong>Version History</strong><span className="tiny">{activeProcess ? `Process ${processLabel(activeProcess)}` : "No active process"}</span></div><div className="panel-body"><div className="history-list">{history.length ? history.map((v) => <div className="history-card" key={v.version}><strong>Version {v.version}</strong><div className="tiny">{fmtDate(v.createdAt)}</div><div className="tiny">Flagged: {v.summary.flaggedRows} | Issues: {v.summary.issueCount}</div></div>) : <div className="empty"><strong>No saved snapshots yet</strong><div>This process is healthy. You just have not saved history yet.</div></div>}</div></div></div><div className="panel"><div className="panel-head"><strong>Version Compare</strong><span className="tiny">Compare two saved snapshots</span></div><div className="panel-body"><div className="grid3"><div className="field"><label>From Version</label><select value={compareFrom} onChange={(e) => setCompareFrom(e.target.value)}><option value="">Select version</option>{history.map((v) => <option key={v.version} value={String(v.version)}>Version {v.version}</option>)}</select></div><div className="field"><label>To Version</label><select value={compareTo} onChange={(e) => setCompareTo(e.target.value)}><option value="">Select version</option>{history.map((v) => <option key={v.version} value={String(v.version)}>Version {v.version}</option>)}</select></div><div className="field" style={{ alignSelf: "end" }}><button className="btn secondary" disabled={history.length < 2} onClick={() => void compareVersions()}>Compare</button></div></div>{renderCompareDetails(compare, "Choose two versions to compare", "Version differences will appear here.")}</div></div></> : null}
          </section>
        )}
      </main>
      {processModal ? <Modal title={processModal.mode === "create" ? "Create Process" : "Edit Process"} onClose={() => setProcessModal(null)}><div className="grid2"><div className="field"><label>Process Name</label><input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="Quarterly PM Audit" /></div><div className="field"><label>Source Type</label><select value={formSourceType} onChange={(e) => setFormSourceType(e.target.value)} disabled={processModal.mode === "edit"}><option value="currentWorkbook">Current Workbook</option><option value="uploadedFile">Upload Files</option></select></div></div><div className="field"><label>Description</label><textarea value={formDescription} onChange={(e) => setFormDescription(e.target.value)} placeholder="Describe what this audit process is for." /></div><div className="row"><button className="btn" onClick={() => void submitProcessForm()}>{processModal.mode === "create" ? "Create Process" : "Save Changes"}</button><button className="btn ghost" onClick={() => setProcessModal(null)}>Cancel</button></div></Modal> : null}
      {deleteTarget ? <Modal title="Delete Process" onClose={() => setDeleteTarget(null)}><div>Are you sure you want to delete <strong>{processLabel(deleteTarget)}</strong>? This will also remove uploaded files, saved snapshots, and generated previews for this process.</div><div className="row"><button className="btn danger" onClick={() => void confirmDeleteProcess()}>Delete Process</button><button className="btn ghost" onClick={() => setDeleteTarget(null)}>Cancel</button></div></Modal> : null}
    </div>
  );
}

function mountApp() {
  const rootEl = document.getElementById("root");
  if (rootEl) createRoot(rootEl).render(<App />);
}

Office.onReady((info) => {
  if (info.host !== Office.HostType.Excel) {
    const rootEl = document.getElementById("root");
    if (rootEl) createRoot(rootEl).render(<div className="content"><div className="empty"><strong>This extension is designed for Excel</strong><div>Open it from Excel Desktop to use workbook auditing.</div></div></div>);
    return;
  }
  mountApp();
});
