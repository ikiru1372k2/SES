/**
 * Local type-only namespace consumed by repositories and services.
 * No Prisma. The runtime data layer is hand-written `pg` under
 * `apps/api/src/repositories/pg-data-client.ts`. `Prisma.<X>` aliases
 * here are deliberately permissive (`Record<string, any>`) — the SQL
 * compiler validates argument shapes at runtime.
 *
 * The `Prisma` namespace name is preserved as a stable import surface
 * during the rolling migration of services off the Prisma-shape API; it
 * is a label, not a dependency.
 */

import type { PgDataClient } from './pg-data-client';

export type EscalationStage =
  | 'NEW'
  | 'DRAFTED'
  | 'SENT'
  | 'AWAITING_RESPONSE'
  | 'RESPONDED'
  | 'NO_RESPONSE'
  | 'ESCALATED_L1'
  | 'ESCALATED_L2'
  | 'RESOLVED';

export const EscalationStage = {
  NEW: 'NEW' as EscalationStage,
  DRAFTED: 'DRAFTED' as EscalationStage,
  SENT: 'SENT' as EscalationStage,
  AWAITING_RESPONSE: 'AWAITING_RESPONSE' as EscalationStage,
  RESPONDED: 'RESPONDED' as EscalationStage,
  NO_RESPONSE: 'NO_RESPONSE' as EscalationStage,
  ESCALATED_L1: 'ESCALATED_L1' as EscalationStage,
  ESCALATED_L2: 'ESCALATED_L2' as EscalationStage,
  RESOLVED: 'RESOLVED' as EscalationStage,
} as const;

/**
 * Backwards-compatible alias. New code should import `PgDataClient`
 * directly. Existing services keep `PrismaClient` working until the
 * rolling rename completes.
 */
export type PrismaClient = PgDataClient;
export type DataClient = PgDataClient;

export namespace Prisma {
  export type TransactionClient = PgDataClient;
  // Permissive aliases for every Prisma.<X>WhereInput / UpdateInput /
  // CreateInput / OrderByInput etc. used across the service layer. The
  // catch-all index signature handles names we haven't enumerated.
  export type ProcessWhereInput = Record<string, any>;
  export type WorkbookFileWhereInput = Record<string, any>;
  export type TrackingEntryWhereInput = Record<string, any>;
  export type AuditIssueWhereInput = Record<string, any>;
  export type ManagerDirectoryWhereInput = Record<string, any>;
  export type ProcessMemberWhereInput = Record<string, any>;
  export type ProcessMemberScopePermissionWhereInput = Record<string, any>;
  export type AiPilotSandboxSessionWhereInput = Record<string, any>;
  export type AuditRuleWhereInput = Record<string, any>;
  export type AuditRunWhereInput = Record<string, any>;
  export type IssueCommentWhereInput = Record<string, any>;
  export type ExportWhereInput = Record<string, any>;
  export type JobWhereInput = Record<string, any>;
  export type UserWhereInput = Record<string, any>;
  export type TenantWhereInput = Record<string, any>;
  export type ProcessFunctionWhereInput = Record<string, any>;
  export type SystemFunctionWhereInput = Record<string, any>;
  export type ActivityLogWhereInput = Record<string, any>;
  export type NotificationTemplateWhereInput = Record<string, any>;
  export type NotificationLogWhereInput = Record<string, any>;
  export type TrackingEventWhereInput = Record<string, any>;
  export type TrackingStageCommentWhereInput = Record<string, any>;
  export type TrackingAttachmentWhereInput = Record<string, any>;
  export type ComposerNotificationTemplateWhereInput = Record<string, any>;
  export type IssueCorrectionWhereInput = Record<string, any>;
  export type IssueAcknowledgmentWhereInput = Record<string, any>;
  export type SignedLinkWhereInput = Record<string, any>;
  export type FileVersionWhereInput = Record<string, any>;
  export type FileDraftWhereInput = Record<string, any>;
  export type WorkbookSheetWhereInput = Record<string, any>;
  export type SavedVersionWhereInput = Record<string, any>;
  export type UserPreferenceWhereInput = Record<string, any>;
  export type AiPilotRuleMetaWhereInput = Record<string, any>;
  export type AiPilotAuditLogWhereInput = Record<string, any>;
  export type FileBlobWhereInput = Record<string, any>;
  export type FunctionAuditRequestWhereInput = Record<string, any>;
  export type IdentifierCounterWhereInput = Record<string, any>;
  export type NotificationWhereInput = Record<string, any>;
  export type ApiTokenWhereInput = Record<string, any>;
  export type WebhookEndpointWhereInput = Record<string, any>;
  export type LiveSessionWhereInput = Record<string, any>;

  export type ProcessSelect = Record<string, any>;
  export type UserSelect = Record<string, any>;
  export type WorkbookFileSelect = Record<string, any>;
  export type TrackingEntrySelect = Record<string, any>;
  export type AuditIssueSelect = Record<string, any>;
  export type AuditRunSelect = Record<string, any>;
  export type FileVersionSelect = Record<string, any>;
  export type JobSelect = Record<string, any>;
  export type ExportSelect = Record<string, any>;
  export type AuditRuleSelect = Record<string, any>;
  export type ManagerDirectorySelect = Record<string, any>;
  export type ProcessMemberSelect = Record<string, any>;
  export type SavedVersionSelect = Record<string, any>;
  export type ActivityLogSelect = Record<string, any>;
  export type NotificationLogSelect = Record<string, any>;
  export type SignedLinkSelect = Record<string, any>;
  export type IssueCommentSelect = Record<string, any>;
  export type TenantSelect = Record<string, any>;

  export type ProcessUpdateInput = Record<string, any>;
  export type WorkbookFileUpdateInput = Record<string, any>;
  export type TrackingEntryUpdateInput = Record<string, any>;
  export type AuditIssueUpdateInput = Record<string, any>;
  export type ManagerDirectoryUpdateInput = Record<string, any>;
  export type ProcessMemberUpdateInput = Record<string, any>;
  export type AuditRuleUpdateInput = Record<string, any>;
  export type AuditRunUpdateInput = Record<string, any>;
  export type IssueCommentUpdateInput = Record<string, any>;

  export type ProcessCreateInput = Record<string, any>;
  export type WorkbookFileCreateInput = Record<string, any>;
  export type TrackingEntryCreateInput = Record<string, any>;
  export type AuditIssueCreateInput = Record<string, any>;
  export type ManagerDirectoryCreateInput = Record<string, any>;
  export type ProcessMemberCreateInput = Record<string, any>;
  export type AuditRuleCreateInput = Record<string, any>;
  export type AuditRunCreateInput = Record<string, any>;
  export type IssueCommentCreateInput = Record<string, any>;

  export type InputJsonValue = any;
  export type JsonValue = any;
  export type JsonObject = Record<string, any>;
}
