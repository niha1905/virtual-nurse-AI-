import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";

export const SOSButton = () => {
  const { session } = useAuth();
  const [busy, setBusy] = useState(false);

  const trigger = async () => {
    if (!session) return;
    setBusy(true);
    // Arm the 40-second emergency alarm. EmergencyAlarm picks this up via realtime
    // and starts the siren on patient + caregiver + doctor screens.
    const autoEscalateAt = new Date(Date.now() + 40_000).toISOString();
    const { error } = await supabase.from("alerts").insert({
      patient_id: session.user.id,
      type: "MANUAL_SOS",
      message: "Patient pressed the emergency SOS button.",
      auto_escalate_at: autoEscalateAt,
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else toast.success("Emergency alarm armed — silence within 40s to cancel auto-escalation.");
  };

  return (
    <Card className="border-destructive/30 bg-destructive/5 p-6 shadow-soft">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-destructive">
          <AlertTriangle className="h-5 w-5 text-destructive-foreground" />
        </div>
        <div className="flex-1">
          <p className="font-semibold">Emergency SOS</p>
          <p className="text-xs text-muted-foreground">One tap alerts your caregiver and doctor immediately.</p>
        </div>
        <Button variant="destructive" size="lg" onClick={trigger} disabled={busy}>
          Send SOS
        </Button>
      </div>
    </Card>
  );
};
