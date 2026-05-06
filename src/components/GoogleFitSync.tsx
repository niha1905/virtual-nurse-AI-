import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Activity, CheckCircle2, Loader2, RefreshCw, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatDistanceToNow } from "date-fns";

type Props = {
  onSynced?: () => void;
};

// Simulated Google Fit reading. In production this would come from the
// Google Fit REST API (deprecated 2025) or Health Connect on Android.
const generateMockReading = () => {
  const heart_rate = Math.round(64 + Math.random() * 26); // 64-90
  const spo2 = Math.round(95 + Math.random() * 4); // 95-99
  const systolic_bp = Math.round(110 + Math.random() * 22); // 110-132
  const diastolic_bp = Math.round(70 + Math.random() * 15); // 70-85
  const temperature_c = Number((36.4 + Math.random() * 0.7).toFixed(1)); // 36.4-37.1
  const steps = Math.round(500 + Math.random() * 4500);
  return { heart_rate, spo2, systolic_bp, diastolic_bp, temperature_c, steps };
};

export const GoogleFitSync = ({ onSynced }: Props) => {
  const { user } = useAuth();
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [lastReading, setLastReading] = useState<ReturnType<typeof generateMockReading> | null>(null);
  const autoRanRef = useRef(false);

  const sync = async (silent = false) => {
    if (!user) return;
    setSyncing(true);
    try {
      // Simulate Fit API latency
      await new Promise((r) => setTimeout(r, 700));
      const reading = generateMockReading();

      const { error } = await supabase.from("health_data").insert({
        patient_id: user.id,
        heart_rate: reading.heart_rate,
        spo2: reading.spo2,
        systolic_bp: reading.systolic_bp,
        diastolic_bp: reading.diastolic_bp,
        temperature_c: reading.temperature_c,
        activity_level: reading.steps > 3000 ? "active" : "resting",
        notes: `Imported from Google Fit (mock) · ${reading.steps} steps today`,
      });

      if (error) {
        if (!silent) toast.error(error.message);
        return;
      }
      setLastReading(reading);
      setLastSync(new Date());
      if (!silent) toast.success("Synced latest vitals from Google Fit");
      onSynced?.();
    } finally {
      setSyncing(false);
    }
  };

  // Auto-sync on dashboard load (once per mount)
  useEffect(() => {
    if (!user || autoRanRef.current) return;
    autoRanRef.current = true;
    void sync(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  return (
    <Card className="gradient-card p-6 shadow-soft">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl gradient-primary">
            <Smartphone className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <h3 className="text-lg font-semibold">Google Fit</h3>
            <p className="text-xs text-muted-foreground">
              Wearable & phone vitals — auto-synced when you open the dashboard.
            </p>
          </div>
        </div>
        <Badge variant="outline" className="border-primary/40 text-primary">
          Mock data
        </Badge>
      </div>

      <div className="mb-4 flex items-center gap-2 text-xs text-muted-foreground">
        {lastSync ? (
          <>
            <CheckCircle2 className="h-3.5 w-3.5 text-success" />
            Last sync {formatDistanceToNow(lastSync)} ago
          </>
        ) : (
          <>
            <Activity className="h-3.5 w-3.5" />
            Not synced yet
          </>
        )}
      </div>

      {lastReading && (
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Stat label="Heart rate" value={`${lastReading.heart_rate} bpm`} />
          <Stat label="SpO₂" value={`${lastReading.spo2}%`} />
          <Stat
            label="BP"
            value={`${lastReading.systolic_bp}/${lastReading.diastolic_bp}`}
          />
          <Stat label="Temp" value={`${lastReading.temperature_c} °C`} />
          <Stat label="Steps" value={lastReading.steps.toLocaleString()} />
          <Stat
            label="Activity"
            value={lastReading.steps > 3000 ? "Active" : "Resting"}
          />
        </div>
      )}

      <Button
        onClick={() => void sync(false)}
        disabled={syncing}
        variant="outline"
        className="w-full"
      >
        {syncing ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Syncing…
          </>
        ) : (
          <>
            <RefreshCw className="h-4 w-4" /> Sync now
          </>
        )}
      </Button>
    </Card>
  );
};

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-lg border border-border/60 bg-background/60 px-3 py-2">
    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
      {label}
    </div>
    <div className="text-sm font-semibold">{value}</div>
  </div>
);
