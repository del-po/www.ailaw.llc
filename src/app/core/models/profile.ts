// A client record (Firestore → Clients), as the backend returns it

export type ClientType = 'user' | 'verified' | 'guest';

export interface Profile {
  ClientID: string; // ID-XXXXXX
  Type: ClientType;
  UserID: string; // '' for guests and verified clients without an account
  FirstName: string;
  LastName: string;
  DisplayName: string;
  Email: string;
  Phone: string;
  Passport: string;
  IDNumber: string;
  Address: string;
  Notes: string;
  Role: 'client' | 'staff' | 'admin';
  Status: 'active' | 'suspended' | 'deleted';
  Providers: string; // comma-separated, e.g. "password,google.com"
  EmailVerified: boolean;
  PhotoURL: string;
  CreatedAt: string; // ISO date
  UpdatedAt: string;
  LastLoginAt: string;
}

// Fields the signed-in person may change
export interface ProfileUpdate {
  firstName?: string;
  lastName?: string;
  displayName?: string;
  phone?: string;
}
