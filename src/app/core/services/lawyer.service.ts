import { Service, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { DOORS, DoorResult } from './doors';

// An uploaded document, its content in base64
export interface UploadFile {
  name: string;
  type: string;
  data: string;
}

export interface LawyerApplication {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  personalId: string;
  address: string;
  barLicenseNumber: string;
  licensedSince: string;
  specializations: string;
  languages: string;
  bio: string;
  iban: string;
  consentData: boolean;
  consentTruth: boolean;
  website: string; // stays empty: a trap for bots
  files: {
    idDocument: UploadFile;
    barLicense: UploadFile;
    cv?: UploadFile;
    photo?: UploadFile;
  };
}

// Error codes from the API, e.g. ALREADY_APPLIED, are kept as the message
export class LawyerApiError extends Error {}

@Service()
export class LawyerService {
  private readonly http = inject(HttpClient);

  // Public: no account needed to apply
  apply(data: LawyerApplication): Observable<{ received: boolean; lawyerId?: string }> {
    return this.post({ action: 'apply', data });
  }

  private post<T>(body: object): Observable<T> {
    return this.http
      .post<DoorResult<T>>(DOORS.lawyer, body)
      .pipe(
        map((result) => {
          if (!result.ok) throw new LawyerApiError(result.error);
          return result.data;
        }),
      );
  }
}
