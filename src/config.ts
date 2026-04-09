export const SETTINGS = {
  sourceSheetName: "Effort Data",
  summarySheetName: "Summary",
  bannerRow: 1,
  headerRow: 2,
  firstDataRow: 3,
  thresholds: {
    elevatedEffortHours: 600,
    highEffortHours: 800
  },
  auditColumns: ["Audit Status", "Audit Severity", "Audit Notes"] as const,
  severityColors: {
    High: "FFF4CCCC",
    Medium: "FFFFF2CC",
    Low: "FFE2F0D9"
  } as const,
  outputDir: "output",
  snapshotDir: "output/snapshots",
  previewDir: "output/previews",
  draftDir: "output/drafts",
  uploadDir: "output/uploads",
  processStoreFile: "output/processes.json",
  auditedWorkbookName: "effort_sample_data.audited.xlsx",
  sessionStoreFile: "output/sessions.json",
  defaultPort: 3210
} as const;

export const REQUIRED_HEADERS = [
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
  "Effort (H)"
] as const;
