import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useAuth } from "@/contexts/AuthContext";
import { AppHeader } from "@/components/AppHeader";
import { NurseChat } from "@/components/NurseChat";
import { VitalsForm } from "@/components/VitalsForm";
import { SOSButton } from "@/components/SOSButton";
import { AudioEventDetector } from "@/components/AudioEventDetector";
import { GoogleFitSync } from "@/components/GoogleFitSync";
import { ActivityTracker } from "@/components/ActivityTracker";
import { MedicationSchedule } from "@/components/MedicationSchedule";
import { RiskAlert } from "@/components/RiskAlert";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Activity, Check, Copy, Heart, ThermometerSun, UserRound, Wind } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { analyzePatientRisk, computeDerivedFeatures, triggerRiskAlert } from "@/lib/riskAnalysisService";
import type { RiskAnalysisResult } from "@/components/RiskAlert";

type Vital = Database["public"]["Tables"]["health_data"]["Row"];
type ProfileRow = Pick<
  Database["public"]["Tables"]["profiles"]["Row"],
  "assigned_caregiver_id" | "assigned_doctor_id" | "patient_access_code"
>;
type CareProfile = Pick<Database["public"]["Tables"]["profiles"]["Row"], "id" | "full_name">;

const PatientDashboard = () => {
  const { user } = useAuth();
  const [latest, setLatest] = useState<Vital | null>(null);
  const [patientCode, setPatientCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [riskResult, setRiskResult] = useState<RiskAnalysisResult | null>(null);
  const [careTeam, setCareTeam] = useState({
    doctor: "Not assigned yet",
    caregiver: "Not assigned yet",
  });

  const load = useCallback(async () => {
    if (!user) return;
    const [{ data: latestVital }, { data: profile }] = await Promise.all([
      supabase
        .from("health_data")
        .select("*")
        .eq("patient_id", user.id)
        .order("recorded_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("profiles")
        .select("patient_access_code, assigned_doctor_id, assigned_caregiver_id")
        .eq("id", user.id)
        .maybeSingle(),
    ]);
    const typedProfile = profile as ProfileRow | null;
    setLatest(latestVital);
    setPatientCode(typedProfile?.patient_access_code ?? null);

    if (latestVital) {
      const rawVitals = {
        heart_rate: latestVital.heart_rate ?? undefined,
        systolic_bp: latestVital.systolic_bp ?? undefined,
        diastolic_bp: latestVital.diastolic_bp ?? undefined,
        spo2: latestVital.spo2 ?? undefined,
        temperature_c: latestVital.temperature_c ?? undefined,
        activity_level: latestVital.activity_level ?? undefined,
      };
      const derivedVitals = computeDerivedFeatures(rawVitals);
      const result = await analyzePatientRisk(derivedVitals);
      setRiskResult(result);
      if (!result.error) {
        triggerRiskAlert(result.risk_level);
      }
    } else {
      setRiskResult(null);
    }

    const assignedIds = [
      typedProfile?.assigned_doctor_id,
      typedProfile?.assigned_caregiver_id,
    ].filter(Boolean);

    if (!assignedIds.length) {
      setCareTeam({
        doctor: "Not assigned yet",
        caregiver: "Not assigned yet",
      });
      return;
    }

    const { data: members } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", assignedIds);

    const nameMap = Object.fromEntries(
      ((members ?? []) as CareProfile[]).map((member) => [member.id, member.full_name || "Care team"]),
    );

    setCareTeam({
      doctor: typedProfile?.assigned_doctor_id
        ? nameMap[typedProfile.assigned_doctor_id] || "Assigned doctor"
        : "Not assigned yet",
      caregiver: typedProfile?.assigned_caregiver_id
        ? nameMap[typedProfile.assigned_caregiver_id] || "Assigned caregiver"
        : "Not assigned yet",
    });
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const copyCareNumber = async () => {
    if (!patientCode) return;

    try {
      await navigator.clipboard.writeText(patientCode);
      setCopied(true);
      toast.success("Care number copied");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy care number");
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="container space-y-6 py-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Patient dashboard</h1>
          <p className="text-muted-foreground">Talk to Nurse Ada, log your vitals, get instant guidance.</p>
        </div>

        {riskResult && (
          <RiskAlert result={riskResult} onDismiss={() => setRiskResult(null)} />
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="gradient-card p-5 shadow-soft">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Your care number
                </p>
                <p className="mt-1 text-2xl font-bold">{patientCode || "Generating..."}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={copyCareNumber}
                disabled={!patientCode}
              >
                {copied ? (
                  <>
                    <Check className="mr-2 h-4 w-4" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="mr-2 h-4 w-4" />
                    Copy
                  </>
                )}
              </Button>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Share this number with your doctor or caregiver so they can add you to
              their dashboard and monitor your live details.
            </p>
          </Card>

          <Card className="gradient-card p-5 shadow-soft">
            <div className="mb-3 flex items-center gap-2">
              <UserRound className="h-5 w-5 text-primary" />
              <p className="text-sm font-semibold">Your care team</p>
            </div>
            <div className="space-y-3 text-sm">
              <div className="rounded-lg border border-border/60 bg-background/70 p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Doctor</p>
                <p className="mt-1 font-medium">{careTeam.doctor}</p>
              </div>
              <div className="rounded-lg border border-border/60 bg-background/70 p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Caregiver</p>
                <p className="mt-1 font-medium">{careTeam.caregiver}</p>
              </div>
            </div>
          </Card>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard icon={Heart} label="Heart rate" value={latest?.heart_rate ? `${latest.heart_rate} bpm` : "—"} />
          <StatCard icon={Wind} label="SpO₂" value={latest?.spo2 ? `${latest.spo2}%` : "—"} />
          <StatCard
            icon={Activity}
            label="Blood pressure"
            value={latest?.systolic_bp ? `${latest.systolic_bp}/${latest.diastolic_bp ?? "–"}` : "—"}
          />
          <StatCard icon={ThermometerSun} label="Temperature" value={latest?.temperature_c ? `${latest.temperature_c} °C` : "—"} />
        </div>

        <SOSButton />

        <GoogleFitSync onSynced={load} />

        <div className="grid gap-6 lg:grid-cols-2">
          <NurseChat />
          <VitalsForm onSaved={load} />
        </div>

        <AudioEventDetector />

        <div className="grid gap-6 xl:grid-cols-2">
          <MedicationSchedule />
          <ActivityTracker mode="patient" />
        </div>
      </main>
    </div>
  );
};

const StatCard = ({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) => (
  <Card className="gradient-card p-5 shadow-soft">
    <div className="flex items-center gap-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl gradient-primary">
        <Icon className="h-5 w-5 text-primary-foreground" />
      </div>
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="text-xl font-semibold">{value}</p>
      </div>
    </div>
  </Card>
);

export default PatientDashboard;
