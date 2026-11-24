import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { LawyerApplication, LawyerService, UploadFile } from '../../../core/services/lawyer.service';
import { Header } from '../../../shared/components/header/header';
import { Footer } from '../../../shared/components/footer/footer';
import { Shape } from '../../../shared/kit/shapes/shape';

const MAX_FILE_MB = 5;
const FILE_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

// Error codes from the Lawyers API → messages the applicant can act on
const MESSAGES: Record<string, string> = {
  ALREADY_APPLIED: 'We already have an application with this email. We will contact you.',
  CONSENT_REQUIRED: 'Please tick both boxes at the end of the form.',
  MISSING_FIELDS: 'Please fill in all required fields.',
  MISSING_FILES: 'Please upload your ID document and your bar license.',
  INVALID_NAME: 'Please write your name in English letters.',
  INVALID_EMAIL: 'This email address is not valid.',
  INVALID_IBAN: 'This IBAN does not look right. Check it and try again.',
  INVALID_TEXT: 'Some details are too long or contain invalid characters.',
  INVALID_FILE_TYPE: 'Documents must be PDF, JPG or PNG files.',
  INVALID_FILE: 'One of the files could not be read. Try another copy.',
  FILE_TOO_LARGE: `Each file can be at most ${MAX_FILE_MB} MB.`,
};

// "Join as a lawyer": a short pitch and the application form. No account is
// made here; approved lawyers are invited to set up their login later.
@Component({
  selector: 'app-lawyer-apply-page',
  imports: [RouterLink, Header, Footer, Shape],
  templateUrl: './lawyer-apply-page.html',
  styleUrl: './lawyer-apply-page.scss',
})
export class LawyerApplyPage {
  private readonly lawyers = inject(LawyerService);

  protected readonly maxFileMb = MAX_FILE_MB;
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly sent = signal(false);

  protected async submit(event: Event, form: HTMLFormElement): Promise<void> {
    event.preventDefault();
    const text = (name: string) =>
      (form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement).value.trim();
    const checked = (name: string) => (form.elements.namedItem(name) as HTMLInputElement).checked;
    const file = (name: string) => (form.elements.namedItem(name) as HTMLInputElement).files?.[0];

    this.error.set(null);

    // Checked here too, so nobody waits for a large upload that will be refused
    const uploads = { idDocument: file('idDocument'), barLicense: file('barLicense'), cv: file('cv'), photo: file('photo') };
    for (const f of Object.values(uploads)) {
      if (!f) continue;
      if (!FILE_TYPES.includes(f.type)) return this.error.set(MESSAGES['INVALID_FILE_TYPE']);
      if (f.size > MAX_FILE_MB * 1024 * 1024) return this.error.set(MESSAGES['FILE_TOO_LARGE']);
    }
    if (!uploads.idDocument || !uploads.barLicense) return this.error.set(MESSAGES['MISSING_FILES']);

    this.busy.set(true);
    try {
      const application: LawyerApplication = {
        firstName: text('firstName'),
        lastName: text('lastName'),
        email: text('email'),
        phone: text('phone'),
        personalId: text('personalId'),
        address: text('address'),
        barLicenseNumber: text('barLicenseNumber'),
        licensedSince: text('licensedSince'),
        specializations: text('specializations'),
        languages: text('languages'),
        bio: text('bio'),
        iban: text('iban'),
        consentData: checked('consentData'),
        consentTruth: checked('consentTruth'),
        website: text('website'),
        files: {
          idDocument: await toUpload(uploads.idDocument),
          barLicense: await toUpload(uploads.barLicense),
          ...(uploads.cv ? { cv: await toUpload(uploads.cv) } : {}),
          ...(uploads.photo ? { photo: await toUpload(uploads.photo) } : {}),
        },
      };
      await firstValueFrom(this.lawyers.apply(application));
      this.sent.set(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      const code = (error as Error)?.message ?? '';
      this.error.set(MESSAGES[code] ?? 'Something went wrong. Please try again.');
    } finally {
      this.busy.set(false);
    }
  }
}

// File → { name, type, data } with the content in base64
function toUpload(file: File): Promise<UploadFile> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      resolve({ name: file.name, type: file.type, data: url.slice(url.indexOf(',') + 1) });
    };
    reader.onerror = () => reject(new Error('INVALID_FILE'));
    reader.readAsDataURL(file);
  });
}
