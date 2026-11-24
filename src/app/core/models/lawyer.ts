// Lawyers sheet (Drive → Staff → Lawyers), as the chat function returns it

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
  folderUrl: string; // their documents in Drive
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

// One of the lawyer's assignments (Orders Database → Assignments)
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
