export const defaultResponseDelaySeconds = 5;
export const minResponseDelaySeconds = 0;
export const maxResponseDelaySeconds = 60;

export const defaultContextMessageCount = 16;
export const minContextMessageCount = 1;
export const maxContextMessageCount = 100;

function integerWithin(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(parsed)));
}

export function normalizeResponseDelaySeconds(value: unknown) {
  return integerWithin(
    value,
    defaultResponseDelaySeconds,
    minResponseDelaySeconds,
    maxResponseDelaySeconds,
  );
}

export function normalizeContextMessageCount(value: unknown) {
  return integerWithin(
    value,
    defaultContextMessageCount,
    minContextMessageCount,
    maxContextMessageCount,
  );
}
