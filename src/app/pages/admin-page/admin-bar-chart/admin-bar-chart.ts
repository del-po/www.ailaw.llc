import { Component, computed, input, signal } from '@angular/core';

export interface BarPoint {
  // Shown under the chart and in the tooltip, e.g. "Nov 28"
  label: string;
  value: number;
}

const WIDTH = 600;
const HEIGHT = 160;
const TOP = 8;
const GAP = 2;
const RADIUS = 4;

// One measure over time as bars (orders per day, revenue per day …).
// Hovering a bar shows its day and value; a table with the same figures is
// there for screen readers.
@Component({
  selector: 'app-admin-bar-chart',
  templateUrl: './admin-bar-chart.html',
  styleUrl: './admin-bar-chart.scss',
})
export class AdminBarChart {
  readonly title = input.required<string>();
  readonly points = input.required<BarPoint[]>();
  // How a value is written, e.g. (n) => n + ' GEL'
  readonly format = input<(value: number) => string>((n) => String(n));

  protected readonly width = WIDTH;
  protected readonly height = HEIGHT;
  protected readonly hovered = signal<number | null>(null);

  protected readonly max = computed(() => Math.max(0, ...this.points().map((p) => p.value)));
  protected readonly total = computed(() => this.points().reduce((n, p) => n + p.value, 0));

  protected readonly bars = computed(() => {
    const list = this.points();
    const step = WIDTH / Math.max(list.length, 1);
    const max = this.max() || 1;
    return list.map((p, i) => {
      const h = p.value > 0 ? Math.max(2, ((HEIGHT - TOP) * p.value) / max) : 0;
      const x = i * step + GAP / 2;
      const w = Math.max(1, step - GAP);
      return { ...p, x, w, h, step, path: h ? bar(x, HEIGHT - h, w, h) : '' };
    });
  });

  // Three labels under the chart: first, middle, last
  protected readonly ticks = computed(() => {
    const list = this.points();
    if (!list.length) return [];
    const picks = [...new Set([0, Math.floor((list.length - 1) / 2), list.length - 1])];
    return picks.map((i) => ({ label: list[i].label, left: ((i + 0.5) / list.length) * 100 }));
  });

  protected readonly tip = computed(() => {
    const i = this.hovered();
    const b = i == null ? null : this.bars()[i];
    // Kept inside the chart near its edges
    return b ? { ...b, left: Math.min(88, Math.max(12, ((b.x + b.w / 2) / WIDTH) * 100)) } : null;
  });
}

// A bar with its top corners rounded, standing on the baseline
function bar(x: number, y: number, w: number, h: number): string {
  const r = Math.min(RADIUS, w / 2, h);
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}
