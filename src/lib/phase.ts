import { differenceInCalendarDays } from 'date-fns';

export type PhaseBucket = 'ON DECK' | 'IN MOTION' | 'CLOSING OUT' | 'OUTSIDE WINDOW';

export function computePhaseBucket(dateIssued?: Date | null, now = new Date()): PhaseBucket {
  if (!dateIssued) return 'OUTSIDE WINDOW';
  const ageDays = differenceInCalendarDays(now, dateIssued);
  if (ageDays < 0) return 'ON DECK';
  if (ageDays <= 14) return 'ON DECK';
  if (ageDays <= 45) return 'IN MOTION';
  if (ageDays <= 90) return 'CLOSING OUT';
  return 'OUTSIDE WINDOW';
}
