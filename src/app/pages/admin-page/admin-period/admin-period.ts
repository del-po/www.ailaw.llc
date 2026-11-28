import { Component, computed, model } from '@angular/core';
import { Period } from '../../../core/models/admin';

// Today in Tbilisi as "yyyy-MM-dd", or `days` before it
export function tbilisiDay(daysBack = 0): string {
  const date = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tbilisi' }).format(date);
}

export function lastDays(days: number): Period {
  return { from: tbilisiDay(days - 1), to: tbilisiDay() };
}

const PRESETS = [
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
  { label: '12 months', days: 365 },
];

// The date filter of the admin pages: quick periods, or any two days
@Component({
  selector: 'app-admin-period',
  templateUrl: './admin-period.html',
  styleUrl: './admin-period.scss',
})
export class AdminPeriod {
  readonly period = model.required<Period>();

  protected readonly presets = PRESETS;

  // The preset the period matches, if any
  protected readonly preset = computed(() => {
    const p = this.period();
    return PRESETS.find((x) => p.to === tbilisiDay() && p.from === tbilisiDay(x.days - 1))?.days;
  });

  protected pick(days: number): void {
    this.period.set(lastDays(days));
  }

  protected setDay(which: keyof Period, value: string): void {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
    const next = { ...this.period(), [which]: value };
    // The two days stay in order
    if (next.from > next.to) {
      if (which === 'from') next.to = next.from;
      else next.from = next.to;
    }
    this.period.set(next);
  }
}
