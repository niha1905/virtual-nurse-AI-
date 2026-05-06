import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useAuth } from "@/contexts/AuthContext";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertOctagon, Loader2, Siren, VolumeX } from "lucide-react";
import { toast } from "sonner";
import { startAlarm, stopAlarm } from "@/lib/alarmSound";

type ArmedAlert = {
  id: string;
  patient_id: string;
  type: string;
  message: string | null;
  status: string;
  created_at: string;
  auto_escalate_at: string | null;
  alarm_cancelled_at: string | null;
  alarm_cancelled_by: string | null;
};

type DoctorAssignment = Pick<Database["public"]["Tables"]["profiles"]["Row"], "assigned_doctor_id">;

const COUNTDOWN_TYPES = new Set(["MANUAL_SOS", "FALL", "COUGH"]);

/**
 * Listens for armed emergency alerts (status NEW + auto_escalate_at in the future)
 * and presents a full-screen blaring alarm with a 40s cancel countdown.
 * Visible to patient, caregiver, and doctor — anyone in the loop can silence it.
 * If the timer expires without cancellation, the alert is auto-escalated.
 */
export const EmergencyAlarm = () => {
  const { user, roles } = useAuth();
  const [armed, setArmed] = useState<ArmedAlert | null>(null);
  const [now, setNow] = useState(Date.now());
  const [silencing, setSilencing] = useState(false);
  const escalatingRef = useRef<string | null>(null);

  const isPatient = roles.includes("patient");
  const isCaregiver = roles.includes("caregiver");
  const isDoctor = roles.includes("doctor");

  const fetchArmed = async () => {
    if (!user) return;
    let query = supabase
      .from("alerts")
      .select(
        "id, patient_id, type, message, status, created_at, auto_escalate_at, alarm_cancelled_at, alarm_cancelled_by",
      )
      .eq("status", "NEW")
      .is("alarm_cancelled_at", null)
      .not("auto_escalate_at", "is", null)
      .order("created_at", { ascending: false })
      .limit(1);

    // Patients only see their own armed alerts. Caregivers and doctors see
    // all alerts they have RLS access to (assigned patients / all patients).
    if (isPatient && !isCaregiver && !isDoctor) {
      query = query.eq("patient_id", user.id);
    }

    const { data } = await query.maybeSingle();
    const a = data as ArmedAlert | null;
    if (!a) {
      setArmed(null);
      return;
    }
    if (!COUNTDOWN_TYPES.has(a.type)) {
      setArmed(null);
      return;
    }
    setArmed(a);
  };

  // Subscribe to realtime updates
  useEffect(() => {
    if (!user) return;
    fetchArmed();
    const ch = supabase
      .channel("armed-alarm-stream")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "alerts" },
        () => fetchArmed(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, isPatient, isCaregiver, isDoctor]);

  // Tick the countdown
  useEffect(() => {
    if (!armed) return;
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(t);
  }, [armed]);

  // Drive the alarm sound from armed state
  useEffect(() => {
    if (armed) {
      try {
        startAlarm();
      } catch (e) {
        console.error("Could not start alarm sound:", e);
      }
    } else {
      stopAlarm();
    }
    return () => {
      // safety: stop on unmount
      stopAlarm();
    };
  }, [armed]);

  const remainingMs = useMemo(() => {
    if (!armed?.auto_escalate_at) return 0;
    return Math.max(0, new Date(armed.auto_escalate_at).getTime() - now);
  }, [armed, now]);

  const totalMs = useMemo(() => {
    if (!armed?.auto_escalate_at) return 1;
    const total = new Date(armed.auto_escalate_at).getTime() - new Date(armed.created_at).getTime();
    return Math.max(1, total);
  }, [armed]);

  // Auto-escalate when the countdown runs out
  useEffect(() => {
    if (!armed || !user) return;
    if (remainingMs > 0) return;
    if (escalatingRef.current === armed.id) return;
    escalatingRef.current = armed.id;

    (async () => {
      // Only the patient (alarm origin) drives the auto-escalation insert when
      // possible, but caregivers/doctors can also do it — RLS allows them to
      // create escalations for assigned patients.
      const { data: prof } = await supabase
        .from("profiles")
        .select("assigned_doctor_id")
        .eq("id", armed.patient_id)
        .maybeSingle();

      const { error: insErr } = await supabase.from("alert_escalations").insert({
        alert_id: armed.id,
        patient_id: armed.patient_id,
        escalated_by: user.id,
        escalated_to: (prof as DoctorAssignment | null)?.assigned_doctor_id ?? null,
        reason: `Auto-escalated: alarm not silenced within 40s for ${armed.type}.`,
      });

      if (insErr) {
        console.error("auto-escalation insert failed:", insErr);
        // allow retry by clearing ref
        escalatingRef.current = null;
        return;
      }

      const { error: updErr } = await supabase
        .from("alerts")
        .update({
          status: "ESCALATED",
          alarm_cancelled_at: new Date().toISOString(),
          alarm_cancelled_by: user.id,
        })
        .eq("id", armed.id);

      if (updErr) console.error("auto-escalation status update failed:", updErr);
      stopAlarm();
      toast.error("Emergency auto-escalated to doctor — no one silenced the alarm.");
    })();
  }, [armed, remainingMs, user]);

  const silence = async () => {
    if (!armed || !user) return;
    setSilencing(true);
    const { error } = await supabase
      .from("alerts")
      .update({
        alarm_cancelled_at: new Date().toISOString(),
        alarm_cancelled_by: user.id,
      })
      .eq("id", armed.id);
    setSilencing(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    stopAlarm();
    toast.success("Alarm silenced. Alert remains active for follow-up.");
  };

  if (!armed) return null;

  const seconds = Math.ceil(remainingMs / 1000);
  const progressPct = Math.min(100, ((totalMs - remainingMs) / totalMs) * 100);

  return (
    <Dialog open onOpenChange={() => { /* not dismissible without action */ }}>
      <DialogContent className="max-w-md border-destructive/60 bg-destructive/10 p-0 [&>button]:hidden">
        <div className="flex flex-col items-center gap-4 p-6 text-center">
          <div className="relative">
            <div className="absolute inset-0 animate-ping rounded-full bg-destructive/40" />
            <div className="relative flex h-20 w-20 items-center justify-center rounded-full bg-destructive shadow-lg">
              <Siren className="h-10 w-10 text-destructive-foreground" />
            </div>
          </div>

          <div>
            <h2 className="text-2xl font-bold text-destructive">Emergency alarm</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">{armed.type}</span>{" "}
              detected. Auto-escalating to the doctor in
            </p>
          </div>

          <div
            className="text-7xl font-extrabold tabular-nums text-destructive"
            aria-live="polite"
          >
            {seconds}s
          </div>

          {/* Countdown bar */}
          <div className="h-2 w-full overflow-hidden rounded-full bg-destructive/20">
            <div
              className="h-full rounded-full bg-destructive transition-[width] duration-200"
              style={{ width: `${progressPct}%` }}
            />
          </div>

          <p className="rounded-md border border-border/50 bg-background/60 px-3 py-2 text-sm">
            {armed.message || "No additional details."}
          </p>

          <Button
            size="lg"
            variant="destructive"
            onClick={silence}
            disabled={silencing}
            className="w-full text-base font-semibold"
          >
            {silencing ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" /> Silencing…
              </>
            ) : (
              <>
                <VolumeX className="h-5 w-5" /> Silence alarm — I’m on it
              </>
            )}
          </Button>

          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <AlertOctagon className="h-3 w-3" />
            If not silenced, the doctor will be paged automatically.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
};
