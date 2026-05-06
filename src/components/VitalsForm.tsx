import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { analyzePatientRisk, computeDerivedFeatures, triggerRiskAlert } from "@/lib/riskAnalysisService";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Activity, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { RiskAlert, type RiskAnalysisResult } from "@/components/RiskAlert";

type RiskAnalysisForm = {
  heart_rate: string;
  systolic_bp: string;
  diastolic_bp: string;
  spo2: string;
  temperature_c: string;
  activity_level: string;
  history: string;
  notes: string;
};

type NumericField = "heart_rate" | "systolic_bp" | "diastolic_bp" | "spo2" | "temperature_c";

const NUMERIC_FIELDS: NumericField[] = [
  "heart_rate",
  "systolic_bp",
  "diastolic_bp",
  "spo2",
  "temperature_c",
];

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Failed to analyze";

export const VitalsForm = ({ onSaved }: { onSaved?: () => void }) => {
  const [form, setForm] = useState<RiskAnalysisForm>({
    heart_rate: "",
    systolic_bp: "",
    diastolic_bp: "",
    spo2: "",
    temperature_c: "",
    activity_level: "moderate",
    history: "",
    notes: "",
  });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RiskAnalysisResult | null>(null);
  const { user } = useAuth();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const payload: Record<string, unknown> = { ...form };
      NUMERIC_FIELDS.forEach((k) => {
        const v = form[k];
        payload[k] = v === "" ? undefined : Number(v);
      });

      const rawVitals = {
        heart_rate: payload.heart_rate as number | undefined,
        systolic_bp: payload.systolic_bp as number | undefined,
        diastolic_bp: payload.diastolic_bp as number | undefined,
        spo2: payload.spo2 as number | undefined,
        temperature_c: payload.temperature_c as number | undefined,
        activity_level: payload.activity_level as string | undefined,
      };

      const derivedVitals = computeDerivedFeatures(rawVitals);
      const analysis = await analyzePatientRisk(derivedVitals);
      setResult(analysis);

      if (!analysis.error) {
        triggerRiskAlert(analysis.risk_level);
      }

      if (user && !analysis.error) {
        await supabase.from("health_data").insert({
          patient_id: user.id,
          heart_rate: rawVitals.heart_rate ?? null,
          systolic_bp: rawVitals.systolic_bp ?? null,
          diastolic_bp: rawVitals.diastolic_bp ?? null,
          spo2: rawVitals.spo2 ?? null,
          temperature_c: rawVitals.temperature_c ?? null,
          activity_level: rawVitals.activity_level ?? null,
          notes: form.notes || null,
          risk_score: Math.round((analysis.confidence ?? 0) * 100),
          risk_level: analysis.risk_level,
          risk_explanation: analysis.explanation,
        });
      }

      if (!analysis.error) {
        toast.success(`Risk: ${analysis.risk_level} (${(analysis.confidence * 100).toFixed(0)}%)`);
      }
      onSaved?.();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="gradient-card p-6 shadow-soft">
      <div className="mb-4 flex items-center gap-2">
        <Activity className="h-5 w-5 text-primary" />
        <h3 className="text-lg font-semibold">Log vitals & analyze risk</h3>
      </div>
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Heart rate (bpm)" id="hr">
          <Input id="hr" type="number" value={form.heart_rate} onChange={(e) => setForm({ ...form, heart_rate: e.target.value })} placeholder="72" />
        </Field>
        <Field label="SpO₂ (%)" id="spo2">
          <Input id="spo2" type="number" value={form.spo2} onChange={(e) => setForm({ ...form, spo2: e.target.value })} placeholder="98" />
        </Field>
        <Field label="Systolic BP" id="sbp">
          <Input id="sbp" type="number" value={form.systolic_bp} onChange={(e) => setForm({ ...form, systolic_bp: e.target.value })} placeholder="120" />
        </Field>
        <Field label="Diastolic BP" id="dbp">
          <Input id="dbp" type="number" value={form.diastolic_bp} onChange={(e) => setForm({ ...form, diastolic_bp: e.target.value })} placeholder="80" />
        </Field>
        <Field label="Temperature (°C)" id="t">
          <Input id="t" type="number" step="0.1" value={form.temperature_c} onChange={(e) => setForm({ ...form, temperature_c: e.target.value })} placeholder="36.8" />
        </Field>
        <Field label="Activity level" id="act">
          <select
            id="act"
            value={form.activity_level}
            onChange={(e) => setForm({ ...form, activity_level: e.target.value })}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="active">Active</option>
            <option value="moderate">Moderate</option>
            <option value="low">Low / sedentary</option>
            <option value="bedbound">Bed-bound / immobile</option>
          </select>
        </Field>
        <div className="sm:col-span-2">
          <Label htmlFor="hist">Medical history (free text)</Label>
          <Textarea id="hist" value={form.history} onChange={(e) => setForm({ ...form, history: e.target.value })} placeholder="e.g. hypertension, diabetes, history of falls" />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="notes">Notes</Label>
          <Textarea id="notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Anything else worth knowing" />
        </div>
          <div className="sm:col-span-2">
          <Button type="submit" disabled={busy} className="gradient-primary text-primary-foreground">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Analyze risk"}
          </Button>
        </div>
      </form>

      {result && (
        <div className="mt-6">
          <RiskAlert result={result} />
        </div>
      )}
    </Card>
  );
};

const Field = ({ label, id, children }: { label: string; id: string; children: React.ReactNode }) => (
  <div className="space-y-1.5">
    <Label htmlFor={id}>{label}</Label>
    {children}
  </div>
);
