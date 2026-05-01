ALTER TABLE "NotificationTemplate"
    RENAME COLUMN "createdBy" TO "createdById";

ALTER TABLE "NotificationTemplate"
    ADD CONSTRAINT "NotificationTemplate_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
