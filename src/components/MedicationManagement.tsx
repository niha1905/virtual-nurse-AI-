import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useAuth } from "@/contexts/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { BellRing, Clock3, Pill, Plus } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  getMissingFeatureMessage,
  isMissingSupabaseRelation,
  isRememberedMissingFeature,
  rememberMissingFeature,
} from "@/lib/supabaseErrors";

interface Medication {
  id: string;
  name: string;
  generic_name?: string | null;
  description?: string | null;
  dosage_form?: string | null;
}

interface Prescription {
  id: string;
  medication_id: string;
  medication: Medication;
  dosage: string;
  frequency: string;
  duration_days?: number | null;
  instructions?: string | null;
  start_date: string;
  end_date?: string | null;
  patient_id: string;
  patient_name?: string;
  dose_times: string[];
  reminder_minutes_before: number;
  is_active: boolean;
}

type PatientSummary = Pick<Database["public"]["Tables"]["profiles"]["Row"], "id" | "full_name">;
type MedicationRecord = Database["public"]["Tables"]["medications"]["Row"];
type PrescriptionRecord = Database["public"]["Tables"]["prescriptions"]["Row"] & {
  medication: MedicationRecord;
};

const normalizeDoseTimes = (rawValue: string) =>
  Array.from(
    new Set(
      rawValue
        .split(",")
        .map((value) => value.trim())
        .filter((value) => /^\d{2}:\d{2}$/.test(value)),
    ),
  );

export const MedicationManagement = () => {
  const { session } = useAuth();
  const [medications, setMedications] = useState<Medication[]>([]);
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([]);
  const [patients, setPatients] = useState<Array<{ id: string; full_name: string | null }>>([]);
  const [loading, setLoading] = useState(true);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [prescriptionOpen, setPrescriptionOpen] = useState(false);
  const [newMedication, setNewMedication] = useState({
    name: "",
    generic_name: "",
    description: "",
    dosage_form: "",
  });
  const [newPrescription, setNewPrescription] = useState({
    patient_id: "",
    medication_id: "",
    dosage: "",
    frequency: "",
    duration_days: "",
    instructions: "",
    start_date: format(new Date(), "yyyy-MM-dd"),
    end_date: "",
    dose_times: "08:00,20:00",
    reminder_minutes_before: "15",
  });

  const loadData = useCallback(async () => {
    if (!session?.user?.id) return;

    if (isRememberedMissingFeature("medication-management")) {
      setMedications([]);
      setPrescriptions([]);
      setLoading(false);
      return;
    }

    try {
      const [medicationsResponse, prescriptionsResponse, patientsResponse] = await Promise.all([
        supabase.from("medications").select("*").order("name"),
        supabase
          .from("prescriptions")
          .select(`
            *,
            medication:medications(*)
          `)
          .eq("doctor_id", session.user.id)
          .order("created_at", { ascending: false }),
        supabase
          .from("profiles")
          .select("id, full_name")
          .eq("assigned_doctor_id", session.user.id)
          .order("full_name"),
      ]);

      if (medicationsResponse.error) throw medicationsResponse.error;
      if (prescriptionsResponse.error) throw prescriptionsResponse.error;
      if (patientsResponse.error) throw patientsResponse.error;

      setMedications(medicationsResponse.data || []);
      const patientNameById = Object.fromEntries(
        ((patientsResponse.data || []) as PatientSummary[]).map((patient) => [patient.id, patient.full_name || "Patient"]),
      );
      setPrescriptions(
        ((prescriptionsResponse.data || []) as PrescriptionRecord[]).map((prescription) => ({
          ...prescription,
          patient_name: patientNameById[prescription.patient_id] || "Patient",
        })),
      );
      setPatients(patientsResponse.data || []);
      setNewPrescription((previous) => ({
        ...previous,
        patient_id: previous.patient_id || patientsResponse.data?.[0]?.id || "",
      }));
    } catch (error) {
      if (isMissingSupabaseRelation(error)) {
        rememberMissingFeature("medication-management");
        setMedications([]);
        setPrescriptions([]);
        toast.error(getMissingFeatureMessage("Medication management"));
      } else {
        console.error("Error loading medication data:", error);
        toast.error("Failed to load medication data");
      }
    } finally {
      setLoading(false);
    }
  }, [session?.user?.id]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const createMedication = async () => {
    if (!newMedication.name.trim()) {
      toast.error("Medication name is required");
      return;
    }

    try {
      const { error } = await supabase.from("medications").insert({
        name: newMedication.name.trim(),
        generic_name: newMedication.generic_name.trim() || null,
        description: newMedication.description.trim() || null,
        dosage_form: newMedication.dosage_form.trim() || null,
      });

      if (error) throw error;

      toast.success("Medication added to catalog");
      setCatalogOpen(false);
      setNewMedication({ name: "", generic_name: "", description: "", dosage_form: "" });
      void loadData();
    } catch (error) {
      if (isMissingSupabaseRelation(error)) {
        rememberMissingFeature("medication-management");
        toast.error(getMissingFeatureMessage("Medication management"));
      } else {
        console.error("Error creating medication:", error);
        toast.error("Failed to add medication");
      }
    }
  };

  const createPrescription = async () => {
    if (!newPrescription.patient_id || !newPrescription.medication_id) {
      toast.error("Select both a patient and a medication");
      return;
    }

    const doseTimes = normalizeDoseTimes(newPrescription.dose_times);
    if (!doseTimes.length) {
      toast.error("Add at least one valid reminder time like 08:00");
      return;
    }

    try {
      const { error } = await supabase.from("prescriptions").insert({
        doctor_id: session?.user?.id,
        patient_id: newPrescription.patient_id,
        medication_id: newPrescription.medication_id,
        dosage: newPrescription.dosage,
        frequency: newPrescription.frequency,
        duration_days: newPrescription.duration_days
          ? parseInt(newPrescription.duration_days, 10)
          : null,
        instructions: newPrescription.instructions || null,
        start_date: newPrescription.start_date,
        end_date: newPrescription.end_date || null,
        dose_times: doseTimes,
        reminder_minutes_before: parseInt(newPrescription.reminder_minutes_before, 10) || 15,
        is_active: true,
      });

      if (error) throw error;

      toast.success("Prescription created successfully");
      setPrescriptionOpen(false);
      setNewPrescription({
        patient_id: patients[0]?.id || "",
        medication_id: "",
        dosage: "",
        frequency: "",
        duration_days: "",
        instructions: "",
        start_date: format(new Date(), "yyyy-MM-dd"),
        end_date: "",
        dose_times: "08:00,20:00",
        reminder_minutes_before: "15",
      });
      void loadData();
    } catch (error) {
      if (isMissingSupabaseRelation(error)) {
        rememberMissingFeature("medication-management");
        toast.error(getMissingFeatureMessage("Medication management"));
      } else {
        console.error("Error creating prescription:", error);
        toast.error("Failed to create prescription");
      }
    }
  };

  const togglePrescription = async (prescription: Prescription) => {
    try {
      const { error } = await supabase
        .from("prescriptions")
        .update({ is_active: !prescription.is_active })
        .eq("id", prescription.id);

      if (error) throw error;

      toast.success(
        prescription.is_active ? "Prescription paused" : "Prescription reactivated",
      );
      void loadData();
    } catch (error) {
      if (isMissingSupabaseRelation(error)) {
        rememberMissingFeature("medication-management");
        toast.error(getMissingFeatureMessage("Medication management"));
      } else {
        console.error("Error updating prescription:", error);
        toast.error("Failed to update prescription");
      }
    }
  };

  if (loading) {
    return <div className="text-sm text-muted-foreground">Loading medication workflows...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">Medication management</h2>
          <p className="text-sm text-muted-foreground">
            Build the medication catalog, prescribe it to patients, and set caregiver
            reminder times.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Dialog open={catalogOpen} onOpenChange={setCatalogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <Plus className="mr-2 h-4 w-4" />
                Add medication
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add medication to catalog</DialogTitle>
                <DialogDescription>
                  Create the medication list doctors can prescribe to patients.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div>
                  <Label htmlFor="med-name">Name</Label>
                  <Input
                    id="med-name"
                    value={newMedication.name}
                    onChange={(event) =>
                      setNewMedication((previous) => ({
                        ...previous,
                        name: event.target.value,
                      }))
                    }
                    placeholder="Paracetamol"
                  />
                </div>

                <div>
                  <Label htmlFor="med-generic">Generic name</Label>
                  <Input
                    id="med-generic"
                    value={newMedication.generic_name}
                    onChange={(event) =>
                      setNewMedication((previous) => ({
                        ...previous,
                        generic_name: event.target.value,
                      }))
                    }
                    placeholder="Acetaminophen"
                  />
                </div>

                <div>
                  <Label htmlFor="med-form">Dosage form</Label>
                  <Input
                    id="med-form"
                    value={newMedication.dosage_form}
                    onChange={(event) =>
                      setNewMedication((previous) => ({
                        ...previous,
                        dosage_form: event.target.value,
                      }))
                    }
                    placeholder="Tablet, syrup, inhaler"
                  />
                </div>

                <div>
                  <Label htmlFor="med-description">Description</Label>
                  <Textarea
                    id="med-description"
                    value={newMedication.description}
                    onChange={(event) =>
                      setNewMedication((previous) => ({
                        ...previous,
                        description: event.target.value,
                      }))
                    }
                    placeholder="Optional notes about the medication"
                    rows={3}
                  />
                </div>
              </div>

              <DialogFooter>
                <Button onClick={createMedication}>Save medication</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={prescriptionOpen} onOpenChange={setPrescriptionOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                New prescription
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Create new prescription</DialogTitle>
                <DialogDescription>
                  Assign medication and reminder timing for the caregiver and patient.
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <Label htmlFor="patient">Patient</Label>
                  <Select
                    value={newPrescription.patient_id}
                    onValueChange={(value) =>
                      setNewPrescription((previous) => ({ ...previous, patient_id: value }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select patient" />
                    </SelectTrigger>
                    <SelectContent>
                      {patients.map((patient) => (
                        <SelectItem key={patient.id} value={patient.id}>
                          {patient.full_name || "Patient"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="medication">Medication</Label>
                  <Select
                    value={newPrescription.medication_id}
                    onValueChange={(value) =>
                      setNewPrescription((previous) => ({ ...previous, medication_id: value }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select medication" />
                    </SelectTrigger>
                    <SelectContent>
                      {medications.map((medication) => (
                        <SelectItem key={medication.id} value={medication.id}>
                          {medication.name}
                          {medication.generic_name ? ` (${medication.generic_name})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="dosage">Dosage</Label>
                  <Input
                    id="dosage"
                    value={newPrescription.dosage}
                    onChange={(event) =>
                      setNewPrescription((previous) => ({
                        ...previous,
                        dosage: event.target.value,
                      }))
                    }
                    placeholder="500mg"
                  />
                </div>

                <div>
                  <Label htmlFor="frequency">Frequency</Label>
                  <Input
                    id="frequency"
                    value={newPrescription.frequency}
                    onChange={(event) =>
                      setNewPrescription((previous) => ({
                        ...previous,
                        frequency: event.target.value,
                      }))
                    }
                    placeholder="Twice daily after food"
                  />
                </div>

                <div>
                  <Label htmlFor="dose_times">Dose times</Label>
                  <Input
                    id="dose_times"
                    value={newPrescription.dose_times}
                    onChange={(event) =>
                      setNewPrescription((previous) => ({
                        ...previous,
                        dose_times: event.target.value,
                      }))
                    }
                    placeholder="08:00,20:00"
                  />
                </div>

                <div>
                  <Label htmlFor="reminder">Reminder lead time (minutes)</Label>
                  <Input
                    id="reminder"
                    type="number"
                    value={newPrescription.reminder_minutes_before}
                    onChange={(event) =>
                      setNewPrescription((previous) => ({
                        ...previous,
                        reminder_minutes_before: event.target.value,
                      }))
                    }
                    placeholder="15"
                  />
                </div>

                <div>
                  <Label htmlFor="start_date">Start date</Label>
                  <Input
                    id="start_date"
                    type="date"
                    value={newPrescription.start_date}
                    onChange={(event) =>
                      setNewPrescription((previous) => ({
                        ...previous,
                        start_date: event.target.value,
                      }))
                    }
                  />
                </div>

                <div>
                  <Label htmlFor="duration">Duration (days)</Label>
                  <Input
                    id="duration"
                    type="number"
                    value={newPrescription.duration_days}
                    onChange={(event) =>
                      setNewPrescription((previous) => ({
                        ...previous,
                        duration_days: event.target.value,
                      }))
                    }
                    placeholder="Optional"
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="instructions">Instructions</Label>
                <Textarea
                  id="instructions"
                  value={newPrescription.instructions}
                  onChange={(event) =>
                    setNewPrescription((previous) => ({
                      ...previous,
                      instructions: event.target.value,
                    }))
                  }
                  placeholder="Take after breakfast. Watch for dizziness."
                />
              </div>

              <DialogFooter>
                <Button onClick={createPrescription}>Create prescription</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid gap-4">
        {prescriptions.map((prescription) => (
          <Card key={prescription.id} className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Pill className="h-4 w-4 text-primary" />
                  <span className="font-semibold">{prescription.medication.name}</span>
                  <Badge variant="outline">{prescription.dosage}</Badge>
                  <Badge variant="outline">{prescription.frequency}</Badge>
                  <Badge variant={prescription.is_active ? "default" : "secondary"}>
                    {prescription.is_active ? "Active" : "Paused"}
                  </Badge>
                </div>

                <p className="text-sm text-muted-foreground">
                  Patient: {prescription.patient_name}
                </p>

                <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Clock3 className="h-4 w-4" />
                    {prescription.dose_times.join(", ")}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <BellRing className="h-4 w-4" />
                    Remind {prescription.reminder_minutes_before} min early
                  </span>
                </div>

                <p className="text-sm text-muted-foreground">
                  Started: {format(new Date(prescription.start_date), "PPP")}
                  {prescription.end_date
                    ? ` • Ends: ${format(new Date(prescription.end_date), "PPP")}`
                    : ""}
                </p>

                {prescription.instructions ? (
                  <p className="text-sm text-muted-foreground">
                    Instructions: {prescription.instructions}
                  </p>
                ) : null}
              </div>

              <Button
                variant={prescription.is_active ? "outline" : "default"}
                onClick={() => togglePrescription(prescription)}
              >
                {prescription.is_active ? "Pause" : "Resume"}
              </Button>
            </div>
          </Card>
        ))}
      </div>

      {prescriptions.length === 0 && (
        <Card className="p-8 text-center">
          <Pill className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
          <h3 className="mb-2 text-lg font-semibold">No prescriptions yet</h3>
          <p className="text-muted-foreground">
            Add medications to the catalog and create reminder-based prescriptions for
            your assigned patients.
          </p>
        </Card>
      )}
    </div>
  );
};
