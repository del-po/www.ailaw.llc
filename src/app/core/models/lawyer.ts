import { ChatMessage } from './chat';

// Lawyers (Firestore → Staff), as the lawyer and admin doors return them

export type LawyerStatus = 'applied' | 'approved' | 'active' | 'suspended' | 'left';

// One application on the admin Lawyers page
export interface AdminLawyer {
  lawyerId: string; // LW-XXXXXX
  status: LawyerStatus;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  barLicenseNumber: string;
  licensedSince: string; // yyyy-mm
  specializations: string;
  languages: string;
  bio: string;
  folderUrl: string; // their documents (Firebase console → Storage)
  appliedAt: string; // ISO date
  verifiedAt: string;
  hasLogin: boolean;
}

// The signed-in lawyer, for the Workspace
export interface StaffMe {
  lawyerId: string;
  firstName: string;
  lastName: string;
  email: string;
  status: LawyerStatus;
}

export type AssignmentStatus = 'assigned' | 'in_progress' | 'done';

// One of the lawyer's assignments (Firestore → Orders → Assignments)
export interface Assignment {
  assignmentId: string; // AS-XXXXXXXX
  orderNumber: string; // AIL-…
  service: string;
  client: string;
  role: 'lead' | 'reviewer';
  status: AssignmentStatus;
  tasks: string; // one per line
  fee: number | null;
  currency: string;
  assignedAt: string; // ISO date
  completedAt: string;
  orderStatus: string;
  paymentStatus: string;
}

// ---------- One case, opened in the Workspace ----------

export interface CaseFile {
  path: string; // inside the order's folder
  name: string;
  type: string;
  size: number;
  updatedAt: string;
}

// The client's files, then each lawyer's working folder
export interface CaseFolder {
  title: string;
  files: CaseFile[];
}

export interface CaseStep {
  label: string;
  owner: string; // chat | lawyer
  status: 'waiting' | 'active' | 'done';
  task: string;
}

export interface CaseView {
  assignment: Assignment;
  details: Record<string, string | number>;
  notes: string;
  items: { name: string; quantity: number }[];
  steps: CaseStep[];
  documents: CaseFolder[];
  chat: { id: string; messages: ChatMessage[] };
}

// ---------- The lawyer's own profile ----------

export interface LawyerProfile {
  lawyerId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  barLicenseNumber: string;
  specializations: string; // comma-separated
  languages: string;
  availability: string;
  bio: string;
  iban: string; // only the last four characters, e.g. "•••• 1234"
  status: LawyerStatus;
  verifiedAt: string;
}

export interface Earnings {
  earned: number; // finished assignments
  pending: number; // open ones
  currency: string;
  rows: {
    assignmentId: string;
    orderNumber: string;
    service: string;
    fee: number;
    currency: string;
    status: AssignmentStatus;
    completedAt: string;
  }[];
}
