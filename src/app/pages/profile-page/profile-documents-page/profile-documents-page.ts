import { Component, DestroyRef, afterNextRender, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { OrderService } from '../../../core/services/order.service';
import { authErrorMessage } from '../../../core/services/auth-errors';
import { ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS } from '../../../core/models/order';
import { DocumentFile, FolderView } from '../../../core/models/document';
import { Shape } from '../../../shared/kit/shapes/shape';

// "2026-11-24_02-15-30 - Contract Drafting" → date + "Contract Drafting"
const ORDER_FOLDER = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-\d{2} - (.+)$/;

@Component({
  selector: 'app-profile-documents-page',
  imports: [RouterLink, DatePipe, Shape],
  templateUrl: './profile-documents-page.html',
  styleUrl: './profile-documents-page.scss',
})
export class ProfileDocumentsPage {
  private readonly orders = inject(OrderService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly orderLabels = ORDER_STATUS_LABELS;
  protected readonly paymentLabels = PAYMENT_STATUS_LABELS;

  protected readonly view = signal<FolderView | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly search = signal('');
  // The file being downloaded, to show "Downloading…" on its button
  protected readonly downloading = signal<string | null>(null);

  // The open folder's contents, narrowed by the search box
  protected readonly folders = computed(() =>
    (this.view()?.folders ?? []).filter((f) => this.matches(this.label(f.name).title)),
  );
  protected readonly files = computed(() =>
    (this.view()?.files ?? []).filter((f) => this.matches(f.name)),
  );

  constructor() {
    // The open folder lives in the address (?folder=…), so Back and links work
    afterNextRender(() => {
      const sub = this.route.queryParamMap.subscribe((params) =>
        this.load(params.get('folder') ?? ''),
      );
      this.destroyRef.onDestroy(() => sub.unsubscribe());
    });
  }

  protected open(folderId: string): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { folder: folderId || null },
    });
  }

  private async load(folderId: string): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    this.search.set('');
    try {
      this.view.set(await this.orders.folder(folderId));
    } catch (error) {
      this.error.set(authErrorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }

  // Order folders read as the service, with their date underneath
  protected label(name: string): { title: string; date: string } {
    const m = ORDER_FOLDER.exec(name);
    if (!m) return { title: name, date: '' };
    return { title: m[6], date: `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00` };
  }

  private matches(text: string): boolean {
    const words = this.search().toLowerCase().split(/\s+/).filter(Boolean);
    return words.every((w) => text.toLowerCase().includes(w));
  }

  // Fetches the file through the Orders API and saves it in the browser
  protected async download(file: DocumentFile): Promise<void> {
    this.downloading.set(file.fileId);
    this.error.set(null);
    try {
      const result = await this.orders.document(file.fileId);
      const bytes = Uint8Array.from(atob(result.data), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: result.mimeType }));
      const link = document.createElement('a');
      link.href = url;
      link.download = result.name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (error) {
      this.error.set(authErrorMessage(error));
    } finally {
      this.downloading.set(null);
    }
  }

  // "PDF", "DOC", "IMG"… from the file type
  protected kind(file: DocumentFile): string {
    const type = file.mimeType;
    if (type === 'application/pdf') return 'PDF';
    if (type.includes('word') || type.includes('document')) return 'DOC';
    if (type.includes('sheet') || type.includes('excel')) return 'XLS';
    if (type.startsWith('image/')) return 'IMG';
    return 'FILE';
  }

  // 1 536 000 → "1.5 MB"
  protected size(bytes: number): string {
    if (!bytes) return '';
    if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  }
}
