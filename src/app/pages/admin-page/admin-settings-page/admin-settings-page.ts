import { Component, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { AdminService } from '../../../core/services/admin.service';
import { CompanyDetails, SystemChanges, SystemSettings } from '../../../core/models/admin';
import { Shape } from '../../../shared/kit/shapes/shape';
import { adminErrorMessage } from '../admin-links';

const COMPANY_FIELDS: { key: keyof CompanyDetails; label: string }[] = [
  { key: 'name', label: 'Company name' },
  { key: 'registration', label: 'Registration number' },
  { key: 'address', label: 'Address' },
  { key: 'phone', label: 'Phone' },
  { key: 'email', label: 'Email · emails go out from it' },
  { key: 'website', label: 'Website' },
  { key: 'signatory', label: 'Signs the agreements' },
  { key: 'verifyContact', label: 'Who clients contact to get verified' },
  { key: 'applicationsEmail', label: 'New lawyer applications go to' },
];

// System Settings: the company's details on agreements and emails, bank
// details, notification emails, the switch for new orders, which
// integrations are connected, and who has access
@Component({
  selector: 'app-admin-settings-page',
  imports: [Shape],
  templateUrl: './admin-settings-page.html',
  styleUrl: './admin-settings-page.scss',
})
export class AdminSettingsPage {
  private readonly admin = inject(AdminService);

  protected readonly companyFields = COMPANY_FIELDS;
  protected readonly data = signal<SystemSettings | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly busy = signal(false);

  constructor() {
    if (isPlatformBrowser(inject(PLATFORM_ID))) this.load();
  }

  private async load(): Promise<void> {
    try {
      this.data.set(await this.admin.systemSettings());
    } catch (error) {
      this.error.set(adminErrorMessage(error));
    }
  }

  private async save(changes: SystemChanges, done: string): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    this.notice.set(null);
    try {
      this.data.set(await this.admin.saveSystemSettings(changes));
      this.notice.set(done);
    } catch (error) {
      this.error.set(adminErrorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  private fields(form: HTMLFormElement, keys: string[]): Record<string, string> {
    return Object.fromEntries(
      keys.map((k) => [k, (form.elements.namedItem(k) as HTMLInputElement).value.trim()]),
    );
  }

  protected saveCompany(form: HTMLFormElement, event: Event): void {
    event.preventDefault();
    this.save(
      {
        company: this.fields(
          form,
          COMPANY_FIELDS.map((f) => f.key),
        ),
      },
      'Saved. New agreements and emails use these details; an empty field uses the default.',
    );
  }

  protected saveBank(form: HTMLFormElement, event: Event): void {
    event.preventDefault();
    this.save(
      { bank: this.fields(form, ['BankRecipient', 'BankName', 'BankIban']) },
      'Bank details saved. Invoices and payment cards show them from now on.',
    );
  }

  protected saveNotifications(form: HTMLFormElement, event: Event): void {
    event.preventDefault();
    this.save(
      { notifications: this.fields(form, ['lawyerTasksEmail']) },
      'Notification email saved.',
    );
  }

  protected setOrdering(open: boolean, text: string): void {
    if (
      !open &&
      !confirm(
        'Pause new orders? Clients can’t order on the site or in the chat until you open them again.',
      )
    ) {
      return;
    }
    this.save(
      { platform: { orderingOpen: open, orderingPausedText: text.trim() } },
      open ? 'New orders are open.' : 'New orders are paused. You can still place orders here.',
    );
  }
}
