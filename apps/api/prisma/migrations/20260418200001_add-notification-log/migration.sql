-- CreateTable
CREATE TABLE "notification_log" (
    "id" TEXT NOT NULL,
    "displayCode" TEXT NOT NULL,
    "processId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "managerEmail" TEXT NOT NULL,
    "managerName" TEXT,
    "channel" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "bodyPreview" TEXT NOT NULL,
    "severity" TEXT,
    "issueCount" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notification_log_displayCode_key" ON "notification_log"("displayCode");

-- CreateIndex
CREATE INDEX "notification_log_processId_sentAt_idx" ON "notification_log"("processId", "sentAt");

-- CreateIndex
CREATE INDEX "notification_log_managerEmail_sentAt_idx" ON "notification_log"("managerEmail", "sentAt");

-- AddForeignKey
ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_processId_fkey" FOREIGN KEY ("processId") REFERENCES "Process"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
