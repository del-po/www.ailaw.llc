import { Component, afterNextRender, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { AdminService } from '../../../core/services/admin.service';
import {
  AdminCategory,
  AdminServiceInput,
  AdminServiceRow,
  ServiceStatus,
} from '../../../core/models/admin';
import { Shape } from '../../../shared/kit/shapes/shape';
import { AdminWorkflowEditor } from '../admin-workflow-editor/admin-workflow-editor';
import { readUpload } from '../../../core/services/read-upload';
import { adminErrorMessage } from '../admin-links';
import { CHECKOUT_FIELDS, CheckoutRules, FieldRule } from '../../../core/models/checkout-fields';

const EMPTY: AdminServiceInput = {
  Slug: '',
  Name: '',
  ShortDescription: '',
  Description: '',
  Category: '',
  Image: '',
  Status: 'Draft',
  Currency: 'GEL',
  Price: 0,
  DiscountedPrice: '',
  DiscountStart: '',
  DiscountEnd: '',
  Billing: 'once',
  UnitLabel: '',
  CheckoutFields: {},
};

@Component({
  selector: 'app-admin-services-page',
  imports: [DecimalPipe, Shape, AdminWorkflowEditor],
  templateUrl: './admin-services-page.html',
  styleUrl: './admin-services-page.scss',
})
export class AdminServicesPage {
  private readonly admin = inject(AdminService);

  protected readonly statuses: ServiceStatus[] = ['Active', 'Draft', 'Inactive'];
  protected readonly checkoutFields = CHECKOUT_FIELDS;

  protected readonly services = signal<AdminServiceRow[] | null>(null);
  protected readonly categories = signal<AdminCategory[]>([]);
  protected readonly activeCategories = computed(() =>
    this.categories().filter((c) => c.Status === 'Active'),
  );

  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly busy = signal(false);

  // The service open in the editor: null = closed, ID 0 = new
  // The service whose workflow editor is open
  protected readonly workflowSlug = signal<string | null>(null);
  protected readonly editing = signal<(AdminServiceInput & { ID: number }) | null>(null);

  constructor() {
    afterNextRender(() => this.load());
  }

  protected async load(): Promise<void> {
    this.error.set(null);
    try {
      const [services, categories] = await Promise.all([
        this.admin.listServices(),
        this.admin.listCategories(),
      ]);
      this.services.set(services);
      this.categories.set(categories);
    } catch (error) {
      this.error.set(adminErrorMessage(error));
    }
  }

  // ---------- Service editor ----------

  // One select per field: '' (not asked), optional or required
  private rulesFrom(value: (name: string) => string): CheckoutRules {
    const rules: CheckoutRules = {};
    for (const f of CHECKOUT_FIELDS) {
      const rule = value('field-' + f.key);
      if (rule === 'required' || rule === 'optional') rules[f.key] = rule as FieldRule;
    }
    return rules;
  }

  protected newService(): void {
    this.notice.set(null);
    this.editing.set({ ...EMPTY, ID: 0, Category: this.activeCategories()[0]?.Name ?? '' });
  }

  protected edit(service: AdminServiceRow): void {
    this.notice.set(null);
    this.editing.set({ ...service });
  }

  protected async save(event: Event, form: HTMLFormElement): Promise<void> {
    event.preventDefault();
    const current = this.editing();
    if (!current) return;

    const value = (name: string) =>
      (
        form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      ).value.trim();
    const discounted = value('DiscountedPrice');

    const data: AdminServiceInput = {
      Name: value('Name'),
      Slug: value('Slug'),
      ShortDescription: value('ShortDescription'),
      Description: value('Description'),
      Category: value('Category'),
      Image: value('Image'),
      Status: value('Status') as ServiceStatus,
      Currency: value('Currency') || 'GEL',
      Price: Number(value('Price')),
      DiscountedPrice: discounted === '' ? '' : Number(discounted),
      DiscountStart: value('DiscountStart'),
      DiscountEnd: value('DiscountEnd'),
      Billing: value('Billing') === 'ongoing' ? 'ongoing' : 'once',
      UnitLabel: value('UnitLabel'),
      CheckoutFields: this.rulesFrom(value),
    };

    // A picture chosen in the form is uploaded after the service is saved
    const picture = (form.elements.namedItem('Picture') as HTMLInputElement).files?.[0];

    await this.run(async () => {
      const saved = current.ID
        ? await this.admin.updateService(current.ID, data)
        : await this.admin.createService(data);
      if (picture) await this.admin.uploadServiceImage(saved.ID, await readUpload(picture));
      this.editing.set(null);
      this.notice.set(
        `“${data.Name}” is saved. The public site shows changes within a few minutes.`,
      );
      await this.load();
    });
  }

  protected async archive(service: { ID: number; Name: string }): Promise<void> {
    if (!confirm(`Archive “${service.Name}”? It will be hidden from the site.`)) return;

    await this.run(async () => {
      await this.admin.archiveService(service.ID);
      this.editing.set(null);
      this.notice.set(`“${service.Name}” is archived.`);
      await this.load();
    });
  }

  // ---------- Categories ----------

  protected async addCategory(event: Event, input: HTMLInputElement): Promise<void> {
    event.preventDefault();
    const name = input.value.trim();
    if (!name) return;

    await this.run(async () => {
      await this.admin.createCategory(name);
      input.value = '';
      await this.load();
    });
  }

  protected async renameCategory(category: AdminCategory, name: string): Promise<void> {
    name = name.trim();
    if (!name || name === category.Name) return;

    await this.run(async () => {
      await this.admin.updateCategory(category.ID, { Name: name });
      this.notice.set(`Renamed to “${name}”, on every service that used it too.`);
      await this.load();
    });
  }

  protected async toggleCategory(category: AdminCategory): Promise<void> {
    const status = category.Status === 'Active' ? 'Inactive' : 'Active';

    await this.run(async () => {
      await this.admin.updateCategory(category.ID, { Status: status });
      await this.load();
    });
  }

  // ---------- Helpers ----------

  private async run(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await action();
    } catch (error) {
      this.error.set(adminErrorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
