import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useAuth } from "@/contexts/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { AlertTriangle, BellRing, CheckCircle2, Clock3, Pill } from "lucide-react";
import { toast } from "sonner";
import {
  format,
  isAfter,
  isBefore,
} from "date-fns";
import {
  getNextDoseTime,
  getScheduleTimes,
  isPrescriptionActiveOnDate,
} from "@/lib/medicationSchedule";

interface Prescription {
  id: string;
  medication: {
    name: string;
    generic_name?: string | null;
  };
  dosage: string;
  frequency: string;
  instructions?: string | null;
  start_date: string;
  end_date?: string | null;
  dose_times: string[];
  reminder_minutes_before: number;
  is_active: boolean;
  patient: {
    full_name: string | null;
  } | null;
}

interface Administration {
  id: string;
  prescription_id: string;
  administered_at: string;
  status: string;
  notes?: string | null;
}

type ProfileSummary = Pick<Database["public"]["Tables"]["profiles"]["Row"], "id" | "full_name">;
type MedicationRelation = Pick<
  Database["public"]["Tables"]["medications"]["Row"],
  "name" | "generic_name"
>;
type PrescriptionRecord = Database["public"]["Tables"]["prescriptions"]["Row"] & {
  medication: MedicationRelation;
};
type AdministrationRecord = Database["public"]["Tables"]["medication_administrations"]["Row"];

const getNextDose = (prescription: Prescription, administrations: Administration[]) => {
  return getNextDoseTime(prescription, administrations);
};

const getReminderState = (prescription: Prescription, administrations: Administration[]) => {
  const nextDose = getNextDose(prescription, administrations);
  if (!nextDose) return "scheduled";
  const now = new Date();
  const reminderAt = new Date(
    nextDose.getTime() - prescription.reminder_minutes_before * 60 * 1000,
  );

  if (isAfter(now, nextDose)) return "overdue";
  if (isAfter(now, reminderAt) && isBefore(now, nextDose)) return "due_soon";
  return "scheduled";
};

export const MedicationAdmin = () => {
  const { session } = useAuth();
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([]);
  const [administrations, setAdministrations] = useState<Record<string, Administration[]>>({});
  const [loading, setLoading] = useState(true);
  const [adminNotes, setAdminNotes] = useState("");

  const loadData = useCallback(async () => {
    if (!session?.user?.id) return;

    try {
      const { data: patients, error: patientsError } = await supabase
        .from("profiles")
        .select("id, full_name")
        .eq("assigned_caregiver_id", session.user.id);

      if (patientsError) throw patientsError;

      if (!patients?.length) {
        setPrescriptions([]);
        setAdministrations({});
        return;
      }

      const patientIds = patients.map((patient) => patient.id);

      const { data: prescriptionsData, error: prescriptionsError } = await supabase
        .from("prescriptions")
        .select(`
          *,
          medication:medications(name, generic_name)
        `)
        .in("patient_id", patientIds)
        .eq("is_active", true)
        .order("start_date", { ascending: false });

      if (prescriptionsError) throw prescriptionsError;
      const patientNameById = Object.fromEntries(
        ((patients || []) as ProfileSummary[]).map((patient) => [patient.id, patient.full_name || "Patient"]),
      );
      const activePrescriptions = ((prescriptionsData || []) as PrescriptionRecord[])
        .filter((prescription) => isPrescriptionActiveOnDate(prescription))
        .map((prescription) => ({
          ...prescription,
          patient: {
            full_name: patientNameById[prescription.patient_id] || "Patient",
          },
        })) as Prescription[];
      setPrescriptions(activePrescriptions);

      const prescriptionIds = activePrescriptions.map((prescription) => prescription.id);
      if (!prescriptionIds.length) {
        setAdministrations({});
        return;
      }

      const { data: administrationData, error: administrationError } = await supabase
        .from("medication_administrations")
        .select("*")
        .in("prescription_id", prescriptionIds)
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
      console.error("Error loading medication data:", error);
      toast.error("Failed to load medication data");
    } finally {
      setLoading(false);
    }
  }, [session?.user?.id]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const recordAdministration = async (
    prescriptionId: string,
    status: "administered" | "missed" | "refused",
  ) => {
    try {
      const { error } = await supabase.from("medication_administrations").insert({
        prescription_id: prescriptionId,
        caregiver_id: session?.user?.id,
        status,
        notes: adminNotes || null,
      });

      if (error) throw error;

      toast.success(`Medication ${status} recorded`);
      setAdminNotes("");
      void loadData();
    } catch (error) {
      console.error("Error recording administration:", error);
      toast.error("Failed to record administration");
    }
  };

  if (loading) {
    return <div className="text-sm text-muted-foreground">Loading medication tracking...</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Medication administration</h2>
        <p className="text-sm text-muted-foreground">
          Follow the doctor’s schedule, get reminder windows, and record what was
          given to each patient.
        </p>
      </div>

      <div className="grid gap-4">
        {prescriptions.map((prescription) => {
          const prescriptionAdministrations = administrations[prescription.id] || [];
          const lastAdministration = prescriptionAdministrations[0];
          const nextDose = getNextDose(prescription, prescriptionAdministrations);
          const reminderState = getReminderState(prescription, prescriptionAdministrations);

          return (
            <Card key={prescription.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill className="h-4 w-4 text-primary" />
                    <span className="font-semibold">{prescription.medication.name}</span>
                    {prescription.medication.generic_name ? (
                      <Badge variant="outline">{prescription.medication.generic_name}</Badge>
                    ) : null}
                    <Badge variant="outline">{prescription.dosage}</Badge>
                    <Badge
                      variant={
                        reminderState === "overdue"
                          ? "destructive"
                          : reminderState === "due_soon"
                            ? "default"
                            : "secondary"
                      }
                    >
                      {reminderState === "overdue"
                        ? "Overdue"
                        : reminderState === "due_soon"
                          ? "Reminder active"
                          : "Scheduled"}
                    </Badge>
                  </div>

                  <p className="text-sm text-muted-foreground">
                    Patient: {prescription.patient.full_name || "Patient"} • {prescription.frequency}
                  </p>

                  <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Clock3 className="h-4 w-4" />
                      {getScheduleTimes(prescription).join(", ")}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <BellRing className="h-4 w-4" />
                      Next dose {format(nextDose, "PPP 'at' p")}
                    </span>
                  </div>

                  {prescription.instructions ? (
                    <p className="text-sm text-muted-foreground">
                      Instructions: {prescription.instructions}
                    </p>
                  ) : null}

                  {lastAdministration ? (
                    <p className="text-sm text-muted-foreground">
                      Last recorded: {format(new Date(lastAdministration.administered_at), "PPP 'at' p")}
                      {lastAdministration.status !== "administered" ? (
                        <Badge variant="destructive" className="ml-2">
                          {lastAdministration.status}
                        </Badge>
                      ) : null}
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No administration logged yet.
                    </p>
                  )}

                  {reminderState === "overdue" ? (
                    <div className="flex items-center gap-2 text-destructive">
                      <AlertTriangle className="h-4 w-4" />
                      <span className="text-sm">This medication is past its scheduled dose time.</span>
                    </div>
                  ) : null}
                </div>

                <Dialog>
                  <DialogTrigger asChild>
                    <Button variant={reminderState === "overdue" ? "destructive" : "default"} size="sm">
                      <CheckCircle2 className="mr-1 h-4 w-4" />
                      Record
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Record medication administration</DialogTitle>
                      <DialogDescription>
                        {prescription.medication.name} - {prescription.dosage} for{" "}
                        {prescription.patient.full_name || "Patient"}
                      </DialogDescription>
                    </DialogHeader>

                    <Textarea
                      placeholder="Optional caregiver notes"
                      value={adminNotes}
                      onChange={(event) => setAdminNotes(event.target.value)}
                    />

                    <DialogFooter className="gap-2">
                      <Button
                        variant="outline"
                        onClick={() => recordAdministration(prescription.id, "missed")}
                      >
                        Mark missed
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => recordAdministration(prescription.id, "refused")}
                      >
                        Mark refused
                      </Button>
                      <Button onClick={() => recordAdministration(prescription.id, "administered")}>
                        Given to patient
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </Card>
          );
        })}
      </div>

      {prescriptions.length === 0 ? (
        <Card className="p-8 text-center">
          <Pill className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
          <h3 className="mb-2 text-lg font-semibold">No medications assigned</h3>
          <p className="text-muted-foreground">
            Prescriptions from the assigned doctor will appear here for caregiver follow-up.
          </p>
        </Card>
      ) : null}
    </div>
  );
};
