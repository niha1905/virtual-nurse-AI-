import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";

type AssignmentRole = "doctor" | "caregiver";
type RpcRole = Database["public"]["Enums"]["app_role"];

type AssignedPatient = {
  id: string;
  full_name: string | null;
  patient_access_code: string | null;
  phone: string | null;
};

export const PatientAssignmentPanel = ({
  role,
  onChanged,
}: {
  role: AssignmentRole;
  onChanged?: () => void;
}) => {
  const { user } = useAuth();
  const [patientCode, setPatientCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [patients, setPatients] = useState<AssignedPatient[]>([]);

  const loadPatients = useCallback(async () => {
    if (!user?.id) {
      setPatients([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const column = role === "doctor" ? "assigned_doctor_id" : "assigned_caregiver_id";
    const { data, error } = await supabase
      .from("profiles")
      .select("id, full_name, patient_access_code, phone")
      .not("patient_access_code", "is", null)
      .eq(column, user?.id)
      .order("full_name");

    if (error) {
      toast.error(error.message);
    } else {
      setPatients((data || []) as AssignedPatient[]);
    }
    setLoading(false);
  }, [role, user?.id]);

  useEffect(() => {
    void loadPatients();
  }, [loadPatients]);

  const claimPatient = async () => {
    if (!patientCode.trim()) return;
    setSubmitting(true);
    const { error } = await supabase.rpc("claim_patient_by_code", {
      _patient_access_code: patientCode.trim().toUpperCase(),
      _role: role as RpcRole,
    });
    setSubmitting(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success(`Patient assigned to this ${role}`);
    setPatientCode("");
    await loadPatients();
    onChanged?.();
  };

  const releasePatient = async (patientId: string) => {
    setSubmitting(true);
    const { error } = await supabase.rpc("release_patient_assignment", {
      _patient_id: patientId,
      _role: role as RpcRole,
    });
    setSubmitting(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success("Patient removed from your dashboard");
    await loadPatients();
    onChanged?.();
  };

  return (
    <Card className="gradient-card p-6 shadow-soft">
      <div className="mb-4">
        <h2 className="text-lg font-semibold">Patient assignment</h2>
        <p className="text-sm text-muted-foreground">
          Enter the patient care number to take charge and view live details. Remove
          them when the case is complete.
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Label htmlFor={`${role}-patient-code`}>Patient care number</Label>
          <Input
            id={`${role}-patient-code`}
            value={patientCode}
            onChange={(event) => setPatientCode(event.target.value.toUpperCase())}
            placeholder="PT-1234ABCD"
          />
        </div>
        <Button
          onClick={claimPatient}
          disabled={submitting || !patientCode.trim()}
          className="gradient-primary text-primary-foreground"
        >
          {submitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Updating...
            </>
          ) : (
            <>
              <UserPlus className="mr-2 h-4 w-4" />
              Add patient
            </>
          )}
        </Button>
      </div>

      <div className="mt-5 space-y-3">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading assigned patients...</p>
        ) : patients.length === 0 ? (
          <p className="rounded-lg bg-muted/40 p-4 text-sm text-muted-foreground">
            No patients assigned yet.
          </p>
        ) : (
          patients.map((patient) => (
            <div
              key={patient.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/70 p-4"
            >
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{patient.full_name || "Patient"}</span>
                  {patient.patient_access_code ? (
                    <Badge variant="secondary">{patient.patient_access_code}</Badge>
                  ) : null}
                </div>
                {patient.phone ? (
                  <p className="text-sm text-muted-foreground">{patient.phone}</p>
                ) : null}
              </div>
              <Button
                variant="outline"
                onClick={() => releasePatient(patient.id)}
                disabled={submitting}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Remove
              </Button>
            </div>
          ))
        )}
      </div>
    </Card>
  );
};
