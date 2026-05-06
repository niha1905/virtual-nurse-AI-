import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Activity,
  AlertTriangle,
  Bed,
  Bike,
  Footprints,
  HeartPulse,
  Plus,
  RefreshCcw,
  Salad,
  ShieldCheck,
  ShoppingBag,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { computeDerivedFeatures, type PatientVitals } from "@/lib/riskAnalysisService";
import {
  getMissingFeatureMessage,
  isMissingSupabaseRelation,
  isRememberedMissingFeature,
  rememberMissingFeature,
} from "@/lib/supabaseErrors";

type TrackerMode = "patient" | "caregiver" | "doctor";
type SimulatedRiskLevel = "LOW" | "HIGH";

interface PatientActivity {
  id: string;
  patient_id: string;
  activity_type: string;
  description?: string | null;
  duration_minutes?: number | null;
  recorded_at: string;
  recorded_by?: string | null;
  patient_name?: string;
}

interface SimulatedRisk {
  level: SimulatedRiskLevel;
  score: number;
  summary: string;
  details: string;
  activityType: string;
  durationMinutes: number;
  vitals: PatientVitals;
  derived: PatientVitals;
  alertSent: boolean;
  savedVitals: boolean;
  savedActivity: boolean;
}

const ACTIVITY_TYPES = [
  "walking",
  "exercise",
  "eating",
  "sleeping",
  "housework",
  "shopping",
  "socializing",
  "reading",
  "watching_tv",
  "other",
];

const RISK_SCENARIOS: Record<
  SimulatedRiskLevel,
  {
    score: number;
    activityType: string;
    durationMinutes: number;
    activityDescription: string;
    vitals: PatientVitals;
  }
> = {
  LOW: {
    score: 18,
    activityType: "walking",
    durationMinutes: 35,
    activityDescription:
      "Simulated low-risk day: steady walk, normal oxygen, stable blood pressure, no alert events.",
    vitals: {
      heart_rate: 74,
      systolic_bp: 122,
      diastolic_bp: 78,
      spo2: 98,
      temperature_c: 36.7,
      steps_24h: 6200,
      active_minutes_24h: 58,
      fall_alerts_24h: 0,
      cough_alerts_24h: 0,
      help_alerts_24h: 0,
      manual_sos_alerts_7d: 0,
      high_risk_alerts_7d: 0,
      activity_level: "active",
    },
  },
  HIGH: {
    score: 92,
    activityType: "sleeping",
    durationMinutes: 480,
    activityDescription:
      "Simulated high-risk deterioration: bed-bound pattern, low oxygen, fever, tachycardia, low blood pressure, and repeated help/fall signals.",
    vitals: {
      heart_rate: 118,
      systolic_bp: 86,
      diastolic_bp: 55,
      spo2: 88,
      temperature_c: 38.6,
      steps_24h: 240,
      active_minutes_24h: 6,
      fall_alerts_24h: 1,
      cough_alerts_24h: 3,
      help_alerts_24h: 2,
      manual_sos_alerts_7d: 1,
      high_risk_alerts_7d: 2,
      activity_level: "bedbound",
    },
  },
};

const getActivityIcon = (type: string) => {
  switch (type) {
    case "walking":
      return <Footprints className="h-5 w-5 text-primary" />;
    case "exercise":
      return <HeartPulse className="h-5 w-5 text-destructive" />;
    case "cycling":
      return <Bike className="h-5 w-5 text-primary" />;
    case "eating":
      return <Salad className="h-5 w-5 text-success" />;
    case "sleeping":
      return <Bed className="h-5 w-5 text-muted-foreground" />;
    case "shopping":
      return <ShoppingBag className="h-5 w-5 text-warning" />;
    case "socializing":
      return <Users className="h-5 w-5 text-primary" />;
    default:
      return <Activity className="h-5 w-5 text-primary" />;
  }
};

export const ActivityTracker = ({ mode = "patient" }: { mode?: TrackerMode }) => {
  const { session } = useAuth();
  const [activities, setActivities] = useState<PatientActivity[]>([]);
  const [patients, setPatients] = useState<Array<{ id: string; full_name: string | null }>>([]);
  const [patientNames, setPatientNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [simulatingRisk, setSimulatingRisk] = useState(false);
  const [simulatedRisk, setSimulatedRisk] = useState<SimulatedRisk | null>(null);
  const [newActivity, setNewActivity] = useState({
    patient_id: "",
    activity_type: "",
    description: "",
    duration_minutes: "",
    recorded_at: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
  });

  const loadActivities = useCallback(async () => {
    if (!session?.user?.id) return;
    setLoading(true);

    if (isRememberedMissingFeature("activity-tracking")) {
      setActivities([]);
      setLoading(false);
      return;
    }

    try {
      let scopedPatients: Array<{ id: string; full_name: string | null }> = [];
      if (mode === "patient") {
        scopedPatients = [{ id: session.user.id, full_name: "You" }];
      } else {
        const column = mode === "caregiver" ? "assigned_caregiver_id" : "assigned_doctor_id";
        const { data: assignedPatients, error: patientsError } = await supabase
          .from("profiles")
          .select("id, full_name")
          .eq(column, session.user.id)
          .order("full_name");

        if (patientsError) throw patientsError;
        scopedPatients = assignedPatients || [];
      }

      setPatients(scopedPatients);
      setPatientNames(
        Object.fromEntries(
          scopedPatients.map((patient) => [patient.id, patient.full_name || "Patient"]),
        ),
      );

      if (!scopedPatients.length) {
        setActivities([]);
        return;
      }

      const patientIds = scopedPatients.map((patient) => patient.id);
      const query =
        mode === "patient"
          ? supabase.from("patient_activities").select("*").eq("patient_id", session.user.id)
          : supabase.from("patient_activities").select("*").in("patient_id", patientIds);

      const { data, error } = await query
        .order("recorded_at", { ascending: false })
        .limit(25);

      if (error) throw error;

      setActivities(
        (data || []).map((activity) => ({
          ...activity,
          patient_name:
            mode === "patient"
              ? "You"
              : scopedPatients.find((patient) => patient.id === activity.patient_id)?.full_name ||
                "Patient",
        })),
      );

      setNewActivity((previous) => ({
        ...previous,
        patient_id:
          previous.patient_id ||
          (mode === "patient" ? session.user.id : scopedPatients[0]?.id || ""),
      }));
    } catch (error) {
      if (isMissingSupabaseRelation(error)) {
        rememberMissingFeature("activity-tracking");
        setActivities([]);
        toast.error(getMissingFeatureMessage("Activity tracking"));
      } else {
        console.error("Error loading activities:", error);
        toast.error("Failed to load activities");
      }
    } finally {
      setLoading(false);
    }
  }, [mode, session?.user?.id]);

  useEffect(() => {
    void loadActivities();
  }, [loadActivities]);

  const logActivity = async () => {
    if (!session?.user?.id) return;

    const patientId = mode === "patient" ? session.user.id : newActivity.patient_id;
    if (!patientId || !newActivity.activity_type) {
      toast.error("Choose a patient and activity type first");
      return;
    }

    try {
      const { error } = await supabase.from("patient_activities").insert({
        patient_id: patientId,
        activity_type: newActivity.activity_type,
        description: newActivity.description || null,
        duration_minutes: newActivity.duration_minutes
          ? parseInt(newActivity.duration_minutes, 10)
          : null,
        recorded_at: newActivity.recorded_at,
        recorded_by: session.user.id,
      });

      if (error) throw error;

      toast.success("Activity logged successfully");
      setNewActivity({
        patient_id: mode === "patient" ? session.user.id : patients[0]?.id || "",
        activity_type: "",
        description: "",
        duration_minutes: "",
        recorded_at: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
      });
      void loadActivities();
    } catch (error) {
      if (isMissingSupabaseRelation(error)) {
        rememberMissingFeature("activity-tracking");
        toast.error(getMissingFeatureMessage("Activity tracking"));
      } else {
        console.error("Error logging activity:", error);
        toast.error("Failed to log activity");
      }
    }
  };

  const getSimulationPatientId = () => {
    if (!session?.user?.id) return "";
    if (mode === "patient") return session.user.id;
    return newActivity.patient_id || patients[0]?.id || "";
  };

  const simulateRisk = async (level: SimulatedRiskLevel) => {
    if (!session?.user?.id) return;

    const patientId = getSimulationPatientId();
    if (!patientId) {
      toast.error("Select a patient before running the risk simulation");
      return;
    }

    const patientName =
      mode === "patient" ? "You" : patientNames[patientId] || patients[0]?.full_name || "Patient";

    const scenario = RISK_SCENARIOS[level];
    const derivedVitals = computeDerivedFeatures(scenario.vitals);
    const recordedAt = format(new Date(), "yyyy-MM-dd'T'HH:mm");
    const simulation: SimulatedRisk = {
      level,
      score: scenario.score,
      summary:
        level === "HIGH" ? "High-risk vitals simulation triggered" : "Low-risk vitals simulation complete",
      details: scenario.activityDescription,
      activityType: scenario.activityType,
      durationMinutes: scenario.durationMinutes,
      vitals: scenario.vitals,
      derived: derivedVitals,
      alertSent: false,
      savedVitals: false,
      savedActivity: false,
    };

    setNewActivity((previous) => ({
      ...previous,
      patient_id: patientId,
      activity_type: scenario.activityType,
      description: scenario.activityDescription,
      duration_minutes: String(scenario.durationMinutes),
      recorded_at: recordedAt,
    }));

    setSimulatedRisk(simulation);

    setSimulatingRisk(true);
    try {
      const { error: vitalsError } = await supabase.from("health_data").insert({
        patient_id: patientId,
        heart_rate: scenario.vitals.heart_rate ?? null,
        systolic_bp: scenario.vitals.systolic_bp ?? null,
        diastolic_bp: scenario.vitals.diastolic_bp ?? null,
        spo2: scenario.vitals.spo2 ?? null,
        temperature_c: scenario.vitals.temperature_c ?? null,
        activity_level: scenario.vitals.activity_level ?? null,
        notes: scenario.activityDescription,
        recorded_at: new Date(recordedAt).toISOString(),
        risk_score: scenario.score,
        risk_level: level,
        risk_explanation:
          level === "HIGH"
            ? "Simulated abnormal vitals and repeated alert burden indicate high risk."
            : "Simulated vitals and activity remain within stable low-risk ranges.",
      });

      if (vitalsError) throw vitalsError;

      const { error: activityError } = await supabase.from("patient_activities").insert({
        patient_id: patientId,
        activity_type: scenario.activityType,
        description: scenario.activityDescription,
        duration_minutes: scenario.durationMinutes,
        recorded_at: recordedAt,
        recorded_by: session.user.id,
      });

      if (activityError) throw activityError;

      const persistedSimulation = {
        ...simulation,
        savedVitals: true,
        savedActivity: true,
      };

      if (level === "LOW") {
        setSimulatedRisk(persistedSimulation);
        toast.success("Low-risk vitals saved. No alert needed");
        void loadActivities();
        return;
      }

      const { error: alertError } = await supabase.from("alerts").insert({
        patient_id: patientId,
        type: "HIGH_RISK",
        message: `${patientName} triggered a simulated HIGH risk vitals alert. Risk score: ${simulation.score}%.`,
        metadata: {
          simulated: true,
          vitals: scenario.vitals,
          derived: {
            shock_index: derivedVitals.shock_index,
            spo2_deficit: derivedVitals.spo2_deficit,
            instability_index: derivedVitals.instability_index,
            event_burden_24h: derivedVitals.event_burden_24h,
            weighted_event_burden: derivedVitals.weighted_event_burden,
          },
        },
      });

      if (alertError) throw alertError;

      setSimulatedRisk({ ...persistedSimulation, alertSent: true });
      toast.error("High-risk vitals saved and alert sent to the care team");
      void loadActivities();
    } catch (error) {
      if (isMissingSupabaseRelation(error)) {
        toast.error(getMissingFeatureMessage("Risk simulation"));
      } else {
        console.error("Error sending simulated risk alert:", error);
        toast.error("Risk simulation ran, but it could not be saved completely");
      }
    } finally {
      setSimulatingRisk(false);
    }
  };

  const title =
    mode === "patient"
      ? "Activity tracker"
      : mode === "caregiver"
        ? "Patient activities"
        : "Activity overview";

  const description =
    mode === "patient"
      ? "Track daily routines that matter to your care team."
      : mode === "caregiver"
        ? "Log and review what your assigned patients are doing each day."
        : "Monitor recent patient activities shared with the care team.";

  const canLog = mode !== "doctor";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">{title}</h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <Button onClick={loadActivities} variant="outline" size="sm">
          <RefreshCcw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      {canLog && (
        <Card className="p-6">
          <h3 className="mb-4 text-lg font-semibold">
            {mode === "patient" ? "Log your activity" : "Log activity for a patient"}
          </h3>

          <div className="grid gap-4 md:grid-cols-2">
            {mode === "caregiver" && (
              <div>
                <Label htmlFor="patient_id">Patient</Label>
                <Select
                  value={newActivity.patient_id}
                  onValueChange={(value) =>
                    setNewActivity((previous) => ({ ...previous, patient_id: value }))
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
            )}

            <div>
              <Label htmlFor="activity_type">Activity type</Label>
              <Select
                value={newActivity.activity_type}
                onValueChange={(value) =>
                  setNewActivity((previous) => ({ ...previous, activity_type: value }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select activity type" />
                </SelectTrigger>
                <SelectContent>
                  {ACTIVITY_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type.replace("_", " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="duration">Duration (minutes)</Label>
              <Input
                id="duration"
                type="number"
                value={newActivity.duration_minutes}
                onChange={(event) =>
                  setNewActivity((previous) => ({
                    ...previous,
                    duration_minutes: event.target.value,
                  }))
                }
                placeholder="Optional"
              />
            </div>

            <div>
              <Label htmlFor="recorded_at">Date and time</Label>
              <Input
                id="recorded_at"
                type="datetime-local"
                value={newActivity.recorded_at}
                onChange={(event) =>
                  setNewActivity((previous) => ({
                    ...previous,
                    recorded_at: event.target.value,
                  }))
                }
              />
            </div>
          </div>

          <div className="mt-4">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={newActivity.description}
              onChange={(event) =>
                setNewActivity((previous) => ({ ...previous, description: event.target.value }))
              }
              placeholder="Add notes like appetite, distance walked, or mood."
              rows={3}
            />
          </div>

          <Button onClick={logActivity} className="mt-4" disabled={!newActivity.activity_type}>
            <Plus className="mr-2 h-4 w-4" />
            Log activity
          </Button>
        </Card>
      )}

      <Card className="p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h3 className="text-lg font-semibold">Risk simulation</h3>
            <p className="text-sm text-muted-foreground">
              Change vitals, activity, and recent alert burden to test low or high risk.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => simulateRisk("LOW")} disabled={simulatingRisk}>
              <ShieldCheck className="mr-2 h-4 w-4" />
              Simulate low risk
            </Button>
            <Button
              variant="destructive"
              onClick={() => simulateRisk("HIGH")}
              disabled={simulatingRisk}
            >
              <AlertTriangle className="mr-2 h-4 w-4" />
              Simulate high risk
            </Button>
          </div>
        </div>

        {simulatedRisk && (
          <Alert
            variant={simulatedRisk.level === "HIGH" ? "destructive" : "default"}
            className={
              simulatedRisk.level === "LOW"
                ? "mt-4 border-success/40 bg-success/10 text-success"
                : "mt-4"
            }
          >
            {simulatedRisk.level === "HIGH" ? (
              <AlertTriangle className="h-4 w-4" />
            ) : (
              <ShieldCheck className="h-4 w-4" />
            )}
            <AlertTitle>
              {simulatedRisk.summary} ({simulatedRisk.score}%)
            </AlertTitle>
            <AlertDescription>
              <p>{simulatedRisk.details}</p>
              <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
                <span>HR: {simulatedRisk.vitals.heart_rate} bpm</span>
                <span>
                  BP: {simulatedRisk.vitals.systolic_bp}/{simulatedRisk.vitals.diastolic_bp}
                </span>
                <span>SpO2: {simulatedRisk.vitals.spo2}%</span>
                <span>Temp: {simulatedRisk.vitals.temperature_c} C</span>
                <span>Steps: {simulatedRisk.vitals.steps_24h}</span>
                <span>Active: {simulatedRisk.vitals.active_minutes_24h} min</span>
                <span>Falls: {simulatedRisk.vitals.fall_alerts_24h}</span>
                <span>Help: {simulatedRisk.vitals.help_alerts_24h}</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge variant="outline">
                  Activity: {simulatedRisk.activityType.replace("_", " ")}
                </Badge>
                <Badge variant="outline">{simulatedRisk.durationMinutes} min</Badge>
                <Badge variant="outline">
                  Instability: {((simulatedRisk.derived.instability_index ?? 0) * 100).toFixed(0)}
                  %
                </Badge>
                <Badge variant="outline">
                  Event burden: {simulatedRisk.derived.event_burden_24h ?? 0}
                </Badge>
              </div>
              <p className="mt-1 font-medium">
                {simulatedRisk.level === "HIGH"
                  ? simulatedRisk.alertSent
                    ? "Saved vitals and activity. Alert status: sent to the care team."
                    : "Simulated high-risk vitals are loaded; alert has not been sent yet."
                  : simulatedRisk.savedVitals
                    ? "Saved low-risk vitals and activity. Alert status: not sent."
                    : "Low-risk vitals are loaded. Alert status: not sent."}
              </p>
            </AlertDescription>
          </Alert>
        )}
      </Card>

      <Card className="p-6">
        <h3 className="mb-4 text-lg font-semibold">Recent activities</h3>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading activities...</p>
        ) : activities.length === 0 ? (
          <div className="py-8 text-center">
            <Activity className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
            <h3 className="mb-2 text-lg font-semibold">No activities logged</h3>
            <p className="text-muted-foreground">
              {mode === "doctor"
                ? "Activities logged by patients or caregivers will appear here."
                : "Start tracking daily activities to support better care."}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {activities.map((activity) => (
              <div
                key={activity.id}
                className="flex items-start gap-4 rounded-lg border border-border/60 p-4"
              >
                <div className="rounded-full bg-primary/10 p-2">
                  {getActivityIcon(activity.activity_type)}
                </div>
                <div className="flex-1">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <span className="font-semibold capitalize">
                      {activity.activity_type.replace("_", " ")}
                    </span>
                    {mode !== "patient" && (
                      <Badge variant="secondary">
                        {activity.patient_name || patientNames[activity.patient_id] || "Patient"}
                      </Badge>
                    )}
                    {activity.duration_minutes ? (
                      <Badge variant="outline">{activity.duration_minutes} min</Badge>
                    ) : null}
                  </div>

                  {activity.description ? (
                    <p className="mb-2 text-sm text-muted-foreground">{activity.description}</p>
                  ) : null}

                  <p className="text-xs text-muted-foreground">
                    {format(new Date(activity.recorded_at), "PPP 'at' p")}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
};
