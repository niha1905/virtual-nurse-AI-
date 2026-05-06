/**
 * Risk Analysis Service
 * 
 * Communicates with the backend risk analysis API to get patient risk predictions
 */

import { supabase } from "@/integrations/supabase/client";
import type { RiskAnalysisResult } from "@/components/RiskAlert";

export interface PatientVitals {
  heart_rate?: number;
  systolic_bp?: number;
  diastolic_bp?: number;
  spo2?: number;
  temperature_c?: number;
  steps_24h?: number;
  active_minutes_24h?: number;
  fall_alerts_24h?: number;
  cough_alerts_24h?: number;
  help_alerts_24h?: number;
  manual_sos_alerts_7d?: number;
  high_risk_alerts_7d?: number;
  pulse_pressure?: number;
  map_estimate?: number;
  shock_index?: number;
  spo2_deficit?: number;
  fever_flag?: number;
  hypoxia_flag?: number;
  severe_hypoxia_flag?: number;
  tachycardia_flag?: number;
  hypotension_flag?: number;
  low_steps_flag?: number;
  low_activity_minutes_flag?: number;
  history_condition_count?: number;
  note_issue_count?: number;
  event_burden_24h?: number;
  event_burden_7d?: number;
  weighted_event_burden?: number;
  cough_hypoxia_interaction?: number;
  cough_fever_interaction?: number;
  fall_hypotension_interaction?: number;
  fall_low_mobility_interaction?: number;
  help_recurrence_interaction?: number;
  sos_fall_interaction?: number;
  instability_index?: number;
  activity_level?: "low" | "moderate" | "active" | "bed_bound";
}

const env = import.meta.env as Record<string, string | undefined>;
const RISK_API_BASE = env.VITE_RISK_API_URL || "http://localhost:8000";

/**
 * Analyze patient risk based on vitals and alert history
 */
export async function analyzePatientRisk(
  vitals: PatientVitals
): Promise<RiskAnalysisResult> {
  try {
    const response = await fetch(`${RISK_API_BASE}/v1/risk/analyze`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(vitals),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.detail || `Risk analysis failed: ${response.status}`
      );
    }

    return (await response.json()) as RiskAnalysisResult;
  } catch (error) {
    console.error("Risk analysis error:", error);
    return {
      risk_level: null,
      confidence: 0,
      probabilities: {},
      explanation: "Failed to analyze risk. Please try again.",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Compute derived vital features from raw vitals
 */
export function computeDerivedFeatures(vitals: PatientVitals): PatientVitals {
  const derived = { ...vitals };

  // Pulse pressure
  if (
    vitals.systolic_bp !== undefined &&
    vitals.diastolic_bp !== undefined
  ) {
    derived.pulse_pressure = vitals.systolic_bp - vitals.diastolic_bp;
  }

  // Mean arterial pressure
  if (
    vitals.systolic_bp !== undefined &&
    vitals.diastolic_bp !== undefined
  ) {
    derived.map_estimate =
      (vitals.systolic_bp + 2 * vitals.diastolic_bp) / 3;
  }

  // Shock index
  if (
    vitals.heart_rate !== undefined &&
    vitals.systolic_bp !== undefined &&
    vitals.systolic_bp > 0
  ) {
    derived.shock_index = vitals.heart_rate / vitals.systolic_bp;
  }

  // SpO2 deficit
  if (vitals.spo2 !== undefined) {
    derived.spo2_deficit = Math.max(0, 95 - vitals.spo2);
  }

  // Clinical flags
  if (vitals.temperature_c !== undefined) {
    derived.fever_flag = vitals.temperature_c > 38 ? 1 : 0;
  }

  if (vitals.spo2 !== undefined) {
    derived.hypoxia_flag = vitals.spo2 < 94 ? 1 : 0;
    derived.severe_hypoxia_flag = vitals.spo2 < 90 ? 1 : 0;
  }

  if (vitals.heart_rate !== undefined) {
    derived.tachycardia_flag = vitals.heart_rate > 100 ? 1 : 0;
  }

  if (vitals.systolic_bp !== undefined) {
    derived.hypotension_flag = vitals.systolic_bp < 90 ? 1 : 0;
  }

  if (vitals.steps_24h !== undefined) {
    derived.low_steps_flag = vitals.steps_24h < 1000 ? 1 : 0;
  }

  if (vitals.active_minutes_24h !== undefined) {
    derived.low_activity_minutes_flag = vitals.active_minutes_24h < 30 ? 1 : 0;
  }

  // Interaction features
  const coughAlert = vitals.cough_alerts_24h || 0;
  const hypoxiaFlag = derived.hypoxia_flag || 0;
  const feverFlag = derived.fever_flag || 0;

  derived.cough_hypoxia_interaction = coughAlert * hypoxiaFlag;
  derived.cough_fever_interaction = coughAlert * feverFlag;

  const fallAlert = vitals.fall_alerts_24h || 0;
  const hypotensionFlag = derived.hypotension_flag || 0;
  const lowStepsFlag = derived.low_steps_flag || 0;

  derived.fall_hypotension_interaction = fallAlert * hypotensionFlag;
  derived.fall_low_mobility_interaction = fallAlert * lowStepsFlag;

  const helpAlert = vitals.help_alerts_24h || 0;
  const highRiskAlerts = vitals.high_risk_alerts_7d || 0;

  derived.help_recurrence_interaction = helpAlert * (highRiskAlerts > 0 ? 1 : 0);

  const sosAlert = vitals.manual_sos_alerts_7d || 0;
  derived.sos_fall_interaction = sosAlert * fallAlert;

  // Event burden
  const eventCount24h = (vitals.fall_alerts_24h || 0) +
    (vitals.cough_alerts_24h || 0) +
    (vitals.help_alerts_24h || 0);

  derived.event_burden_24h = eventCount24h;

  const eventCount7d = eventCount24h + (vitals.manual_sos_alerts_7d || 0);
  derived.event_burden_7d = eventCount7d;

  // Weighted event burden (higher weight for SOS)
  derived.weighted_event_burden =
    (vitals.fall_alerts_24h || 0) * 1 +
    (vitals.cough_alerts_24h || 0) * 1 +
    (vitals.help_alerts_24h || 0) * 1 +
    (vitals.manual_sos_alerts_7d || 0) * 3;

  // Instability index (composite of abnormal indicators)
  const abnormalIndicators = [
    derived.fever_flag || 0,
    derived.hypoxia_flag || 0,
    derived.tachycardia_flag || 0,
    derived.hypotension_flag || 0,
    Math.min(eventCount24h / 3, 1), // normalized event burden
  ];

  derived.instability_index =
    abnormalIndicators.reduce((a, b) => a + b, 0) / abnormalIndicators.length;

  return derived;
}

/**
 * Fetch latest vitals for a patient from Supabase
 */
export async function fetchPatientVitals(
  patientId: string
): Promise<PatientVitals | null> {
  try {
    const { data, error } = await supabase
      .from("health_data")
      .select("*")
      .eq("patient_id", patientId)
      .order("recorded_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("Error fetching vitals:", error);
      return null;
    }

    if (!data) return null;

    // Map database columns to vitals interface
    const vitals: PatientVitals = {
      heart_rate: data.heart_rate ?? undefined,
      systolic_bp: data.systolic_bp ?? undefined,
      diastolic_bp: data.diastolic_bp ?? undefined,
      spo2: data.spo2 ?? undefined,
      temperature_c: data.temperature_c ?? undefined,
      steps_24h: data.steps_24h ?? undefined,
      active_minutes_24h: data.active_minutes_24h ?? undefined,
      fall_alerts_24h: data.fall_alerts_24h ?? undefined,
      cough_alerts_24h: data.cough_alerts_24h ?? undefined,
      help_alerts_24h: data.help_alerts_24h ?? undefined,
      manual_sos_alerts_7d: data.manual_sos_alerts_7d ?? undefined,
      high_risk_alerts_7d: data.high_risk_alerts_7d ?? undefined,
      history_condition_count: data.history_condition_count ?? undefined,
      note_issue_count: data.note_issue_count ?? undefined,
      activity_level: (data.activity_level as any) ?? "moderate",
    };

    return vitals;
  } catch (error) {
    console.error("Fetch vitals error:", error);
    return null;
  }
}

/**
 * Format risk level for display
 */
export function formatRiskLevel(
  riskLevel: string | null
): { emoji: string; label: string; color: string } {
  switch (riskLevel) {
    case "HIGH":
      return { emoji: "🔴", label: "High Risk", color: "text-red-600" };
    case "MEDIUM":
      return { emoji: "🟡", label: "Medium Risk", color: "text-amber-600" };
    case "LOW":
      return { emoji: "🟢", label: "Low Risk", color: "text-green-600" };
    default:
      return { emoji: "⚪", label: "Unknown", color: "text-gray-600" };
  }
}

/**
 * Trigger appropriate alert based on risk level
 */
export function triggerRiskAlert(riskLevel: string | null): void {
  switch (riskLevel) {
    case "HIGH":
      // Trigger urgent notification (visible in app + sound + system notification)
      console.warn("🔴 HIGH RISK ALERT");
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification("⚠️ HIGH RISK ALERT", {
          body: "Patient at high risk. Immediate attention required.",
          icon: "/alert-high.png",
          tag: "risk-high",
          requireInteraction: true,
        });
      }
      break;

    case "MEDIUM":
      // Trigger warning notification
      console.warn("🟡 MEDIUM RISK ALERT");
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification("⚠️ MEDIUM RISK ALERT", {
          body: "Patient at medium risk. Review recommended.",
          icon: "/alert-medium.png",
          tag: "risk-medium",
        });
      }
      break;

    case "LOW":
      // No alert needed for low risk
      break;
  }
}
