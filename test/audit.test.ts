import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { runAudit } from "../src/pipeline.js";
import { compareSnapshotToRows } from "../src/snapshots.js";
import type { AuditedRow } from "../src/types.js";

const workbookPath = path.resolve("effort_sample_data.xlsx");

test("audit pipeline scans the workbook and classifies known sample rows", async () => {
  const result = await runAudit(workbookPath);

  assert.equal(result.snapshot.sourceSheetName, "Effort Data");
  assert.deepEqual(result.snapshot.scannedSheetNames, ["Effort Data"]);
  assert.deepEqual(result.snapshot.duplicateSheetNames, ["Summary"]);
  assert.equal(result.snapshot.summary.totalRows, 28);

  const pendingRows = result.snapshot.rows.filter((row) => row.auditStatus === "Pending Estimation");
  assert.equal(pendingRows.length, 6);

  const onHoldRows = result.snapshot.rows.filter((row) =>
    row.issues.some((issue) => issue.code === "ON_HOLD_WITH_NO_EFFORT"),
  );
  assert.equal(onHoldRows.length, 2);

  const highEffortRows = result.snapshot.rows.filter((row) =>
    row.issues.some((issue) => issue.code === "HIGH_EFFORT_PROJECT"),
  );
  assert.equal(highEffortRows.length, 3);

  const elevatedRows = result.snapshot.rows.filter((row) =>
    row.issues.some((issue) => issue.code === "ELEVATED_EFFORT_PROJECT"),
  );
  assert.equal(elevatedRows.length, 3);

  assert.ok(result.previewFiles.length > 0);
});

test("snapshot comparison tracks current unsaved audit changes in the same process", async () => {
  const result = await runAudit(workbookPath);
  const baseline = result.snapshot;

  const currentRows: AuditedRow[] = baseline.rows
    .filter((row) => row.projectNo !== "90032102")
    .map((row) => {
      if (row.projectNo === "90032101") {
        return {
          ...row,
          projectManager: "Changed, Manager",
          email: "changed.manager@company.com",
        };
      }
      if (row.projectNo === "90032104") {
        return {
          ...row,
          issues: [],
          highestSeverity: null,
          auditStatus: "OK",
          auditSeverity: "OK" as const,
          auditNotes: "",
        };
      }
      return row;
    });

  const comparison = compareSnapshotToRows(baseline, currentRows);

  assert.equal(comparison.baselineVersion, 1);
  assert.equal(comparison.toVersion, null);
  assert.ok(comparison.resolvedIssues > 0);
  assert.ok(comparison.managerChanges.some((item) => item.projectNo === "90032101"));
  assert.ok(comparison.resolvedIssueRows.some((item) => item.projectNo === "90032104"));
});
