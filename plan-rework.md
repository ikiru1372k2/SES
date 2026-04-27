# SES — Complete Production Architecture Plan

**Branch:** `ashik/structure`  
**Date:** 2026-04-28

---

## Table of Contents

1. [Current Problems](#1-current-problems)
2. [Database — Clean Design](#2-database--clean-design)
3. [AWS S3 File Storage](#3-aws-s3-file-storage)
4. [API — Folder Structure & File Breakdown](#4-api--folder-structure--file-breakdown)
5. [UI — Feature-Based Structure & File Breakdown](#5-ui--feature-based-structure--file-breakdown)
6. [Domain Package](#6-domain-package)
7. [Migration Phases](#7-migration-phases)

---

## 1. Current Problems

### Database
| Problem | Detail |
|---|---|
| 6 BYTEA columns | `FileBlob.content`, `FileVersion.content`, `FileDraft.content`, `TrackingAttachment.content`, `Export.content`, `AiPilotSandboxSession.fileBytes` — binary blobs in Postgres |
| `FileBlob` is a 1:1 stub | Only exists to separate bytes from metadata — pointless once we have S3 |
| Two template tables | `NotificationTemplate` (escalation stages) and `ComposerNotificationTemplate` (letter themes) — confusing names |
| `Notification` table is sparse | Overlaps with `NotificationLog`; most fields nullable; purpose unclear |
| `TrackingEntry.composeDraft Json?` | Draft state embedded directly on the entry — prevents multi-draft, breaks separation |
| `TrackingEntry.projectStatuses Json?` | Derived state stored as blob — should be computed |
| String fields that should be enums | `User.role`, `ProcessMember.permission`, `TrackingStageComment.stage`, `NotificationTemplate.channel`, `Job.state`, `Export.format` |
| `NotificationTemplate.createdBy` is a plain String | Not a FK relation — broken audit trail |
| Missing `updatedAt` | `SignedLink`, `WebhookEndpoint`, `TrackingEvent`, `FunctionAuditRequest`, `SavedVersion`, `IssueComment`, `TrackingStageComment` |
| Missing indexes | `AuditRun` by file, `Job` by state+processId, `Export` by processId+status, `LiveSession` by userId |
| `IdentifierCounter` naming | Misleading — should be `SequenceCounter` |
| `Job` model naming | Collides with TypeScript built-in `Job` — rename to `BackgroundJob` |

### Code files
| File | Lines | Problem |
|---|---|---|
| `useAppStore.ts` | 1380 | Monolithic store — any update re-renders entire app |
| `AuditResultsTab.tsx` | 975 | Data fetch + table + filter + state all mixed |
| `audits.service.ts` | 874 | Run + results + analytics in one class |
| `directory.service.ts` | 826 | Import + merge + query in one class |
| `processes.service.ts` | 725 | CRUD + policy + members in one class |
| `tracking-compose.service.ts` | 690 | Draft + render + send in one class |
| `VersionCompare.tsx` | 664 | Diff engine embedded in page |
| `Composer.tsx` | 648 | Letter editor + send + state all mixed |
| `SandboxModal.tsx` | 641 | Upload + eval + results in one modal |
| `Workspace.tsx` | 593 | Page + loader + sidebar all mixed |
| `MembersPanel.tsx` | 525 | List + form in one component |
| `EscalationCenter.tsx` | 520 | Page + loader + all state mixed |

---

## 2. Database — Clean Design

### 2.1 New Enums

```prisma
enum UserRole         { ADMIN AUDITOR VIEWER }
enum MemberPermission { OWNER EDITOR VIEWER }
enum ScopeType        { ALL_FUNCTIONS FUNCTION ESCALATION_CENTER }
enum ManagerSource    { MANUAL IMPORT SSO }
enum AuditStatus      { PENDING RUNNING COMPLETED FAILED }
enum AuditSource      { INLINE SCHEDULED }
enum EscalationStage  { NEW DRAFTED SENT AWAITING_RESPONSE RESPONDED NO_RESPONSE ESCALATED_L1 ESCALATED_L2 RESOLVED }
enum NotifChannel     { EMAIL TEAMS IN_APP }
enum NotifStatus      { DRAFT QUEUED SENT FAILED }
enum JobState         { PENDING RUNNING COMPLETED FAILED CANCELLED }
enum ExportFormat     { XLSX CSV }
enum ExportKind       { AUDIT_RUN SAVED_VERSION }
enum LinkPurpose      { MANAGER_RESPONSE SHARE_VIEW DIGEST_UNSUBSCRIBE }
```

### 2.2 Cleaned Schema (grouped by domain)

#### Group A — Identity & Access

```prisma
model Tenant {
  id        String    @id
  name      String
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  // relations
  users               User[]
  processes           Process[]
  managerDirectories  ManagerDirectory[]
  escalationTemplates NotificationTemplate[] @relation("TenantTemplates")
}

model User {
  id           String    @id
  displayCode  String    @unique
  tenantId     String                              // ADD: scoped to tenant
  email        String    @unique
  displayName  String
  ssoSubject   String?   @unique
  passwordHash String?
  role         UserRole  @default(AUDITOR)         // was String
  isActive     Boolean   @default(true)
  lastLoginAt  DateTime?
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt
  tenant       Tenant    @relation(fields: [tenantId], references: [id])
  // keep all existing reverse relations

  @@index([tenantId, role])
  @@index([tenantId, email])
}

model ApiToken {
  id         String    @id
  displayCode String   @unique
  ownerId    String
  name       String
  tokenHash  Bytes
  scopes     Json
  expiresAt  DateTime?
  lastUsedAt DateTime?
  revokedAt  DateTime?
  createdAt  DateTime  @default(now())
  updatedAt  DateTime  @updatedAt            // ADD
  owner      User      @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  @@index([ownerId])
}

model UserPreference {
  id            String   @id
  userId        String   @unique
  lastProcessId String?
  defaultTab    String?
  data          Json?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  user          User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

#### Group B — Process & Access Control

```prisma
model Process {
  id              String    @id
  displayCode     String    @unique
  tenantId        String
  name            String
  description     String    @default("")
  nextAuditDue    DateTime?
  auditPolicy     Json
  policyVersion   Int       @default(1)
  slaInitialHours Int       @default(120)
  createdById     String
  rowVersion      Int       @default(1)
  archivedAt      DateTime?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  tenant          Tenant    @relation(fields: [tenantId], references: [id])
  createdBy       User      @relation("ProcessCreatedBy", fields: [createdById], references: [id])

  @@index([tenantId, archivedAt])
  @@index([tenantId, createdAt(sort: Desc)])
}

model SystemFunction {
  id           String   @id
  label        String
  displayOrder Int
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  // no isSystem flag needed — all rows ARE system rows
}

model ProcessFunction {           // enablement matrix
  processId  String
  functionId String
  enabled    Boolean  @default(true)
  updatedAt  DateTime @updatedAt
  process    Process        @relation(fields: [processId], references: [id], onDelete: Cascade)
  function   SystemFunction @relation(fields: [functionId], references: [id])
  @@id([processId, functionId])
  @@index([processId])
}

model ProcessMember {
  id          String           @id
  displayCode String           @unique
  processId   String
  userId      String
  permission  MemberPermission              // was String
  addedById   String?
  addedAt     DateTime         @default(now())
  process     Process          @relation(fields: [processId], references: [id], onDelete: Cascade)
  user        User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  scopePerms  ProcessMemberScopePermission[]
  @@unique([processId, userId])
  @@index([userId])
}

model ProcessMemberScopePermission {
  id          String           @id
  processId   String
  memberId    String
  scopeType   ScopeType                     // was String
  functionId  String?
  accessLevel MemberPermission              // was String
  createdAt   DateTime         @default(now())
  updatedAt   DateTime         @updatedAt
  process     Process          @relation(fields: [processId], references: [id], onDelete: Cascade)
  member      ProcessMember    @relation(fields: [memberId], references: [id], onDelete: Cascade)
  function    SystemFunction?  @relation(fields: [functionId], references: [id])
  @@unique([memberId, scopeType, functionId])
  @@index([processId])
  @@index([memberId])
}

model FunctionAuditRequest {
  id            String    @id
  displayCode   String    @unique
  processId     String
  requestedById String
  proposedName  String
  description   String    @default("")
  contactEmail  String
  status        String    @default("open")
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt     // ADD
  process       Process   @relation(fields: [processId], references: [id], onDelete: Cascade)
  @@index([processId, status])
}
```

#### Group C — File Storage (S3-backed)

```prisma
// FileBlob model DELETED — content moves to S3

model WorkbookFile {
  id            String    @id
  displayCode   String    @unique
  processId     String
  functionId    String
  name          String
  sizeBytes     Int
  contentSha256 String                    // was Bytes, now hex string
  mimeType      String
  s3Key         String                    // NEW — replaces FileBlob.content
  s3Bucket      String                    // NEW
  parsedSheets  Json?
  uploadedById  String
  uploadedAt    DateTime  @default(now())
  lastAuditedAt DateTime?
  rowVersion    Int       @default(1)
  state         String    @default("completed")
  currentVersion Int      @default(1)
  deletedAt     DateTime?                 // ADD — soft delete
  process       Process        @relation(fields: [processId], references: [id], onDelete: Cascade)
  function      SystemFunction @relation(fields: [functionId], references: [id])
  uploadedBy    User           @relation("WorkbookUploadedBy", fields: [uploadedById], references: [id])
  sheets        WorkbookSheet[]
  auditRuns     AuditRun[]
  fileVersions  FileVersion[]

  @@index([processId, functionId, deletedAt])
  @@index([processId, uploadedAt(sort: Desc)])
}

model WorkbookSheet {
  id                String       @id
  displayCode       String       @unique
  fileId            String
  sheetName         String
  status            String
  rowCount          Int
  isSelected        Boolean      @default(true)
  headerRowIx       Int?
  rows              Json
  originalHeaders   Json?
  normalizedHeaders Json?
  file              WorkbookFile @relation(fields: [fileId], references: [id], onDelete: Cascade)
  @@unique([fileId, sheetName])
  @@index([fileId])
}

model FileVersion {
  id            String       @id
  fileId        String
  versionNumber Int
  s3Key         String                    // NEW — replaces Bytes content
  s3Bucket      String                    // NEW
  contentSha256 String
  sizeBytes     Int
  note          String       @default("")
  createdById   String
  createdAt     DateTime     @default(now())
  file          WorkbookFile @relation(fields: [fileId], references: [id], onDelete: Cascade)
  createdBy     User         @relation("FileVersionBy", fields: [createdById], references: [id])
  @@unique([fileId, versionNumber])
  @@index([fileId])
}

model FileDraft {
  id         String         @id
  userId     String
  processId  String
  functionId String
  fileName   String
  s3Key      String                       // NEW — replaces Bytes content
  s3Bucket   String                       // NEW
  sizeBytes  Int
  updatedAt  DateTime       @updatedAt
  createdAt  DateTime       @default(now())
  user       User           @relation("FileDraftBy", fields: [userId], references: [id], onDelete: Cascade)
  process    Process        @relation(fields: [processId], references: [id], onDelete: Cascade)
  function   SystemFunction @relation(fields: [functionId], references: [id])
  @@unique([userId, processId, functionId])
  @@index([processId, functionId])
}
```

#### Group D — Audit Engine

```prisma
model AuditRule {
  id               String         @id
  ruleCode         String         @unique
  functionId       String
  name             String
  category         String
  description      String
  defaultSeverity  String
  isEnabledDefault Boolean        @default(true)
  paramsSchema     Json
  version          Int            @default(1)
  source           AuditSource    @default(INLINE)  // was String
  status           String         @default("active")
  deletedAt        DateTime?                        // ADD — soft delete
  createdAt        DateTime       @default(now())
  updatedAt        DateTime       @updatedAt        // ADD
  function         SystemFunction @relation(fields: [functionId], references: [id])
  issues           AuditIssue[]
  aiMeta           AiPilotRuleMeta?
  @@index([functionId, status, deletedAt])
  @@index([source, status])
}

model AuditRun {
  id             String      @id
  displayCode    String      @unique
  processId      String
  fileId         String
  requestId      String
  status         AuditStatus @default(COMPLETED)    // was String
  source         AuditSource @default(INLINE)       // was String
  policySnapshot Json
  rulesSnapshot  Json
  scannedRows    Int         @default(0)
  flaggedRows    Int         @default(0)
  findingsHash   String      @default("")
  summary        Json
  ranById        String
  startedAt      DateTime    @default(now())
  completedAt    DateTime?
  process        Process      @relation(fields: [processId], references: [id], onDelete: Cascade)
  file           WorkbookFile @relation(fields: [fileId], references: [id], onDelete: Cascade)
  ranBy          User         @relation("AuditRunBy", fields: [ranById], references: [id])
  issues         AuditIssue[]
  versions       SavedVersion[]
  exports        Export[]
  @@index([processId, fileId, startedAt(sort: Desc)])
  @@index([fileId, status])
}

model AuditIssue {
  id                String    @id
  displayCode       String    @unique
  issueKey          String
  auditRunId        String
  ruleCode          String
  projectNo         String?
  projectName       String?
  sheetName         String?
  projectManager    String?
  projectState      String?
  effort            Float?
  severity          String
  reason            String?
  thresholdLabel    String?
  recommendedAction String?
  email             String?
  rowIndex          Int?
  missingMonths     Json?
  zeroMonthCount    Int?
  auditRun          AuditRun  @relation(fields: [auditRunId], references: [id], onDelete: Cascade)
  rule              AuditRule @relation(fields: [ruleCode], references: [ruleCode])
  comments          IssueComment[]
  corrections       IssueCorrection[]
  acknowledgments   IssueAcknowledgment[]
  @@index([auditRunId, severity])
  @@index([issueKey])
  @@index([ruleCode])
}

// CHANGE: IssueComment/Correction/Acknowledgment now hang off AuditIssue
// instead of having processId + issueKey as a loose key

model IssueComment {
  id          String     @id
  displayCode String     @unique
  issueId     String                   // was (processId + issueKey)
  authorId    String
  body        String
  editedAt    DateTime?
  deletedAt   DateTime?
  rowVersion  Int        @default(1)
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt   // ADD
  issue       AuditIssue @relation(fields: [issueId], references: [id], onDelete: Cascade)
  author      User       @relation("IssueCommentBy", fields: [authorId], references: [id])
  @@index([issueId, deletedAt])
}

model IssueCorrection {
  id               String     @id
  displayCode      String     @unique
  issueId          String     @unique   // was (processId, issueKey)
  correctedEffort  Float?
  correctedState   String?
  correctedManager String?
  note             String     @default("")
  updatedById      String
  rowVersion       Int        @default(1)
  createdAt        DateTime   @default(now())
  updatedAt        DateTime   @updatedAt
  issue            AuditIssue @relation(fields: [issueId], references: [id], onDelete: Cascade)
  updatedBy        User       @relation("IssueCorrectionBy", fields: [updatedById], references: [id])
}

model IssueAcknowledgment {
  id          String     @id
  displayCode String     @unique
  issueId     String     @unique   // was (processId, issueKey)
  status      String
  updatedById String
  rowVersion  Int        @default(1)
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt
  issue       AuditIssue @relation(fields: [issueId], references: [id], onDelete: Cascade)
  updatedBy   User       @relation("IssueAcknowledgmentBy", fields: [updatedById], references: [id])
}

model SavedVersion {
  id            String    @id
  displayCode   String    @unique
  processId     String
  auditRunId    String
  versionNumber Int
  versionName   String
  notes         String    @default("")
  createdById   String
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt    // ADD
  process       Process   @relation(fields: [processId], references: [id], onDelete: Cascade)
  auditRun      AuditRun  @relation(fields: [auditRunId], references: [id], onDelete: Cascade)
  createdBy     User      @relation("SavedVersionBy", fields: [createdById], references: [id])
  exports       Export[]
  @@unique([processId, versionNumber])
  @@index([processId, createdAt(sort: Desc)])
}
```

#### Group E — Tracking & Escalation

```prisma
model TrackingEntry {
  id              String          @id
  displayCode     String          @unique
  processId       String
  managerKey      String
  managerName     String
  managerEmail    String?
  stage           EscalationStage @default(NEW)
  escalationLevel Int             @default(0)
  outlookCount    Int             @default(0)
  teamsCount      Int             @default(0)
  lastContactAt   DateTime?
  resolved        Boolean         @default(false)
  slaDueAt        DateTime?
  draftLockUserId    String?
  draftLockExpiresAt DateTime?
  verifiedById    String?
  verifiedAt      DateTime?
  rowVersion      Int             @default(1)
  updatedAt       DateTime        @updatedAt
  process         Process         @relation(fields: [processId], references: [id], onDelete: Cascade)
  draftLockUser   User?           @relation("TrackingDraftLock", fields: [draftLockUserId], references: [id], onDelete: SetNull)
  verifiedBy      User?           @relation("TrackingVerifier", fields: [verifiedById], references: [id], onDelete: SetNull)
  events          TrackingEvent[]
  stageComments   TrackingStageComment[]
  attachments     TrackingAttachment[]
  draft           TrackingDraft?          // NEW: extracted from Json field
  notificationLogs NotificationLog[]
  notifications   Notification[]

  // REMOVED: composeDraft Json? — moved to TrackingDraft
  // REMOVED: projectStatuses Json? — computed at query time

  @@unique([processId, managerKey])
  @@index([processId, stage, slaDueAt])
  @@index([processId, managerEmail])
}

// NEW: extracted from TrackingEntry.composeDraft
model TrackingDraft {
  id              String        @id
  trackingEntryId String        @unique
  content         Json
  lockedById      String?
  lockedAt        DateTime?
  updatedAt       DateTime      @updatedAt
  createdAt       DateTime      @default(now())
  trackingEntry   TrackingEntry @relation(fields: [trackingEntryId], references: [id], onDelete: Cascade)
}

model TrackingEvent {
  id            String        @id
  displayCode   String        @unique
  trackingId    String
  kind          String        @default("contact")
  channel       NotifChannel                       // was String
  note          String?
  reason        String?
  payload       Json?
  triggeredById String?
  requestId     String?
  at            DateTime      @default(now())
  tracking      TrackingEntry @relation(fields: [trackingId], references: [id], onDelete: Cascade)
  triggeredBy   User?         @relation("TrackingEventBy", fields: [triggeredById], references: [id])
  @@index([trackingId, at(sort: Desc)])
}

model TrackingStageComment {
  id              String          @id
  displayCode     String          @unique
  trackingEntryId String
  stage           EscalationStage               // was String — fix inconsistency
  authorId        String
  authorName      String
  body            String
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt    // ADD
  trackingEntry   TrackingEntry   @relation(fields: [trackingEntryId], references: [id], onDelete: Cascade)
  author          User            @relation("TrackingStageCommentBy", fields: [authorId], references: [id])
  @@index([trackingEntryId, stage])
}

model TrackingAttachment {
  id              String        @id
  displayCode     String        @unique
  trackingEntryId String
  uploadedById    String
  fileName        String
  mimeType        String
  sizeBytes       Int
  s3Key           String                        // NEW — replaces Bytes content
  s3Bucket        String                        // NEW
  comment         String        @default("")
  deletedAt       DateTime?
  createdAt       DateTime      @default(now())
  trackingEntry   TrackingEntry @relation(fields: [trackingEntryId], references: [id], onDelete: Cascade)
  uploadedBy      User          @relation("TrackingAttachmentBy", fields: [uploadedById], references: [id])
  @@index([trackingEntryId, deletedAt])
}
```

#### Group F — Notifications

```prisma
// System / tenant-level escalation stage templates
model NotificationTemplate {
  id        String        @id
  tenantId  String?
  parentId  String?
  stage     EscalationStage
  subject   String
  body      String
  channel   NotifChannel                     // was String
  active    Boolean       @default(true)
  version   Int           @default(1)
  createdById String                         // ADD proper FK
  createdAt DateTime      @default(now())
  updatedAt DateTime      @updatedAt
  tenant    Tenant?       @relation("TenantTemplates", fields: [tenantId], references: [id], onDelete: SetNull)
  createdBy User          @relation("TemplateCreatedBy", fields: [createdById], references: [id])
  parent    NotificationTemplate?  @relation("TemplateOverride", fields: [parentId], references: [id], onDelete: SetNull)
  overrides NotificationTemplate[] @relation("TemplateOverride")
  @@index([tenantId, stage, active])
}

// User-composed letter themes (composer UI) — renamed for clarity
model LetterTheme {
  id          String    @id
  displayCode String    @unique
  processId   String?
  ownerId     String?
  name        String
  theme       String
  template    Json
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt    // ADD
  process     Process?  @relation(fields: [processId], references: [id], onDelete: Cascade)
  owner       User?     @relation("LetterThemeOwner", fields: [ownerId], references: [id])
  notifications Notification[]

  @@map("letter_theme")              // clean DB table name
  @@index([processId])
  @@index([ownerId])
}

// Outbound notification record (one row per send attempt)
model Notification {
  id          String        @id
  displayCode String        @unique
  processId   String
  trackingId  String?
  themeId     String?                        // was templateId
  channel     NotifChannel                   // was String
  subject     String?
  body        String?
  sentById    String?
  sentAt      DateTime?
  status      NotifStatus   @default(DRAFT)  // was String
  createdAt   DateTime      @default(now())
  updatedAt   DateTime      @updatedAt       // ADD
  process     Process       @relation(fields: [processId], references: [id], onDelete: Cascade)
  tracking    TrackingEntry? @relation(fields: [trackingId], references: [id])
  theme       LetterTheme?  @relation(fields: [themeId], references: [id])
  sentBy      User?         @relation("NotificationBy", fields: [sentById], references: [id])
  @@index([processId, status, sentAt])
  @@index([trackingId])
}

// Immutable send log (append-only audit trail)
model NotificationLog {
  id              String        @id @default(cuid())
  displayCode     String        @unique
  processId       String
  actorUserId     String
  trackingEntryId String?
  managerEmail    String
  managerName     String?
  channel         NotifChannel                   // was String
  subject         String
  bodyPreview     String
  resolvedBody    String?
  sources         Json?
  severity        String?
  issueCount      Int           @default(0)
  authorNote      String        @default("")
  deadlineAt      DateTime?
  sentAt          DateTime      @default(now())
  process         Process       @relation(fields: [processId], references: [id], onDelete: Cascade)
  actor           User          @relation(fields: [actorUserId], references: [id])
  trackingEntry   TrackingEntry? @relation(fields: [trackingEntryId], references: [id], onDelete: SetNull)
  @@index([processId, sentAt(sort: Desc)])
  @@index([managerEmail, sentAt])
  @@index([trackingEntryId])
  @@map("notification_log")
}
```

#### Group G — AI Pilot

```prisma
model AiPilotRuleMeta {
  id              String    @id
  ruleCode        String    @unique
  description     String
  logic           Json
  flagMessage     String    @default("")
  authoredById    String
  sourcePrompt    String
  sourceSessionId String?
  llmModel        String    @default("qwen2.5:7b")
  llmRawResponse  Json?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  rule            AuditRule              @relation(fields: [ruleCode], references: [ruleCode], onDelete: Cascade)
  authoredBy      User                   @relation("AiRuleAuthoredBy", fields: [authoredById], references: [id])
  sourceSession   AiPilotSandboxSession? @relation(fields: [sourceSessionId], references: [id], onDelete: SetNull)
  @@index([authoredById])
}

model AiPilotSandboxSession {
  id           String    @id
  authoredById String
  functionId   String
  fileName     String
  s3Key        String                    // NEW — replaces Bytes fileBytes
  s3Bucket     String                    // NEW
  sheetName    String?
  expiresAt    DateTime
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt      // ADD
  authoredBy   User              @relation("AiSandboxBy", fields: [authoredById], references: [id])
  function     SystemFunction    @relation(fields: [functionId], references: [id])
  rulesAuthored AiPilotRuleMeta[]
  @@index([authoredById])
  @@index([expiresAt])
}

model AiPilotAuditLog {
  id        String   @id
  actorId   String
  action    String
  ruleCode  String?
  payload   Json
  createdAt DateTime @default(now())
  actor     User     @relation("AiAuditLogActor", fields: [actorId], references: [id])
  @@index([actorId, createdAt(sort: Desc)])
  @@index([ruleCode])
}
```

#### Group H — Infrastructure

```prisma
model ManagerDirectory {
  id            String        @id
  displayCode   String        @unique
  tenantId      String
  firstName     String
  lastName      String
  email         String
  normalizedKey String
  aliases       Json          @default("[]")
  active        Boolean       @default(true)
  source        ManagerSource @default(MANUAL)  // was String
  createdById   String?
  createdAt     DateTime      @default(now())
  updatedAt     DateTime      @updatedAt
  tenant        Tenant        @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  createdBy     User?         @relation("ManagerCreatedBy", fields: [createdById], references: [id])
  @@unique([tenantId, email])
  @@index([tenantId, normalizedKey])
  @@index([tenantId, active])
}

model BackgroundJob {             // renamed from Job
  id          String    @id
  displayCode String    @unique
  kind        String
  processId   String?
  requestId   String?
  state       JobState  @default(PENDING)  // was String
  attempts    Int       @default(0)
  payload     Json?
  result      Json?
  error       String?
  createdById String?
  createdAt   DateTime  @default(now())
  startedAt   DateTime?
  finishedAt  DateTime?
  process     Process?  @relation(fields: [processId], references: [id], onDelete: Cascade)
  createdBy   User?     @relation("JobCreatedBy", fields: [createdById], references: [id])
  @@index([processId, state])
  @@index([state, createdAt])
  @@map("background_job")
}

model ActivityLog {
  id          String    @id
  displayCode String    @unique
  occurredAt  DateTime  @default(now())
  actorId     String?
  actorEmail  String?
  processId   String?
  entityType  String
  entityId    String?
  entityCode  String?
  action      String
  before      Json?
  after       Json?
  requestId   String?
  traceId     String?
  ipAddress   String?
  userAgent   String?
  metadata    Json?
  actor       User?    @relation("ActivityActor", fields: [actorId], references: [id])
  process     Process? @relation(fields: [processId], references: [id], onDelete: Cascade)
  @@index([processId, occurredAt(sort: Desc)])
  @@index([entityType, entityId])
  @@index([actorId, occurredAt(sort: Desc)])
}

model Export {
  id             String      @id
  displayCode    String      @unique
  processId      String?
  auditRunId     String?
  savedVersionId String?
  kind           ExportKind               // was String
  format         ExportFormat             // was String
  requestedById  String?
  requestId      String?
  status         String
  s3Key          String?                  // NEW — replaces Bytes content
  s3Bucket       String?                  // NEW
  fileSha256     String?                  // was Bytes
  sizeBytes      Int?
  contentType    String?
  downloadedAt   DateTime?
  expiresAt      DateTime?
  createdAt      DateTime    @default(now())
  updatedAt      DateTime    @updatedAt  // ADD
  process        Process?    @relation(fields: [processId], references: [id], onDelete: Cascade)
  auditRun       AuditRun?   @relation(fields: [auditRunId], references: [id])
  savedVersion   SavedVersion? @relation(fields: [savedVersionId], references: [id])
  requestedBy    User?       @relation("ExportRequestedBy", fields: [requestedById], references: [id])
  @@index([processId, status, createdAt])
  @@index([expiresAt])
}

model SignedLink {
  id             String      @id
  displayCode    String      @unique
  purpose        LinkPurpose              // was String
  processId      String
  issueKey       String?
  trackingId     String?
  managerEmail   String
  tokenHash      Bytes
  allowedActions Json
  singleUse      Boolean     @default(true)
  usedAt         DateTime?
  usedFromIp     String?
  usedUserAgent  String?
  revokedAt      DateTime?
  expiresAt      DateTime
  createdById    String?
  createdAt      DateTime    @default(now())
  updatedAt      DateTime    @updatedAt  // ADD
  process        Process     @relation(fields: [processId], references: [id], onDelete: Cascade)
  createdBy      User?       @relation("SignedLinkCreator", fields: [createdById], references: [id])
  @@index([processId, expiresAt])
  @@index([issueKey])
}

model LiveSession {
  id            String    @id
  displayCode   String    @unique
  userId        String
  processId     String
  socketId      String
  currentTab    String?
  currentFocus  String?
  connectedAt   DateTime  @default(now())
  lastHeartbeat DateTime  @default(now())
  user          User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  process       Process   @relation(fields: [processId], references: [id], onDelete: Cascade)
  @@index([processId])
  @@index([userId])
}

model WebhookEndpoint {
  id            String    @id
  displayCode   String    @unique
  processId     String?
  url           String
  events        Json
  signingSecret Bytes
  isEnabled     Boolean   @default(true)
  createdById   String?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt    // ADD
  process       Process?  @relation(fields: [processId], references: [id], onDelete: Cascade)
  createdBy     User?     @relation("WebhookCreatedBy", fields: [createdById], references: [id])
  @@index([processId, isEnabled])
}

model SequenceCounter {            // renamed from IdentifierCounter
  id           String   @id
  prefix       String
  scopeKey     String
  year         Int
  currentValue Int      @default(0)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  @@unique([prefix, scopeKey, year])
  @@map("sequence_counter")
}
```

### 2.3 Summary of DB Changes

| Change | Detail |
|---|---|
| **Delete** | `FileBlob` model (content moves to S3) |
| **Rename** | `Job` → `BackgroundJob`, `IdentifierCounter` → `SequenceCounter`, `ComposerNotificationTemplate` → `LetterTheme` |
| **New model** | `TrackingDraft` (extracted from `TrackingEntry.composeDraft`) |
| **Typed** | 10 String columns → enums |
| **Added FK** | `NotificationTemplate.createdById` → User |
| **Added `updatedAt`** | 8 models missing it |
| **Added indexes** | 12 new compound indexes |
| **Removed BYTEA** | 6 columns converted to `s3Key + s3Bucket` |
| **Fixed** | `IssueComment/Correction/Acknowledgment` now FK to `AuditIssue.id` instead of loose `(processId, issueKey)` string |
| **Fixed** | `TrackingStageComment.stage` → `EscalationStage` enum (was String) |

---

## 3. AWS S3 File Storage

### 3.1 S3 Key Convention

```
{env}/{tenantId}/{category}/{uuid}.{ext}

Examples:
  prod/ten_01/workbooks/fil_xyz.xlsx
  prod/ten_01/file-versions/ver_abc.xlsx
  prod/ten_01/file-drafts/dft_def.xlsx
  prod/ten_01/tracking-attachments/att_ghi.pdf
  prod/ten_01/exports/exp_jkl.xlsx
  prod/ten_01/ai-sandbox/snd_mno.xlsx
```

### 3.2 New S3 Service (`apps/api/src/common/services/s3.service.ts`)

```
S3Service
  uploadBuffer(key, buffer, mimeType) → { key, bucket, sizeBytes, sha256 }
  getSignedDownloadUrl(key, expiresIn?) → string
  deleteObject(key) → void
  copyObject(srcKey, destKey) → void
```

### 3.3 Upload Flow (WorkbookFile)

```
Client → POST /files/upload (multipart)
  → UploadValidationPipe (type, size)
  → FilesService.upload()
      → S3Service.uploadBuffer()          ← store in S3
      → prisma.workbookFile.create({ s3Key, s3Bucket, ... })
      → ExcelParserService.parseSheets()  ← parse metadata only
      → prisma.workbookSheet.createMany()
  ← { fileId, name, s3Key, parsedSheets }
```

### 3.4 Download Flow

```
Client → GET /files/:id/download
  → FilesService.getDownloadUrl(fileId)
      → prisma.workbookFile.findUnique()
      → S3Service.getSignedDownloadUrl(s3Key, 300s)
  ← { url: "https://s3.amazonaws.com/...?X-Amz-Expires=300" }
```

### 3.5 Environment Variables to Add

```
AWS_REGION=eu-west-1
AWS_S3_BUCKET=ses-workbooks-prod
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
# or use IAM role on EC2 (preferred for prod)
```

---

## 4. API — Folder Structure & File Breakdown

### 4.1 Full Tree

```
apps/api/src/
│
├── main.ts
├── app.module.ts
│
├── config/                          # all env/config — no env reads elsewhere
│   ├── app.config.ts                # port, throttle
│   ├── auth.config.ts               # JWT secret, cookie options
│   ├── s3.config.ts                 # NEW — S3 bucket, region
│   └── mail.config.ts               # SMTP settings
│
├── common/
│   ├── guards/
│   │   ├── auth.guard.ts
│   │   ├── admin.guard.ts
│   │   └── function-access.guard.ts
│   ├── decorators/
│   │   ├── current-user.decorator.ts
│   │   └── requires-scope.decorator.ts
│   ├── filters/
│   │   └── http-exception.filter.ts
│   ├── pipes/
│   │   └── upload-validation.pipe.ts
│   └── services/
│       ├── prisma.service.ts
│       ├── s3.service.ts            # NEW
│       ├── identifier.service.ts
│       └── activity-log.service.ts
│
├── modules/
│   │
│   ├── auth/                        # ~300 lines total
│   │   ├── auth.module.ts
│   │   ├── auth.controller.ts       # POST /auth/* routes
│   │   ├── auth.service.ts          # login, signup, token verify
│   │   └── session.service.ts       # cookie / JWT helpers
│   │
│   ├── process/                     # split from 725-line service
│   │   ├── process.module.ts
│   │   ├── process.controller.ts    # CRUD routes
│   │   ├── process.service.ts       # create/read/update/delete  <300 lines
│   │   ├── process-policy.service.ts  # policy snapshot, SLA     <250 lines
│   │   ├── process-member.service.ts  # member invites, RBAC     <200 lines
│   │   └── process.repository.ts    # all Prisma queries         <300 lines
│   │
│   ├── files/                       # split from 472-line repo
│   │   ├── files.module.ts
│   │   ├── files.controller.ts      # POST /files/upload, DELETE
│   │   ├── files.service.ts         # orchestration             <300 lines
│   │   ├── files.repository.ts      # Prisma queries            <250 lines
│   │   ├── file-versions.controller.ts
│   │   ├── file-versions.service.ts
│   │   ├── file-drafts.controller.ts
│   │   └── file-drafts.service.ts
│   │
│   ├── audit/                       # split from 874-line service
│   │   ├── audit.module.ts
│   │   ├── audit.controller.ts
│   │   ├── audit-runner.service.ts    # trigger, job, AuditRun row  <300 lines
│   │   ├── audit-results.service.ts   # issue fetch, summary         <350 lines
│   │   ├── audit-analytics.service.ts # KPI aggregation              <250 lines
│   │   └── audit.repository.ts        # Prisma queries               <300 lines
│   │
│   ├── rules/
│   │   ├── rules.module.ts
│   │   ├── rules.controller.ts
│   │   └── rules.service.ts           # <300 lines
│   │
│   ├── issues/
│   │   ├── issues.module.ts
│   │   ├── issues.controller.ts
│   │   ├── issues.service.ts          # comment/correction/ack   <300 lines
│   │   └── issues.repository.ts
│   │
│   ├── directory/                   # split from 826-line service
│   │   ├── directory.module.ts
│   │   ├── directory.controller.ts
│   │   ├── directory-import.service.ts  # bulk import, upsert    <300 lines
│   │   ├── directory-merge.service.ts   # alias / merge detect   <300 lines
│   │   ├── directory-query.service.ts   # list, search           <200 lines
│   │   └── directory.repository.ts      # Prisma queries         <250 lines
│   │
│   ├── tracking/
│   │   ├── tracking.module.ts
│   │   ├── tracking.controller.ts
│   │   ├── tracking.service.ts          # entry CRUD             <300 lines
│   │   ├── tracking-stage.controller.ts
│   │   ├── tracking-stage.service.ts    # state machine          <250 lines
│   │   ├── tracking-bulk.controller.ts
│   │   ├── tracking-bulk.service.ts     # bulk operations        <200 lines
│   │   ├── tracking-attachments.controller.ts
│   │   ├── tracking-attachments.service.ts  # S3 upload/delete   <200 lines
│   │   └── tracking.repository.ts           # Prisma queries     <300 lines
│   │
│   ├── compose/                     # split from 690-line service
│   │   ├── compose.module.ts
│   │   ├── compose.controller.ts
│   │   ├── compose-draft.service.ts     # save/load TrackingDraft  <250 lines
│   │   ├── compose-render.service.ts    # template substitution    <250 lines
│   │   └── compose-send.service.ts      # outbound delivery        <200 lines
│   │
│   ├── notifications/
│   │   ├── notifications.module.ts
│   │   ├── notifications.controller.ts
│   │   ├── in-app-notifications.controller.ts
│   │   └── notifications.service.ts     # <250 lines
│   │
│   ├── escalation-templates/
│   │   ├── escalation-templates.module.ts
│   │   ├── escalation-templates.controller.ts
│   │   └── escalation-templates.service.ts  # <200 lines
│   │
│   ├── versions/
│   │   ├── versions.module.ts
│   │   ├── versions.controller.ts
│   │   └── versions.service.ts      # <200 lines
│   │
│   ├── exports/
│   │   ├── exports.module.ts
│   │   ├── exports.controller.ts
│   │   └── exports.service.ts       # generates xlsx/csv, uploads to S3  <300 lines
│   │
│   ├── activity/
│   │   ├── activity.module.ts
│   │   ├── activity.controller.ts
│   │   └── process-activity.controller.ts
│   │
│   ├── signed-links/
│   │   ├── signed-links.module.ts
│   │   ├── signed-links.controller.ts
│   │   ├── public-response.controller.ts
│   │   └── signed-links.service.ts  # <250 lines
│   │
│   ├── ai-pilot/                    # split from 496-line service
│   │   ├── ai-pilot.module.ts
│   │   ├── ai-pilot.controller.ts
│   │   ├── ai-pilot-rules.service.ts    # rule CRUD              <200 lines
│   │   ├── ai-pilot-generate.service.ts # LLM calls, prompt      <250 lines
│   │   ├── ai-pilot-sandbox.service.ts  # sandbox sessions, S3   <200 lines
│   │   └── ai-client.service.ts         # HTTP to LLM            <150 lines
│   │
│   ├── realtime/
│   │   ├── realtime.module.ts
│   │   ├── realtime.gateway.ts      # Socket.IO             <300 lines
│   │   └── presence.registry.ts     # <200 lines
│   │
│   └── jobs/
│       ├── jobs.module.ts
│       └── jobs.controller.ts
│
└── dto/                             # shared DTOs — one file per domain
    ├── auth.dto.ts
    ├── process.dto.ts
    ├── file.dto.ts
    ├── audit.dto.ts
    ├── tracking.dto.ts
    └── directory.dto.ts
```

---

## 5. UI — Feature-Based Structure & File Breakdown

### 5.1 Full Tree

```
apps/web/src/
│
├── main.tsx
├── App.tsx                          # router setup only
│
├── config/
│   └── env.ts                       # all import.meta.env reads here
│
├── lib/
│   ├── api/                         # one file per API module
│   │   ├── client.ts                # axios base, interceptors
│   │   ├── processes.api.ts
│   │   ├── files.api.ts
│   │   ├── file-versions.api.ts
│   │   ├── file-drafts.api.ts
│   │   ├── audits.api.ts
│   │   ├── tracking.api.ts
│   │   ├── issues.api.ts
│   │   ├── directory.api.ts
│   │   ├── notifications.api.ts
│   │   ├── signed-links.api.ts
│   │   └── ai-pilot.api.ts
│   └── utils/
│       ├── id.ts
│       ├── date.ts
│       └── excel.ts
│
├── store/                           # Zustand — split from 1380-line file
│   ├── index.ts                     # combines all slices
│   ├── types.ts                     # shared store types
│   └── slices/
│       ├── process.slice.ts         # process list, active process   <200 lines
│       ├── workspace.slice.ts       # active file, tab, sheet        <200 lines
│       ├── audit.slice.ts           # runs, issues, run state        <200 lines
│       ├── tracking.slice.ts        # entries, stage changes         <200 lines
│       ├── notification.slice.ts    # drafts, compose state          <180 lines
│       ├── file.slice.ts            # file list, upload, draft       <180 lines
│       └── ui.slice.ts              # sidebar, modals, panel state   <150 lines
│
├── hooks/
│   ├── useProcess.ts
│   ├── useWorkspace.ts
│   ├── useAudit.ts
│   ├── useTracking.ts
│   ├── useEffectiveAccess.ts
│   ├── useKeyboardShortcut.ts
│   ├── useDebouncedValue.ts
│   ├── useCoalescedInvalidator.ts
│   └── useAutosaveOnLeave.ts
│
├── realtime/
│   ├── socket.ts
│   ├── useRealtime.ts
│   └── types.ts
│
├── pages/                           # route shells only — no data logic, <200 lines each
│   ├── Login.tsx
│   ├── Signup.tsx
│   ├── Dashboard.tsx
│   ├── Workspace.tsx                # renders WorkspaceShell + passes params
│   ├── EscalationCenter.tsx         # renders EscalationShell + passes params
│   ├── VersionCompare.tsx           # renders VersionCompareShell
│   ├── AiPilotShell.tsx
│   ├── AdminDirectory.tsx
│   ├── EscalationTemplateAdmin.tsx
│   └── ManagerResponse.tsx
│
└── ui/                              # all components — feature-based
    │
    ├── primitives/                  # design-system atoms (no business logic)
    │   ├── Button.tsx
    │   ├── Modal.tsx
    │   ├── Badge.tsx
    │   ├── StatusBadge.tsx
    │   ├── MetricCard.tsx
    │   ├── EmptyState.tsx
    │   ├── ProgressBar.tsx
    │   ├── Skeleton.tsx
    │   ├── SplitButton.tsx
    │   ├── ConfirmProvider.tsx
    │   └── ErrorBoundary.tsx
    │
    ├── layout/                      # app shell, nav — no feature logic
    │   ├── AppShell.tsx
    │   ├── TopBar.tsx               # DELETE Legacy + New variants — keep one
    │   ├── AvatarMenu.tsx
    │   ├── NotificationBell.tsx
    │   ├── Breadcrumb.tsx
    │   └── RealtimeStatusPill.tsx
    │
    ├── auth/
    │   ├── AuthGate.tsx
    │   └── AdminRoute.tsx
    │
    ├── features/
    │   │
    │   ├── dashboard/               # process tiles, schedule
    │   │   ├── ProcessCard.tsx      # <300 lines
    │   │   ├── CreateProcessModal.tsx
    │   │   ├── AuditSchedule.tsx
    │   │   └── CompareProcesses.tsx
    │   │
    │   ├── workspace/               # file/audit workspace
    │   │   ├── WorkspaceShell.tsx   # tab container + data loader  <300 lines
    │   │   ├── FilesSidebar.tsx
    │   │   ├── SheetList.tsx
    │   │   ├── DraftRestoreBanner.tsx
    │   │   ├── UnsavedAuditDialog.tsx
    │   │   ├── members/             # SPLIT from MembersPanel (525 lines)
    │   │   │   ├── MembersPanel.tsx      # shell — <200 lines
    │   │   │   ├── MembersList.tsx       # table + role pills
    │   │   │   └── AddMemberForm.tsx     # invite form
    │   │   └── tabs/
    │   │       ├── PreviewTab.tsx
    │   │       ├── AnalyticsTab.tsx
    │   │       ├── VersionHistoryTab.tsx
    │   │       ├── SendLogPanel.tsx
    │   │       ├── TemplateEditor.tsx
    │   │       ├── NotificationsTab.tsx
    │   │       ├── TrackingTab.tsx
    │   │       └── audit-results/        # SPLIT from AuditResultsTab (975 lines)
    │   │           ├── AuditResultsTab.tsx     # orchestrator    <300 lines
    │   │           ├── AuditIssueTable.tsx     # virtualised table + columns
    │   │           ├── AuditFilterBar.tsx      # filter controls
    │   │           └── AuditSummaryStrip.tsx   # KPI header row
    │   │
    │   ├── escalation/              # manager escalation tracking
    │   │   ├── EscalationShell.tsx  # data loader + layout        <300 lines
    │   │   ├── EscalationPanel.tsx
    │   │   ├── EscalationFilters.tsx
    │   │   ├── EscalationSummaryBar.tsx
    │   │   ├── SavedViewsRail.tsx
    │   │   ├── StageGraph.tsx
    │   │   ├── TrackingTimeline.tsx
    │   │   ├── ActivityFeed.tsx
    │   │   ├── AttachmentsTab.tsx
    │   │   ├── FindingsTab.tsx
    │   │   ├── AnalyticsStrip.tsx
    │   │   ├── ShortcutOverlay.tsx
    │   │   ├── manager-table/
    │   │   │   ├── ManagerTable.tsx          # <300 lines
    │   │   │   └── ManagerTableRow.tsx
    │   │   ├── compose/             # SPLIT from Composer (648 lines)
    │   │   │   ├── Composer.tsx              # modal shell + step state  <200 lines
    │   │   │   ├── ComposerLetterEditor.tsx  # rich text editor
    │   │   │   ├── ComposerSendBar.tsx       # channel + send controls
    │   │   │   └── ComposerRecipientList.tsx # manager selection
    │   │   ├── BulkComposer.tsx
    │   │   └── broadcast/           # SPLIT from BroadcastDialog (434 lines)
    │   │       ├── BroadcastDialog.tsx           # modal shell  <200 lines
    │   │       └── BroadcastRecipientPicker.tsx
    │   │
    │   ├── version-compare/         # SPLIT from VersionCompare (664 lines)
    │   │   ├── VersionCompareShell.tsx    # page data loader   <200 lines
    │   │   ├── VersionDiffEngine.tsx      # diff computation   <300 lines
    │   │   └── VersionDiffTable.tsx       # diff table render  <300 lines
    │   │
    │   ├── directory/
    │   │   ├── DirectoryTable.tsx
    │   │   ├── DirectoryUploadWizard.tsx
    │   │   ├── AddManagerForm.tsx
    │   │   ├── PasteFromExcel.tsx
    │   │   ├── ResolutionDrawer.tsx
    │   │   └── DeleteManagerButton.tsx
    │   │
    │   ├── ai-pilot/
    │   │   ├── AllRulesPane.tsx
    │   │   ├── PromptEnhancer.tsx
    │   │   ├── WelcomeModal.tsx
    │   │   ├── AiBadge.tsx
    │   │   ├── EscalationLitePreview.tsx
    │   │   ├── PromptExamplesPanel.tsx
    │   │   └── sandbox/             # SPLIT from SandboxModal (641 lines)
    │   │       ├── SandboxModal.tsx         # shell + step router  <150 lines
    │   │       ├── SandboxUploadStep.tsx    # drag-drop upload
    │   │       ├── SandboxResultsView.tsx   # issue list + summary
    │   │       └── SandboxRulePreview.tsx   # rule JSON viewer
    │   │
    │   └── notifications/
    │       ├── BroadcastComposer.tsx
    │       ├── PerManagerDrafts.tsx
    │       ├── DraftCard.tsx
    │       └── NotificationPreview.tsx
```

### 5.2 Store Slice Breakdown

Each slice is `<= 200 lines`. They share a `StoreState` type from `store/types.ts` and are composed via Zustand's `combine`.

| Slice | State it owns |
|---|---|
| `process.slice.ts` | `processes[]`, `activeProcessId`, process CRUD actions |
| `workspace.slice.ts` | `activeFileId`, `activeTab`, `selectedSheetId`, `activeVersionId` |
| `audit.slice.ts` | `currentRun`, `issues[]`, `runState`, `auditCancel` |
| `tracking.slice.ts` | `trackingEntries[]`, `activeTrackingId`, stage actions |
| `notification.slice.ts` | `drafts{}`, `composeState`, notification actions |
| `file.slice.ts` | `files[]`, `uploadProgress`, `draftFileId` |
| `ui.slice.ts` | `sidebarCollapsed`, `openModals[]`, `panelState` |

### 5.3 Files to Delete

- `apps/web/src/components/layout/TopBarLegacy.tsx`
- `apps/web/src/components/layout/TopBarNew.tsx`
- `apps/web/src/pages/Debug.tsx` (or gate behind `NODE_ENV === 'development'`)

---

## 6. Domain Package

```
packages/domain/src/
│
├── types/                           # SPLIT from types.ts (437 lines)
│   ├── audit.types.ts               # AuditRun, AuditIssue, AuditSummary
│   ├── tracking.types.ts            # TrackingEntry, TrackingEvent, EscalationStage
│   ├── notification.types.ts        # Notification, NotificationLog, Template
│   ├── process.types.ts             # Process, SystemFunction, ProcessFunction
│   └── shared.types.ts             # utility types, common enums
│
├── audit/
│   ├── engine.ts                    # orchestrator         <400 lines
│   ├── rules.ts                     # rule definitions
│   ├── policy.ts                    # policy management
│   ├── findings.ts                  # findings aggregation
│   └── severity.ts
│
├── functions-audit/                 # 5 audit plugins — keep as-is
│   ├── master-data/
│   ├── function-rate/
│   ├── internal-cost-rate/
│   ├── missing-plan/
│   ├── opportunities/
│   └── over-planning/
│
├── ai-pilot/                        # keep as-is
│
├── escalations/
│   ├── state-machine.ts
│   ├── stages.ts
│   └── aggregator.ts
│
├── directory/
│   └── manager.ts
│
├── notifications/
│   ├── builder.ts
│   └── template.ts
│
├── workbook/
│   └── parser.ts
│
├── schedule/
│   └── helpers.ts
│
├── analytics/
│   └── manager-analytics.ts
│
└── id.ts
```

---

## 7. Migration Phases

Work in this order. Each phase keeps tests green before moving on.

### Phase 1 — Database (no app code changes yet)
- [ ] Add all new enums to schema.prisma
- [ ] Add `SequenceCounter` (rename `IdentifierCounter`)
- [ ] Add `BackgroundJob` (rename `Job`)
- [ ] Add `LetterTheme` (rename `ComposerNotificationTemplate`)
- [ ] Add `TrackingDraft` model
- [ ] Add `updatedAt` to 8 models
- [ ] Add all new `@@index` blocks
- [ ] Fix `NotificationTemplate.createdBy` as proper FK
- [ ] Run `prisma migrate dev` and verify
- [ ] Update seed.ts for renamed models

### Phase 2 — S3 Integration
- [ ] Add `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`
- [ ] Implement `S3Service` in `common/services/s3.service.ts`
- [ ] Add `s3.config.ts` + env vars
- [ ] Write migration script: read each `FileBlob.content` → upload to S3 → write `s3Key` to `WorkbookFile`
- [ ] Migrate `FileVersion.content` → S3
- [ ] Migrate `FileDraft.content` → S3
- [ ] Migrate `TrackingAttachment.content` → S3
- [ ] Migrate `Export.content` → S3
- [ ] Migrate `AiPilotSandboxSession.fileBytes` → S3
- [ ] Drop `FileBlob` model after data confirmed in S3
- [ ] Drop all BYTEA columns after migration verified

### Phase 3 — API restructure
- [ ] Create `config/` folder; centralise all `process.env` reads
- [ ] Add repository layer for: process, files, audit, directory, tracking, issues
- [ ] Split `audits.service.ts` → 3 services
- [ ] Split `directory.service.ts` → 3 services
- [ ] Split `processes.service.ts` → 3 services
- [ ] Split `tracking-compose.service.ts` → 3 services
- [ ] Split `ai-pilot.service.ts` → 3 services
- [ ] Ensure all 17 backend tests pass

### Phase 4 — Domain package
- [ ] Split `types.ts` → 5 typed files in `types/`
- [ ] Reorganise domain src into feature folders
- [ ] Update all import paths in api + web
- [ ] Ensure all 20 domain tests pass

### Phase 5 — UI store
- [ ] Define `StoreState` in `store/types.ts`
- [ ] Implement 7 Zustand slices
- [ ] Replace all `useAppStore` imports with slice hooks
- [ ] Verify no unneeded re-renders (React Scan or Profiler)

### Phase 6 — UI components
- [ ] Rename `apps/web/src/components/` → `apps/web/src/ui/`
- [ ] Create `ui/features/` and move feature components in
- [ ] Split `AuditResultsTab.tsx` → 4 files
- [ ] Split `Composer.tsx` → 4 files
- [ ] Split `SandboxModal.tsx` → 4 files
- [ ] Split `MembersPanel.tsx` → `MembersList` + `AddMemberForm`
- [ ] Extract `VersionDiffEngine` from `VersionCompare`
- [ ] Create `EscalationShell` data-loader; thin `EscalationCenter` page
- [ ] Delete `TopBarLegacy.tsx`, `TopBarNew.tsx`
- [ ] Delete or guard `Debug.tsx`

### Phase 7 — Verification
- [ ] `find apps packages -name '*.ts' -o -name '*.tsx' | xargs wc -l | sort -n | tail -30` — confirm no file > 600 lines
- [ ] All 58 test files pass
- [ ] `tsc --noEmit` clean across all packages
- [ ] `docker compose -f docker-compose.prod.yml build` succeeds
- [ ] Manual smoke-test: upload → audit → escalate → notify → resolve
