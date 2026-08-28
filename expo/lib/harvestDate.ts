const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function localDateOnly(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function parseIsoLocal(value: string): Date | null {
  const match = ISO_DATE.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

export function todayIsoDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function validateHarvestDateInput(input: string): { value: string | null; error?: string } {
  const raw = input.trim();
  if (!raw) return { value: null };
  const date = parseIsoLocal(raw);
  if (!date) return { value: null, error: 'Use YYYY-MM-DD, like 2026-08-24.' };
  if (date.getTime() > localDateOnly(new Date()).getTime()) {
    return { value: null, error: 'Picked date cannot be in the future.' };
  }
  return { value: raw };
}

export function pickedDateLabel(value?: string | null): string | null {
  if (!value) return null;
  const date = parseIsoLocal(value);
  if (!date) return null;
  const today = localDateOnly(new Date());
  const diffDays = Math.round((today.getTime() - date.getTime()) / 86_400_000);
  if (diffDays === 0) return 'Picked today';
  if (diffDays === 1) return 'Picked yesterday';
  return `Picked ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}
