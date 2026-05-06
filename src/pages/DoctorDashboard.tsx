import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useAuth } from "@/contexts/AuthContext";
import { AppHeader } from "@/components/AppHeader";
import { Card } from "@/components/ui/card";
import { Activity, Bell, Stethoscope, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { MedicationManagement } from "@/components/MedicationManagement";
import { ActivityTracker } from "@/components/ActivityTracker";
import { PatientAssignmentPanel } from "@/components/PatientAssignmentPanel";

type Profile = Pick<
  Database["public"]["Tables"]["profiles"]["Row"],
  "id" | "full_name" | "patient_access_code"
>;
type AlertRow = Database["public"]["Tables"]["alerts"]["Row"];
type HealthDataRow = Database["public"]["Tables"]["health_data"]["Row"];

const DoctorDashboard = () => {
  const { user } = useAuth();
  const [stats, setStats] = useState({ patients: 0, alerts: 0, highRisk: 0, vitals: 0 });
  const [assignedPatients, setAssignedPatients] = useState<Profile[]>([]);
  const [recentAlerts, setRecentAlerts] = useState<AlertRow[]>([]);
  const [recentVitals, setRecentVitals] = useState<HealthDataRow[]>([]);

  const load = useCallback(async () => {
    if (!user?.id) return;

    const { data: patients, error: patientsError } = await supabase
      .from("profiles")
      .select("id, full_name, patient_access_code")
      .eq("assigned_doctor_id", user.id)
      .order("full_name");

    if (patientsError) return;

    const patientList = (patients || []) as Profile[];
    setAssignedPatients(patientList);

    const patientIds = patientList.map((patient) => patient.id);
    if (!patientIds.length) {
      setStats({ patients: 0, alerts: 0, highRisk: 0, vitals: 0 });
      setRecentAlerts([]);
      setRecentVitals([]);
      return;
    }

    const [
      { count: alerts },
      { count: highRisk },
      { count: vitals },
      { data: recentAlertData },
      { data: recentVitalData },
    ] = await Promise.all([
      supabase
        .from("alerts")
        .select("*", { count: "exact", head: true })
        .in("patient_id", patientIds)
        .eq("status", "NEW"),
      supabase
        .from("health_data")
        .select("*", { count: "exact", head: true })
        .in("patient_id", patientIds)
        .eq("risk_level", "HIGH"),
      supabase
        .from("health_data")
        .select("*", { count: "exact", head: true })
        .in("patient_id", patientIds),
      supabase
        .from("alerts")
        .select("*")
        .in("patient_id", patientIds)
        .order("created_at", { ascending: false })
        .limit(8),
      supabase
        .from("health_data")
        .select("*")
        .in("patient_id", patientIds)
        .order("recorded_at", { ascending: false })
        .limit(8),
    ]);

    setStats({
      patients: patientList.length,
      alerts: alerts ?? 0,
      highRisk: highRisk ?? 0,
      vitals: vitals ?? 0,
    });
    setRecentAlerts(recentAlertData || []);
    setRecentVitals(recentVitalData || []);
  }, [user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="container space-y-6 py-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Doctor dashboard</h1>
          <p className="text-muted-foreground">
            Claim patients using their care number and monitor only the people under
            your responsibility.
          </p>
        </div>

        <PatientAssignmentPanel role="doctor" onChanged={load} />

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat icon={Users} label="Assigned Patients" value={stats.patients} />
          <Stat icon={Bell} label="New alerts" value={stats.alerts} accent="text-destructive" />
          <Stat icon={Stethoscope} label="High-risk readings" value={stats.highRisk} accent="text-warning" />
          <Stat icon={Activity} label="Vitals recorded" value={stats.vitals} />
        </div>

        {assignedPatients.length > 0 ? (
          <Card className="gradient-card p-6 shadow-soft">
            <h2 className="mb-4 text-lg font-semibold">Patients in your care</h2>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {assignedPatients.map((patient) => (
                <div
                  key={patient.id}
                  className="rounded-lg border border-border/60 bg-background/70 p-4"
                >
                  <p className="font-semibold">{patient.full_name || "Patient"}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Care number: {patient.patient_access_code || "Not available"}
                  </p>
                </div>
              ))}
            </div>
          </Card>
        ) : null}

        <MedicationManagement />

        <ActivityTracker mode="doctor" />

        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="gradient-card p-6 shadow-soft">
            <h2 className="mb-4 text-lg font-semibold">Recent alerts</h2>
            <ul className="space-y-2 text-sm">
              {recentAlerts.length === 0 && (
                <li className="text-muted-foreground">No alerts for your assigned patients.</li>
              )}
              {recentAlerts.map((alert) => (
                <li
                  key={alert.id}
                  className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2"
                >
                  <span>
                    <span className="mr-2 rounded bg-destructive/10 px-1.5 py-0.5 text-xs font-medium text-destructive">
                      {alert.type}
                    </span>
                    <span className="text-muted-foreground">
                      {alert.message?.slice(0, 60) || "-"}
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(alert.created_at).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          <Card className="gradient-card p-6 shadow-soft">
            <h2 className="mb-4 text-lg font-semibold">Recent vitals</h2>
            <ul className="space-y-2 text-sm">
              {recentVitals.length === 0 && (
                <li className="text-muted-foreground">No vitals recorded yet.</li>
              )}
              {recentVitals.map((vital) => (
                <li
                  key={vital.id}
                  className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2"
                >
                  <span className="text-muted-foreground">
                    HR {vital.heart_rate ?? "-"} · SpO2 {vital.spo2 ?? "-"} · BP{" "}
                    {vital.systolic_bp ?? "-"}/{vital.diastolic_bp ?? "-"}
                  </span>
                  <span
                    className={`text-xs font-semibold ${
                      vital.risk_level === "HIGH"
                        ? "text-destructive"
                        : vital.risk_level === "MEDIUM"
                          ? "text-warning"
                          : "text-success"
                    }`}
                  >
                    {vital.risk_level ?? "-"}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </main>
    </div>
  );
};

const Stat = ({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  accent?: string;
}) => (
  <Card className="gradient-card p-5 shadow-soft">
    <div className="flex items-center gap-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl gradient-primary">
        <Icon className="h-5 w-5 text-primary-foreground" />
      </div>
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className={`text-2xl font-bold ${accent ?? ""}`}>{value}</p>
      </div>
    </div>
  </Card>
);

export default DoctorDashboard;
