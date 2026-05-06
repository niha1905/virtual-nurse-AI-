import {
  addDays,
  addMinutes,
  isAfter,
  isBefore,
  isSameDay,
  parse,
  parseISO,
  startOfDay,
} from "date-fns";

type PrescriptionLike = {
  dose_times?: string[];
  frequency: string;
  start_date?: string;
  end_date?: string | null;
  is_active?: boolean;
};

type AdministrationLike = {
  administered_at: string;
  status: string;
};

export type DoseAlertState = "scheduled" | "due_soon" | "missed";

const COMPLETED_DOSE_STATUSES = new Set(["administered", "missed", "refused"]);

export const deriveDefaultTimes = (frequency: string) => {
  const normalized = frequency.toLowerCase();
  if (normalized.includes("three")) return ["08:00", "14:00", "20:00"];
  if (normalized.includes("twice")) return ["08:00", "20:00"];
  return ["09:00"];
};

export const getScheduleTimes = (prescription: PrescriptionLike) =>
  prescription.dose_times?.length ? prescription.dose_times : deriveDefaultTimes(prescription.frequency);

export const isPrescriptionActiveOnDate = (
  prescription: PrescriptionLike,
  when: Date = new Date(),
) => {
  if (prescription.is_active === false) return false;

  const day = startOfDay(when);
  const startsOn = prescription.start_date ? startOfDay(parseISO(prescription.start_date)) : null;
  const endsOn = prescription.end_date ? startOfDay(parseISO(prescription.end_date)) : null;

  if (startsOn && isBefore(day, startsOn)) return false;
  if (endsOn && isAfter(day, endsOn)) return false;
  return true;
};

export const getRecordedDoseCountForDay = (
  administrations: AdministrationLike[],
  when: Date = new Date(),
) =>
  administrations.filter(
    (administration) =>
      COMPLETED_DOSE_STATUSES.has(administration.status) &&
      isSameDay(new Date(administration.administered_at), when),
  ).length;

export const getNextDoseTime = (
  prescription: PrescriptionLike,
  administrations: AdministrationLike[],
  when: Date = new Date(),
) => {
  const scheduleTimes = getScheduleTimes(prescription);
  if (!scheduleTimes.length) return null;

  const recordedToday = getRecordedDoseCountForDay(administrations, when);
  const nextIndex = Math.min(recordedToday, scheduleTimes.length - 1);
  const baseDate = recordedToday >= scheduleTimes.length ? addDays(when, 1) : when;

  return parse(scheduleTimes[nextIndex], "HH:mm", baseDate);
};

export const getDoseAlertState = (
  doseAt: Date,
  reminderMinutesBefore: number,
  when: Date = new Date(),
): DoseAlertState => {
  const reminderAt = addMinutes(doseAt, -reminderMinutesBefore);

  if (isAfter(when, doseAt) || when.getTime() === doseAt.getTime()) {
    return "missed";
  }

  if (isAfter(when, reminderAt) || when.getTime() === reminderAt.getTime()) {
    return "due_soon";
  }

  return "scheduled";
};
