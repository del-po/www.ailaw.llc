// A row of the Users sheet, as the Profiles API returns it

export interface Profile {
  UserID: string;
  FirstName: string;
  LastName: string;
  DisplayName: string;
  Email: string;
  Phone: string;
  Role: 'client' | 'staff' | 'admin';
  Status: 'active' | 'suspended';
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
