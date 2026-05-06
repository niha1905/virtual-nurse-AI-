import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useAuth } from "@/contexts/AuthContext";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  BellRing,
  CheckCircle2,
  Clock3,
  Pill,
  Siren,
  TimerReset,
} from "lucide-react";
import {
  addDays,
  format,
  formatDistanceStrict,
} from "date-fns";
import { toast } from "sonner";
import { startMedicationAlarm, stopMedicationAlarm } from "@/lib/alarmSound";
import {
  getDoseAlertState,
  getRecordedDoseCountForDay,
  getScheduleTimes,
  isPrescriptionActiveOnDate,
} from "@/lib/medicationSchedule";
import {
  getMissingFeatureMessage,
  isMissingSupabaseRelation,
  isRememberedMissingFeature,
  rememberMissingFeature,
} from "@/lib/supabaseErrors";

interface Prescription {
  id: string;
  dosage: string;
  frequency: string;
  start_date: string;
  end_date?: string | null;
  is_active: boolean;
  instructions?: string | null;
  dose_times: string[];
  reminder_minutes_before: number;
  medication: {
    name: string;
    generic_name?: string | null;
  };
}

interface Administration {
  prescription_id: string;
  administered_at: string;
  status: string;
}

type MedicationRelation = Pick<
  Database["public"]["Tables"]["medications"]["Row"],
  "name" | "generic_name"
>;
type PrescriptionRecord = Database["public"]["Tables"]["prescriptions"]["Row"] & {
  medication: MedicationRelation;
};
type AdministrationRecord = Pick<
  Database["public"]["Tables"]["medication_administrations"]["Row"],
  "prescription_id" | "administered_at" | "status"
>;

type DueDose = {
  prescriptionId: string;
  medicationName: string;
  doseAt: Date;
  storageKey: string;
};

const LOCAL_DOSE_PREFIX = "med-dose-taken";

const makeDoseStorageKey = (prescriptionId: string, doseAt: Date) =>
  `${LOCAL_DOSE_PREFIX}:${prescriptionId}:${format(doseAt, "yyyy-MM-dd-HH-mm")}`;

const isDoseAcknowledged = (storageKey: string) => localStorage.getItem(storageKey) === "taken";

const getCurrentDose = (
  prescription: Prescription,
  administrations: Administration[],
  when: Date,
): DueDose | null => {
  const recordedToday = getRecordedDoseCountForDay(administrations, when);
  const doses = buildDoseMoments(prescription, when);

  for (let index = recordedToday; index < doses.length; index++) {
    const doseAt = doses[index];
    const storageKey = makeDoseStorageKey(prescription.id, doseAt);

    if (isDoseAcknowledged(storageKey)) {
      continue;
    }

    return {
      prescriptionId: prescription.id,
      medicationName: prescription.medication.name,
      doseAt,
      storageKey,
    };
  }

  if (!doses.length) return null;

  const fallback = doses[doses.length - 1];
  return {
    prescriptionId: prescription.id,
    medicationName: prescription.medication.name,
    doseAt: when > fallback ? addDays(fallback, 1) : fallback,
    storageKey: makeDoseStorageKey(prescription.id, fallback),
  };
};

const buildDoseMoments = (prescription: Prescription, when: Date) => {
  const today = getScheduleTimes(prescription).map((time) => {
    const [hours, minutes] = time.split(":").map(Number);
    const dose = new Date(when);
    dose.setHours(hours, minutes, 0, 0);
    return dose;
  });
  const tomorrow = getScheduleTimes(prescription).map((time) => {
    const [hours, minutes] = time.split(":").map(Number);
    const dose = addDays(when, 1);
    dose.setHours(hours, minutes, 0, 0);
    return dose;
  });
  return [...today, ...tomorrow];
};

export const MedicationSchedule = () => {
  const { session } = useAuth();
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([]);
  const [administrations, setAdministrations] = useState<Record<string, Administration[]>>({});
  const [now, setNow] = useState(() => new Date());
  const [activeAlarmKey, setActiveAlarmKey] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    return () => stopMedicationAlarm();
  }, []);

  const loadData = useCallback(async () => {
    if (!session?.user?.id) return;

    if (isRememberedMissingFeature("medication-management")) {
      setPrescriptions([]);
      setAdministrations({});
      stopMedicationAlarm();
      setActiveAlarmKey(null);
      return;
    }

    try {
      const { data: prescriptionData, error: prescriptionError } = await supabase
        .from("prescriptions")
        .select("*, medication:medications(name, generic_name)")
        .eq("patient_id", session.user.id)
        .eq("is_active", true)
        .order("created_at", { ascending: false });

      if (prescriptionError) throw prescriptionError;

      const list = ((prescriptionData || []) as PrescriptionRecord[]).filter((prescription) =>
        isPrescriptionActiveOnDate(prescription),
      );
      setPrescriptions(list as Prescription[]);

      if (!list.length) {
        setAdministrations({});
        stopMedicationAlarm();
        setActiveAlarmKey(null);
        return;
      }

      const { data: administrationData, error: administrationError } = await supabase
        .from("medication_administrations")
        .select("prescription_id, administered_at, status")
        .in(
          "prescription_id",
          list.map((prescription) => prescription.id),
        )
        .order("administered_at", { ascending: false })
        .limit(100);

      if (administrationError) throw administrationError;

      const grouped: Record<string, Administration[]> = {};
      ((administrationData || []) as AdministrationRecord[]).forEach((administration) => {
        grouped[administration.prescription_id] ||= [];
        grouped[administration.prescription_id].push(administration);
      });
      setAdministrations(grouped);
    } catch (error) {
      if (isMissingSupabaseRelation(error)) {
        rememberMissingFeature("medication-management");
        setPrescriptions([]);
        setAdministrations({});
        stopMedicationAlarm();
        setActiveAlarmKey(null);
        toast.error(getMissingFeatureMessage("Medication reminders"));
      } else {
        console.error("Error loading medication schedule:", error);
        toast.error("Failed to load medication reminders");
      }
    }
  }, [session?.user?.id]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const dueDoses = useMemo(
    () =>
      prescriptions
        .map((prescription) =>
          getCurrentDose(prescription, administrations[prescription.id] || [], now),
        )
        .filter(Boolean) as DueDose[],
    [prescriptions, administrations, now],
  );

  const ringingDose =
    dueDoses.find((dose) => {
      const prescription = prescriptions.find((item) => item.id === dose.prescriptionId);
      if (!prescription) return false;
      return getDoseAlertState(dose.doseAt, prescription.reminder_minutes_before, now) === "missed";
    }) || null;

  useEffect(() => {
    if (ringingDose) {
      if (activeAlarmKey !== ringingDose.storageKey) {
        startMedicationAlarm();
        setActiveAlarmKey(ringingDose.storageKey);
        toast.error(
          `${ringingDose.medicationName} was missed. Alert sound is playing until the patient marks it taken.`,
        );
      }
      return;
    }

    if (activeAlarmKey) {
      stopMedicationAlarm();
      setActiveAlarmKey(null);
    }
  }, [ringingDose, activeAlarmKey]);

  const markDoseTaken = (dose: DueDose) => {
    localStorage.setItem(dose.storageKey, "taken");
    if (activeAlarmKey === dose.storageKey) {
      stopMedicationAlarm();
      setActiveAlarmKey(null);
    }
    setNow(new Date());
    toast.success(`${dose.medicationName} marked as taken`);
  };

  const resetDoseReminder = (dose: DueDose) => {
    localStorage.removeItem(dose.storageKey);
    setNow(new Date());
    toast.success(`Reminder reset for ${dose.medicationName}`);
  };

  return (
    <Card className="gradient-card p-6 shadow-soft">
      <div className="mb-4 flex items-center gap-2">
        <Pill className="h-5 w-5 text-primary" />
        <h3 className="text-lg font-semibold">Medication reminders</h3>
      </div>

      {prescriptions.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Active prescriptions from your doctor will appear here with reminder times.
        </p>
      ) : (
        <div className="space-y-3">
          {prescriptions.map((prescription) => {
            const schedule = getScheduleTimes(prescription);
            const currentDose = getCurrentDose(
              prescription,
              administrations[prescription.id] || [],
              now,
            );

            if (!currentDose) return null;

            const isRinging = ringingDose?.storageKey === currentDose.storageKey;
            const isAcknowledged = isDoseAcknowledged(currentDose.storageKey);
            const doseState = getDoseAlertState(
              currentDose.doseAt,
              prescription.reminder_minutes_before,
              now,
            );
            const countdown =
              now < currentDose.doseAt
                ? formatDistanceStrict(currentDose.doseAt, now)
                : formatDistanceStrict(now, currentDose.doseAt);

            return (
              <div
                key={prescription.id}
                className={`rounded-lg border p-4 ${
                  isRinging
                    ? "border-destructive bg-destructive/10"
                    : "border-border/60 bg-background/70"
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{prescription.medication.name}</span>
                  <Badge variant="outline">{prescription.dosage}</Badge>
                  <Badge variant="outline">{prescription.frequency}</Badge>
                  <Badge
                    variant={
                      isRinging
                        ? "destructive"
                        : isAcknowledged
                          ? "secondary"
                          : doseState === "due_soon"
                            ? "default"
                            : "outline"
                    }
                  >
                    {isRinging
                      ? "Missed dose alert"
                      : isAcknowledged
                        ? "Taken"
                        : doseState === "due_soon"
                          ? "Due soon"
                          : "Upcoming"}
                  </Badge>
                </div>

                <div className="mt-2 flex flex-wrap gap-3 text-sm text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Clock3 className="h-4 w-4" />
                    {schedule.join(", ")}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <BellRing className="h-4 w-4" />
                    Dose {format(currentDose.doseAt, "PPP 'at' p")}
                  </span>
                </div>

                <div className="mt-2 text-sm">
                  {isAcknowledged ? (
                    <span className="text-success">Dose marked taken</span>
                  ) : doseState === "scheduled" ? (
                    <span className="text-muted-foreground">Starts ringing in {countdown}</span>
                  ) : doseState === "due_soon" ? (
                    <span className="text-warning-foreground">
                      Reminder window is open. Dose time is in {countdown}.
                    </span>
                  ) : (
                    <span className="font-medium text-destructive">
                      Missed by {countdown}. Alert sound will continue until the patient marks it taken.
                    </span>
                  )}
                </div>

                {prescription.instructions ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {prescription.instructions}
                  </p>
                ) : null}

                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    onClick={() => markDoseTaken(currentDose)}
                    className="gradient-primary text-primary-foreground"
                  >
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                    I took it
                  </Button>
                  {isAcknowledged ? (
                    <Button variant="outline" onClick={() => resetDoseReminder(currentDose)}>
                      <TimerReset className="mr-2 h-4 w-4" />
                      Reset reminder
                    </Button>
                  ) : null}
                  {isRinging ? (
                    <div className="inline-flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                      <Siren className="h-4 w-4" />
                      Missed medication alarm active
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
};
