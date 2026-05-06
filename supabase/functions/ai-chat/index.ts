import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `You are Nurse Ada, a compassionate AI virtual nurse assistant.
- Listen carefully to the patient's symptoms and concerns.
- Ask brief follow-up questions when helpful.
- Provide clear, calm, evidence-informed guidance in plain language.
- Always include a short safety note when symptoms could be serious.
- If the user mentions chest pain, severe bleeding, stroke signs, suicidal ideation, difficulty breathing, or says "HELP", urge them to call emergency services immediately and respond with an EMERGENCY tag at the start of your reply.
- Never claim to diagnose. Encourage seeing a clinician for persistent or worsening issues.
Keep responses concise (2-4 short paragraphs).`;

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

const streamOpenAICompatibleChat = async (
  apiUrl: string,
  apiKey: string | undefined,
  model: string,
  messages: ChatMessage[],
) => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  return fetch(apiUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages,
      stream: true,
    }),
  });
};

const getChatProviderResponse = async (messages: ChatMessage[]) => {
  const medPalmApiUrl = Deno.env.get("MEDPALM_API_URL");
  const medPalmApiKey = Deno.env.get("MEDPALM_API_KEY");
  const medPalmModel = Deno.env.get("MEDPALM_MODEL_NAME") ?? "medpalm";

  if (medPalmApiUrl) {
    return streamOpenAICompatibleChat(medPalmApiUrl, medPalmApiKey, medPalmModel, messages);
  }

  const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!lovableApiKey) {
    throw new Error("No AI provider configured. Set MEDPALM_API_URL or LOVABLE_API_KEY.");
  }

  return streamOpenAICompatibleChat(
    "https://ai.gateway.lovable.dev/v1/chat/completions",
    lovableApiKey,
    "google/gemini-3-flash-preview",
    messages,
  );
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: claimsErr } = await supabase.auth.getClaims(token);
    if (claimsErr || !claims?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { messages } = await req.json();
    if (!Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: "messages array required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const response = await getChatProviderResponse([
      { role: "system", content: SYSTEM_PROMPT },
      ...messages,
    ]);

    if (response.status === 429) {
      return new Response(
        JSON.stringify({ error: "Rate limit exceeded, please try again shortly." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (response.status === 402) {
      return new Response(
        JSON.stringify({ error: "AI credits depleted. Add credits in Settings → Workspace → Usage." }),
        { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (!response.ok) {
      const t = await response.text();
      console.error("AI provider error:", response.status, t);
      return new Response(JSON.stringify({ error: "AI provider error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("ai-chat error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
