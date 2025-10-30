export enum UserRole {
  TECHNICIAN = 'Técnico',
  MANAGER = 'Gestor',
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  unitId?: string; // For unit managers
  managerId?: string; // For technicians
  active?: boolean; // user enabled/disabled flag
  authUid?: string; // optional Firebase Auth UID
}

export interface Unit {
  id: string;
  name: string;
  managerId: string; // ID of the unit manager
  active?: boolean; // unit enabled/disabled flag
}

export interface ChecklistItemTemplate {
  id: string;
  text: string;
}

export interface ChecklistTemplate {
  id: string;
  name: string;
  items: ChecklistItemTemplate[];
}

export enum ChecklistItemStatus {
  CONFORM = 'Conforme',
  NON_CONFORM = 'Não Conforme',
}

export interface ChecklistItemResult {
  itemId: string;
  status: ChecklistItemStatus | null;
  observation: string;
}

export interface CompletedChecklist {
  id: string;
  templateId: string;
  unitId: string;
  technicianId: string;
  completionDate: string;
  results: ChecklistItemResult[];
  hasNonConformities: boolean;
  // Optional fields added to support manager validation
  validated?: boolean;
  validatedBy?: string; // manager user id
  validatedAt?: string; // ISO date
  managerComment?: string;
}

export interface Notification {
  id: string;
  userId: string; // The user to be notified
  completedChecklistId: string;
  message: string;
  read: boolean;
  timestamp: string;
}

export enum ActionType {
  USER_CREATED = 'Usuário Criado',
  USER_UPDATED = 'Usuário Atualizado',
  UNIT_CREATED = 'Unidade Criada',
  UNIT_UPDATED = 'Unidade Atualizada',
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  performingUserId: string;
  action: ActionType;
  details: string;
}
