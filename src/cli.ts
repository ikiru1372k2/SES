import { compareSnapshots, listSnapshots } from "./snapshots.js";
import { runAudit } from "./pipeline.js";

function getArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function run(): Promise<void> {
  const workbookPath = getArg("--workbook") ?? "effort_sample_data.xlsx";
  const result = await runAudit(workbookPath, getArg("--session"));

  console.log(
    JSON.stringify(
      {
        sessionId: result.sessionId,
        version: result.snapshot.version,
        sourceSheet: result.snapshot.sourceSheetName,
        scannedSheets: result.snapshot.scannedSheetNames,
        duplicateSheets: result.snapshot.duplicateSheetNames,
        summary: result.snapshot.summary,
        auditedWorkbookPath: result.auditedWorkbookPath,
        previewFiles: result.previewFiles,
        notificationRecipients: result.snapshot.notifications.map((draft) => draft.recipientEmail),
      },
      null,
      2,
    ),
  );
}

function compare(): void {
  const sessionId = getArg("--session");
  if (!sessionId) {
    throw new Error("Provide --session to compare snapshots.");
  }

  const fromVersion = Number(getArg("--from"));
  const toVersion = Number(getArg("--to"));
  const snapshots = listSnapshots(sessionId);
  const fromSnapshot = snapshots.find((snapshot) => snapshot.version === fromVersion);
  const toSnapshot = snapshots.find((snapshot) => snapshot.version === toVersion);

  if (!fromSnapshot || !toSnapshot) {
    throw new Error(`Unable to find versions ${fromVersion} and ${toVersion} for session ${sessionId}.`);
  }

  console.log(JSON.stringify(compareSnapshots(fromSnapshot, toSnapshot), null, 2));
}

const command = process.argv[2] ?? "run";

if (command === "run") {
  run().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
} else if (command === "compare") {
  try {
    compare();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
} else {
  console.error(`Unknown command "${command}".`);
  process.exitCode = 1;
}
