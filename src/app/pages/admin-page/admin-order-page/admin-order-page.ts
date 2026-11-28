import { Component, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import {
  DatePipe,
  DecimalPipe,
  KeyValuePipe,
  NgTemplateOutlet,
  isPlatformBrowser,
} from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AdminService } from '../../../core/services/admin.service';
import { OrderService } from '../../../core/services/order.service';
import { readUpload } from '../../../core/services/read-upload';
import { saveDownload } from '../../../core/services/save-download';
import {
  FileNode,
  OrderStep,
  OrderWorkspace,
  StepChange,
  StepOp,
  StepStatus,
} from '../../../core/models/admin';
import {
  ORDER_STATUS_LABELS,
  OrderStatus,
  PAYMENT_STATUS_LABELS,
  PaymentStatus,
} from '../../../core/models/order';
import { AdminLawyer } from '../../../core/models/lawyer';
import { Shape } from '../../../shared/kit/shapes/shape';
import { actionLabel, shown } from '../admin-audit';
import { adminErrorMessage } from '../admin-links';

// Which form is open under a step
type StepForm = 'complete' | 'correct' | 'sendBack' | 'edit';

export const STEP_LABELS: Record<StepStatus, string> = {
  waiting: 'Waiting',
  active: 'In progress',
  review: 'To approve',
  failed: 'Failed',
  done: 'Done',
  skipped: 'Skipped',
};

// What a step's chat (AI Law) part does, in plain words
export const CAPABILITY_LABELS: Record<string, string> = {
  collect: 'Collects details',
  await_payment: 'Waits for payment',
  calculate: 'Calculates',
  deliver: 'Delivers to the client',
  task: 'Lawyer’s task',
};

// One order's workspace: its details, client, workflow, lawyers, deadlines,
// documents and history, with everything the admin can do to it
@Component({
  selector: 'app-admin-order-page',
  imports: [DatePipe, DecimalPipe, KeyValuePipe, NgTemplateOutlet, RouterLink, Shape],
  templateUrl: './admin-order-page.html',
  styleUrl: './admin-order-page.scss',
})
export class AdminOrderPage {
  private readonly admin = inject(AdminService);
  private readonly orders = inject(OrderService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  protected readonly orderNumber =
    inject(ActivatedRoute).snapshot.paramMap.get('orderNumber') ?? '';

  protected readonly orderLabels = ORDER_STATUS_LABELS;
  protected readonly paymentLabels = PAYMENT_STATUS_LABELS;
  protected readonly orderStatuses = Object.keys(ORDER_STATUS_LABELS) as OrderStatus[];
  protected readonly paymentStatuses = Object.keys(PAYMENT_STATUS_LABELS) as PaymentStatus[];
  protected readonly stepLabels = STEP_LABELS;
  protected readonly capabilityLabels = CAPABILITY_LABELS;
  protected readonly actionLabel = actionLabel;
  protected readonly shown = shown;
  // Keeps details in the order they were asked
  protected readonly keepOrder = () => 0;

  protected readonly w = signal<OrderWorkspace | null>(null);
  protected readonly lawyers = signal<AdminLawyer[]>([]);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly busy = signal(false);

  // The step whose form is open, and which form
  protected readonly stepForm = signal<{ stepNo: number; form: StepForm } | null>(null);
  protected readonly editingDetails = signal(false);
  protected readonly editingPrices = signal(false);
  protected readonly openHistory = signal<string | null>(null);

  protected readonly available = computed(() =>
    this.lawyers().filter((l) => l.status === 'approved' || l.status === 'active'),
  );
  protected readonly isOpen = computed(() =>
    ['placed', 'in_progress'].includes(this.w()?.order.orderStatus ?? ''),
  );

  // Progress: done and skipped steps out of all
  protected readonly progress = computed(() => {
    const steps = this.w()?.steps ?? [];
    const done = steps.filter((s) => s.status === 'done' || s.status === 'skipped').length;
    return { done, total: steps.length, percent: steps.length ? (done / steps.length) * 100 : 0 };
  });

  // The order folder and every folder inside it, for choosing where an upload goes
  protected readonly folders = computed(() => {
    const list: { name: string; path: string }[] = [];
    const walk = (node: FileNode, depth: number) => {
      list.push({ name: '  '.repeat(depth) + node.name, path: node.path });
      node.folders.forEach((f) => walk(f, depth + 1));
    };
    const root = this.w()?.files;
    if (root) walk(root, 0);
    return list;
  });

  constructor() {
    if (this.isBrowser) this.load();
  }

  protected async load(): Promise<void> {
    this.error.set(null);
    try {
      const [w, lawyers] = await Promise.all([
        this.admin.orderWorkspace(this.orderNumber),
        this.lawyers().length ? Promise.resolve(this.lawyers()) : this.admin.listLawyers(),
      ]);
      this.w.set(w);
      this.lawyers.set(lawyers);
    } catch (error) {
      this.error.set(adminErrorMessage(error));
    }
  }

  // Runs one change; the workspace shows the order as it is after it
  private async run(change: () => Promise<unknown>, done: string): Promise<boolean> {
    this.busy.set(true);
    this.error.set(null);
    this.notice.set(null);
    try {
      const result = await change();
      if (result && typeof result === 'object' && 'steps' in result) {
        this.w.set(result as OrderWorkspace);
      } else {
        this.w.set(await this.admin.orderWorkspace(this.orderNumber));
      }
      this.notice.set(done);
      return true;
    } catch (error) {
      this.error.set(adminErrorMessage(error));
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  // ---------- Statuses and paperwork ----------

  protected saveStatus(orderStatus: string, paymentStatus: string): Promise<boolean> {
    const order = this.w()!.order;
    const paying = paymentStatus === 'paid' && order.paymentStatus !== 'paid';
    return this.run(
      () =>
        this.orders.adminUpdate(order.orderId, {
          orderStatus: orderStatus as OrderStatus,
          paymentStatus: paymentStatus as PaymentStatus,
        }),
      paying ? 'Marked paid: the client gets a receipt and the work starts.' : 'Saved.',
    );
  }

  protected remake(): Promise<boolean> {
    return this.run(
      () => this.admin.remakeAgreement(this.w()!.order.orderId),
      'A new agreement was made from the order as it is now.',
    );
  }

  protected resend(): Promise<boolean> {
    return this.run(
      () => this.admin.resendEmail(this.w()!.order.orderId),
      `The confirmation email went to ${this.w()!.order.customerEmail} again.`,
    );
  }

  protected setDeadline(value: string): Promise<boolean> {
    return this.run(
      () => this.admin.editOrder(this.orderNumber, { dueAt: value }),
      value ? 'Deadline set.' : 'Deadline removed.',
    );
  }

  // ---------- Details and prices ----------

  protected async saveDetails(form: HTMLFormElement, event: Event): Promise<void> {
    event.preventDefault();
    const field = (name: string) =>
      (form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement).value.trim();
    // The service's details, one "key: value" per line
    const details: Record<string, string> = {};
    for (const line of field('details').split('\n')) {
      const at = line.indexOf(':');
      if (at > 0) details[line.slice(0, at).trim()] = line.slice(at + 1).trim();
    }
    const done = await this.run(
      () =>
        this.admin.editOrder(this.orderNumber, {
          customerName: field('customerName'),
          customerEmail: field('customerEmail'),
          customerPhone: field('customerPhone'),
          billingAddress: field('billingAddress'),
          customerNotes: field('customerNotes'),
          adminNotes: field('adminNotes'),
          details,
        }),
      'Details saved. Remake the agreement if they should appear on it.',
    );
    if (done) this.editingDetails.set(false);
  }

  protected detailsText(details: Record<string, string | number>): string {
    return Object.entries(details)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n');
  }

  protected async savePrices(form: HTMLFormElement, event: Event): Promise<void> {
    event.preventDefault();
    const value = (name: string) =>
      Number((form.elements.namedItem(name) as HTMLInputElement).value || 0);
    const items = (this.w()!.order.items ?? []).map((i) => ({
      orderItemId: i.orderItemId,
      unitPrice: value('price-' + i.orderItemId),
      discountAmount: value('discount-' + i.orderItemId),
    }));
    const done = await this.run(
      () => this.admin.setOrderPrices(this.orderNumber, items),
      'Prices saved. Remake the agreement so it shows them.',
    );
    if (done) this.editingPrices.set(false);
  }

  // ---------- Workflow ----------

  protected startWorkflow(): Promise<boolean> {
    return this.run(
      () => this.admin.startWorkflow(this.orderNumber),
      'The service’s workflow is running on this order.',
    );
  }

  protected openForm(step: OrderStep, form: StepForm): void {
    const open = this.stepForm();
    this.stepForm.set(
      open?.stepNo === step.stepNo && open.form === form ? null : { stepNo: step.stepNo, form },
    );
  }

  protected isForm(step: OrderStep, form: StepForm): boolean {
    const open = this.stepForm();
    return open?.stepNo === step.stepNo && open.form === form;
  }

  protected async stepOp(step: OrderStep, op: StepOp, change: StepChange = {}): Promise<void> {
    const ask: Partial<Record<StepOp, string>> = {
      skip: `Skip "${step.clientLabel}"? The order goes on without it.`,
      restart: `Run "${step.clientLabel}" again? Its result is cleared.`,
      approve: `Approve "${step.clientLabel}"? The order goes on, and its delivery step sends the result to the client.`,
    };
    if (ask[op] && !confirm(ask[op])) return;
    const done = await this.run(
      () => this.admin.stepAction(this.orderNumber, step.stepNo, op, change),
      {
        complete: 'Step done; the order goes on.',
        correct: 'Result corrected.',
        approve: 'Approved; the order goes on.',
        sendBack: 'Sent back: the lead lawyer was emailed.',
        restart: 'The step runs again.',
        skip: 'Step skipped.',
        edit: 'Step saved.',
      }[op],
    );
    if (done) this.stepForm.set(null);
  }

  // Complete or correct: a typed result or link, or an uploaded file
  protected async submitResult(
    step: OrderStep,
    op: 'complete' | 'correct',
    form: HTMLFormElement,
    event: Event,
  ): Promise<void> {
    event.preventDefault();
    const input = form.elements.namedItem('file') as HTMLInputElement;
    const text = (name: string) =>
      (form.elements.namedItem(name) as HTMLInputElement | null)?.value.trim() ?? '';
    const change: StepChange = { note: text('note') };
    const file = input.files?.[0];
    if (file) {
      change.file = await readUpload(file);
      change.replace = (form.elements.namedItem('replace') as HTMLInputElement).checked;
    } else {
      change.result = text('result');
    }
    await this.stepOp(step, op, change);
  }

  protected async saveStep(step: OrderStep, form: HTMLFormElement, event: Event): Promise<void> {
    event.preventDefault();
    const text = (name: string) =>
      (form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement).value.trim();
    await this.stepOp(step, 'edit', {
      clientLabel: text('clientLabel'),
      lawyerTask: text('lawyerTask'),
      dueAt: text('dueAt'),
    });
  }

  protected sendBack(step: OrderStep, note: string): Promise<void> {
    if (!note.trim()) {
      this.error.set('Say what needs changing: the lawyer gets it by email.');
      return Promise.resolve();
    }
    return this.stepOp(step, 'sendBack', { note: note.trim() });
  }

  // "file:clients/…/Agreement.pdf" → the file's name; links stay links
  protected resultName(result: string): string {
    return result.startsWith('file:') ? result.split('/').pop() || result : result;
  }

  protected isLink(result: string): boolean {
    return /^https?:\/\//.test(result);
  }

  // ---------- Lawyers ----------

  protected assign(lawyerId: string, role: string): Promise<boolean> {
    if (!lawyerId) return Promise.resolve(false);
    return this.run(
      () =>
        this.admin.assignLawyer(
          this.orderNumber,
          lawyerId,
          role === 'reviewer' ? 'reviewer' : 'lead',
        ),
      'Lawyer assigned and emailed.',
    );
  }

  protected unassign(assignmentId: string, name: string): Promise<boolean> {
    if (!confirm(`Take ${name} off this order? They are emailed that the assignment is closed.`)) {
      return Promise.resolve(false);
    }
    return this.run(
      () => this.admin.unassignLawyer(this.orderNumber, assignmentId),
      `${name} is off the order.`,
    );
  }

  // ---------- Documents ----------

  protected async download(path: string): Promise<void> {
    this.error.set(null);
    try {
      saveDownload(await this.admin.getFile(path.startsWith('file:') ? path.slice(5) : path));
    } catch (error) {
      this.error.set(adminErrorMessage(error));
    }
  }

  protected async upload(folder: string, input: HTMLInputElement, replace: boolean): Promise<void> {
    const file = input.files?.[0];
    if (!file) {
      this.error.set('Choose a file first.');
      return;
    }
    const upload = await readUpload(file);
    const done = await this.run(
      () => this.admin.uploadFile(folder, upload, replace),
      replace ? 'Uploaded; the old copy is kept in Versions.' : 'Uploaded.',
    );
    if (done) input.value = '';
  }
}
