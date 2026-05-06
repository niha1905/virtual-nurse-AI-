import { describe, expect, it } from "vitest";
import {
  getDoseAlertState,
  getNextDoseTime,
  getRecordedDoseCountForDay,
  isPrescriptionActiveOnDate,
} from "@/lib/medicationSchedule";

const prescription = {
  frequency: "Twice daily",
  dose_times: ["08:00", "20:00"],
  start_date: "2026-04-25",
  end_date: "2026-05-05",
  is_active: true,
};

describe("medicationSchedule", () => {
  it("counts missed and refused doses as completed for the day", () => {
    const administrations = [
      { administered_at: "2026-04-25T08:05:00.000Z", status: "missed" },
      { administered_at: "2026-04-25T12:30:00.000Z", status: "refused" },
    ];

    expect(
      getRecordedDoseCountForDay(administrations, new Date("2026-04-25T15:00:00.000Z")),
    ).toBe(2);
  });

  it("advances the next dose after a missed medication event", () => {
    const administrations = [
      { administered_at: "2026-04-25T08:05:00.000Z", status: "missed" },
    ];

    const nextDose = getNextDoseTime(
      prescription,
      administrations,
      new Date("2026-04-25T09:00:00.000Z"),
    );

    expect(nextDose?.getHours()).toBe(20);
    expect(nextDose?.getDate()).toBe(25);
  });

  it("ignores prescriptions before their start date and after their end date", () => {
    expect(isPrescriptionActiveOnDate(prescription, new Date("2026-04-24T12:00:00.000Z"))).toBe(false);
    expect(isPrescriptionActiveOnDate(prescription, new Date("2026-04-25T12:00:00.000Z"))).toBe(true);
    expect(isPrescriptionActiveOnDate(prescription, new Date("2026-05-06T12:00:00.000Z"))).toBe(false);
  });

  it("marks a dose as missed once its scheduled time has passed", () => {
    expect(
      getDoseAlertState(
        new Date("2026-04-25T08:00:00.000Z"),
        15,
        new Date("2026-04-25T08:01:00.000Z"),
      ),
    ).toBe("missed");
  });
});
