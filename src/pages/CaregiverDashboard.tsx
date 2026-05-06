import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useAuth } from "@/contexts/AuthContext";
import { AppHeader } from "@/components/AppHeader";
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
} from "@/components/ui/dialog";
import {
  ArrowUpRight,
  Bell,
  CheckCircle2,
  History,
  Loader2,
  ShieldCheck,
  Stethoscope,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow, format } from "date-fns";
import { MedicationAdmin } from "@/components/MedicationAdmin";
import { ActivityTracker } from "@/components/ActivityTracker";
import { PatientAssignmentPanel } from "@/components/PatientAssignmentPanel";

type Alert = {
  id: string;
  patient_id: string;
  type: string;
  status: string;
  message: string | null;
  created_at: string;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
};

type Escalation = {
  id: string;
  alert_id: string;
  patient_id: string;
  escalated_by: string;
  escalated_to: string | null;
  reason: string;
  created_at: string;
};

type ProfileSummary = Pick<
  Database["public"]["Tables"]["profiles"]["Row"],
  "id" | "full_name" | "assigned_doctor_id"
>;

const typeColor = (t: string) =>
  t === "FALL" || t === "HIGH_RISK" || t === "MANUAL_SOS" || t === "HELP"
    ? "bg-destructive text-destructive-foreground"
    : "bg-warning text-warning-foreground";

type StatusMeta = {
  label: string;
  className: string;
  dotClassName: string;
};

const statusMeta = (status: string): StatusMeta => {
  switch (status) {
    case "NEW":
      return {
        label: "New",
        className: "bg-destructive/15 text-destructive border-destructive/40",
        dotClassName: "bg-destructive animate-pulse",
      };
    case "ESCALATED":
      return {
        label: "Pending Doctor Ack",
        className: "bg-warning/15 text-warning-foreground border-warning/50",
        dotClassName: "bg-warning animate-pulse",
      };
    case "ACKNOWLEDGED":
      return {
        label: "Acknowledged",
        className: "bg-success/15 text-success border-success/40",
        dotClassName: "bg-success",
      };
    case "RESOLVED":
      return {
        label: "Resolved",
        className: "bg-muted text-muted-foreground border-border",
        dotClassName: "bg-muted-foreground",
      };
    default:
      return {
        label: status,
        className: "bg-muted text-muted-foreground border-border",
        dotClassName: "bg-muted-foreground",
      };
  }
};

const StatusPill = ({ status }: { status: string }) => {
  const meta = statusMeta(status);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${meta.className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dotClassName}`} />
      {meta.label}
    </span>
  );
};

const CaregiverDashboard = () => {
  const { user } = useAuth();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [escalations, setEscalations] = useState<Escalation[]>([]);
  const [acking, setAcking] = useState<string | null>(null);
  const [nameMap, setNameMap] = useState<Record<string, string>>({});
  const [escalateTarget, setEscalateTarget] = useState<Alert | null>(null);
  const [reason, setReason] = useState("");
  const [escalating, setEscalating] = useState(false);

  const load = useCallback(async () => {
    const [{ data: aData, error: aErr }, { data: eData, error: eErr }] =
      await Promise.all([
        supabase
          .from("alerts")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(50),
        supabase
          .from("alert_escalations")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(100),
      ]);
    if (aErr) toast.error(aErr.message);
    if (eErr) toast.error(eErr.message);
    const list = (aData || []) as Alert[];
    const escList = (eData || []) as Escalation[];
    setAlerts(list);
    setEscalations(escList);

    // Resolve names for ack + escalation actors
    const ids = Array.from(
      new Set(
        [
          ...list.map((a: Alert) => a.acknowledged_by),
          ...escList.map((e: Escalation) => e.escalated_by),
        ].filter(Boolean) as string[],
      ),
    );
    const missing = ids.filter((id) => !nameMap[id]);
    if (missing.length) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", missing);
      if (profs) {
        setNameMap((prev) => {
          const next = { ...prev };
          for (const p of profs as ProfileSummary[]) next[p.id] = p.full_name || "Care team";
          return next;
        });
      }
    }
  }, [nameMap]);

  useEffect(() => {
    void load();
    const ch = supabase
      .channel("alerts-stream")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "alerts" },
        () => void load(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "alert_escalations" },
        () => void load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [load]);

  const ack = async (id: string) => {
    if (!user) return;
    setAcking(id);
    const { error } = await supabase
      .from("alerts")
      .update({
        status: "ACKNOWLEDGED",
        acknowledged_at: new Date().toISOString(),
        acknowledged_by: user.id,
      })
      .eq("id", id);
    setAcking(null);
    if (error) toast.error(error.message);
    else toast.success("Alert acknowledged");
  };

  const openEscalate = (a: Alert) => {
    setEscalateTarget(a);
    setReason("");
  };

  const submitEscalation = async () => {
    if (!user || !escalateTarget) return;
    if (reason.trim().length < 3) {
      toast.error("Please provide a reason (at least 3 characters)");
      return;
    }
    setEscalating(true);

    // Look up assigned doctor for this patient (if any)
    const { data: prof } = await supabase
      .from("profiles")
      .select("assigned_doctor_id")
      .eq("id", escalateTarget.patient_id)
      .maybeSingle();

    const { error: insertErr } = await supabase
      .from("alert_escalations")
      .insert({
        alert_id: escalateTarget.id,
        patient_id: escalateTarget.patient_id,
        escalated_by: user.id,
        escalated_to: (prof as ProfileSummary | null)?.assigned_doctor_id ?? null,
        reason: reason.trim(),
      });

    if (insertErr) {
      setEscalating(false);
      toast.error(insertErr.message);
      return;
    }

    // Mark the alert as ESCALATED
    const { error: updErr } = await supabase
      .from("alerts")
      .update({ status: "ESCALATED" })
      .eq("id", escalateTarget.id);

    setEscalating(false);
    if (updErr) toast.error(updErr.message);
    else {
      toast.success("Escalated to doctor");
      setEscalateTarget(null);
      setReason("");
    }
  };

  const escalationsByAlert = escalations.reduce<Record<string, Escalation[]>>(
    (acc, e) => {
      (acc[e.alert_id] ||= []).push(e);
      return acc;
    },
    {},
  );

  const activeAlerts = alerts.filter(
    (a) => a.status === "NEW" || a.status === "ESCALATED",
  );
  const handled = alerts.filter(
    (a) => a.status !== "NEW" && a.status !== "ESCALATED",
  );

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="container space-y-6 py-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Caregiver dashboard</h1>
          <p className="text-muted-foreground">
            Live alerts from your patients. Acknowledge or escalate to a doctor.
          </p>
        </div>

        <PatientAssignmentPanel role="caregiver" onChanged={load} />

        <Section title={`Active alerts (${activeAlerts.length})`} icon={Bell}>
          {activeAlerts.length === 0 ? (
            <Empty text="All clear — no new alerts." />
          ) : (
            <div className="space-y-3">
              {activeAlerts.map((a) => (
                <AlertRow
                  key={a.id}
                  alert={a}
                  busy={acking === a.id}
                  onAck={() => ack(a.id)}
                  onEscalate={() => openEscalate(a)}
                />
              ))}
            </div>
          )}
        </Section>

        <MedicationAdmin />

        <ActivityTracker mode="caregiver" />

        <Section title="Recent activity" icon={CheckCircle2}>
          {handled.length === 0 ? (
            <Empty text="Nothing here yet." />
          ) : (
            <div className="space-y-2">
              {handled.slice(0, 20).map((a) => (
                <div
                  key={a.id}
                  className="space-y-2 rounded-lg border border-border/60 bg-card px-4 py-3 text-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-md px-2 py-0.5 text-xs font-medium ${typeColor(a.type)}`}
                      >
                        {a.type}
                      </span>
                      <StatusPill status={a.status} />
                      <span className="text-muted-foreground">
                        {a.message?.slice(0, 70)}
                      </span>
                    </div>
                    <div className="text-right">
                      {a.acknowledged_by && a.acknowledged_at && (
                        <div className="flex items-center gap-1 text-xs text-success">
                          <ShieldCheck className="h-3 w-3" />
                          {nameMap[a.acknowledged_by] ??
                            (a.acknowledged_by === user?.id ? "You" : "Care team")}
                          {" · "}
                          {formatDistanceToNow(new Date(a.acknowledged_at))} ago
                        </div>
                      )}
                      <div className="text-[10px] text-muted-foreground">
                        raised {formatDistanceToNow(new Date(a.created_at))} ago
                      </div>
                    </div>
                  </div>

                  {escalationsByAlert[a.id]?.length ? (
                    <div className="ml-1 space-y-1.5 border-l-2 border-destructive/40 pl-3">
                      <div className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                        <History className="h-3 w-3" />
                        Escalation trail
                      </div>
                      {escalationsByAlert[a.id].map((e) => (
                        <div
                          key={e.id}
                          className="rounded-md bg-destructive/5 p-2 text-xs"
                        >
                          <div className="flex items-center gap-1.5 font-medium">
                            <Stethoscope className="h-3 w-3 text-destructive" />
                            <span>
                              {nameMap[e.escalated_by] ??
                                (e.escalated_by === user?.id ? "You" : "Caregiver")}
                            </span>
                            <span className="text-muted-foreground">
                              escalated to doctor
                            </span>
                          </div>
                          <div className="mt-0.5 text-muted-foreground">
                            “{e.reason}”
                          </div>
                          <div className="mt-0.5 text-[10px] text-muted-foreground">
                            {format(new Date(e.created_at), "MMM d, p")} ·{" "}
                            {formatDistanceToNow(new Date(e.created_at))} ago
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </Section>
      </main>

      <Dialog
        open={!!escalateTarget}
        onOpenChange={(o) => !o && !escalating && setEscalateTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Stethoscope className="h-5 w-5 text-destructive" />
              Escalate to doctor
            </DialogTitle>
            <DialogDescription>
              This will be recorded in the audit trail with your name and the time.
              Provide a brief reason for escalating.
            </DialogDescription>
          </DialogHeader>
          {escalateTarget && (
            <div className="rounded-md border border-border/60 bg-muted/30 p-3 text-sm">
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-md px-2 py-0.5 text-xs font-bold ${typeColor(escalateTarget.type)}`}
                >
                  {escalateTarget.type}
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(escalateTarget.created_at))} ago
                </span>
              </div>
              <p className="mt-1 text-muted-foreground">
                {escalateTarget.message || "No message"}
              </p>
            </div>
          )}
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Patient unresponsive after fall — needs immediate review."
            rows={4}
          />
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setEscalateTarget(null)}
              disabled={escalating}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={submitEscalation}
              disabled={escalating}
            >
              {escalating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Escalating…
                </>
              ) : (
                <>
                  <ArrowUpRight className="h-4 w-4" /> Escalate
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

const Section = ({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: LucideIcon;
  children: React.ReactNode;
}) => (
  <Card className="gradient-card p-6 shadow-soft">
    <div className="mb-4 flex items-center gap-2">
      <Icon className="h-5 w-5 text-primary" />
      <h2 className="text-lg font-semibold">{title}</h2>
    </div>
    {children}
  </Card>
);

const Empty = ({ text }: { text: string }) => (
  <p className="rounded-lg bg-muted/40 p-6 text-center text-sm text-muted-foreground">
    {text}
  </p>
);

const AlertRow = ({
  alert,
  onAck,
  onEscalate,
  busy,
}: {
  alert: Alert;
  onAck: () => void;
  onEscalate: () => void;
  busy: boolean;
}) => (
  <div
    className={`flex flex-wrap items-start justify-between gap-3 rounded-xl border p-4 animate-fade-in-up ${
      alert.status === "ESCALATED"
        ? "border-warning/40 bg-warning/5"
        : "border-destructive/30 bg-destructive/5"
    }`}
  >
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded-md px-2 py-0.5 text-xs font-bold ${typeColor(alert.type)}`}
        >
          {alert.type}
        </span>
        <StatusPill status={alert.status} />
        <span className="text-xs text-muted-foreground">
          {formatDistanceToNow(new Date(alert.created_at))} ago
        </span>
      </div>
      <p className="mt-1.5 text-sm">{alert.message || "No message"}</p>
    </div>
    <div className="flex flex-wrap gap-2">
      {alert.status !== "ESCALATED" && (
        <Button
          onClick={onEscalate}
          size="sm"
          variant="outline"
          disabled={busy}
          className="border-destructive/40 text-destructive hover:bg-destructive/10"
        >
          <ArrowUpRight className="h-4 w-4" /> Escalate
        </Button>
      )}
      <Button
        onClick={onAck}
        size="sm"
        disabled={busy}
        className="gradient-primary text-primary-foreground"
      >
        {busy ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Acknowledging…
          </>
        ) : (
          <>
            <ShieldCheck className="h-4 w-4" /> Acknowledge
          </>
        )}
      </Button>
    </div>
  </div>
);

export default CaregiverDashboard;
