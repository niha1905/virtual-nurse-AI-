import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Vitals {
  heart_rate?: number;
  systolic_bp?: number;
  diastolic_bp?: number;
  spo2?: number;
  temperature_c?: number;
  activity_level?: string;
  history?: string;
  notes?: string;
}

function scoreVitals(v: Vitals): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  if (v.heart_rate != null) {
    if (v.heart_rate < 50 || v.heart_rate > 110) {
      score += 30; reasons.push(`Heart rate ${v.heart_rate} bpm is outside normal range (60-100).`);
    } else if (v.heart_rate < 60 || v.heart_rate > 100) {
      score += 15; reasons.push(`Heart rate ${v.heart_rate} bpm is borderline.`);
    }
  }
  if (v.systolic_bp != null) {
    if (v.systolic_bp >= 160 || v.systolic_bp < 90) {
      score += 30; reasons.push(`Systolic BP ${v.systolic_bp} is concerning.`);
    } else if (v.systolic_bp >= 140) {
      score += 15; reasons.push(`Systolic BP ${v.systolic_bp} is elevated.`);
    }
  }
  if (v.spo2 != null) {
    if (v.spo2 < 90) { score += 40; reasons.push(`SpO2 ${v.spo2}% is critically low.`); }
    else if (v.spo2 < 94) { score += 20; reasons.push(`SpO2 ${v.spo2}% is below normal.`); }
  }
  if (v.temperature_c != null) {
    if (v.temperature_c >= 39 || v.temperature_c < 35) {
      score += 25; reasons.push(`Temperature ${v.temperature_c}°C is concerning.`);
    } else if (v.temperature_c >= 38) {
      score += 10; reasons.push(`Mild fever (${v.temperature_c}°C).`);
    }
  }
  return { score: Math.min(score, 100), reasons };
}

function scoreActivity(v: Vitals): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  const a = (v.activity_level || "").toLowerCase();
  if (a.includes("bed") || a.includes("immobile")) {
    score = 80; reasons.push("Patient is mostly immobile/bed-bound.");
  } else if (a.includes("low") || a.includes("sedent")) {
    score = 50; reasons.push("Low activity level reported.");
  } else if (a.includes("moderate")) {
    score = 20;
  } else if (a.includes("active") || a.includes("high")) {
    score = 5;
  }
  return { score, reasons };
}

function scoreHistory(v: Vitals): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  const h = (v.history || "").toLowerCase();
  let score = 0;
  const flags = [
    ["diabet", 25, "Diabetes in history"],
    ["hypertens", 20, "Hypertension in history"],
    ["heart", 30, "Cardiac history"],
    ["stroke", 35, "Prior stroke"],
    ["copd", 30, "COPD/respiratory history"],
    ["asthma", 15, "Asthma in history"],
    ["cancer", 25, "Oncology history"],
    ["fall", 20, "History of falls"],
  ] as const;
  for (const [kw, w, label] of flags) {
    if (h.includes(kw)) { score += w; reasons.push(label + "."); }
  }
  return { score: Math.min(score, 100), reasons };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: claims } = await supabase.auth.getClaims(token);
    if (!claims?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claims.claims.sub as string;

    const vitals: Vitals = await req.json();

    const v = scoreVitals(vitals);
    const a = scoreActivity(vitals);
    const h = scoreHistory(vitals);

    const total = Math.round(v.score * 0.5 + a.score * 0.3 + h.score * 0.2);
    let level: "LOW" | "MEDIUM" | "HIGH" = "LOW";
    if (total >= 60) level = "HIGH";
    else if (total >= 30) level = "MEDIUM";

    const reasons = [...v.reasons, ...a.reasons, ...h.reasons];
    const explanation = reasons.length
      ? reasons.join(" ")
      : "All inputs within normal ranges.";

    // Persist
    const { data: saved, error: insErr } = await supabase
      .from("health_data")
      .insert({
        patient_id: userId,
        heart_rate: vitals.heart_rate ?? null,
        systolic_bp: vitals.systolic_bp ?? null,
        diastolic_bp: vitals.diastolic_bp ?? null,
        spo2: vitals.spo2 ?? null,
        temperature_c: vitals.temperature_c ?? null,
        activity_level: vitals.activity_level ?? null,
        notes: vitals.notes ?? null,
        risk_score: total,
        risk_level: level,
        risk_explanation: explanation,
      })
      .select()
      .single();

    if (insErr) console.error("insert health_data error:", insErr);

    // Auto-alert on HIGH risk
    if (level === "HIGH") {
      await supabase.from("alerts").insert({
        patient_id: userId,
        type: "HIGH_RISK",
        message: `High risk detected (score ${total}). ${explanation}`.slice(0, 500),
        metadata: { vitals, breakdown: { vitals: v.score, activity: a.score, history: h.score } },
      });
    }

    return new Response(
      JSON.stringify({
        risk_score: total,
        risk_level: level,
        explanation,
        breakdown: { vitals: v.score, activity: a.score, history: h.score },
        record: saved,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("risk-analysis error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
