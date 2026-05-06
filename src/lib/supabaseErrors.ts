type SupabaseLikeError = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
  status?: number;
};

const MISSING_RELATION_CODES = new Set([
  "42P01",
  "PGRST116",
  "PGRST205",
]);

export const isMissingSupabaseRelation = (error: unknown) => {
  const candidate = error as SupabaseLikeError | null | undefined;
  if (!candidate) return false;

  const message = `${candidate.message || ""} ${candidate.details || ""} ${candidate.hint || ""}`.toLowerCase();
  return (
    candidate.status === 404 ||
    (candidate.code ? MISSING_RELATION_CODES.has(candidate.code) : false) ||
    message.includes("could not find the table") ||
    message.includes("relation") && message.includes("does not exist")
  );
};

export const getMissingFeatureMessage = (feature: string) =>
  `${feature} is unavailable because the required database tables have not been deployed to Supabase yet.`;

const missingFeatureKey = (featureKey: string) => `missing-supabase-feature:${featureKey}`;

export const rememberMissingFeature = (featureKey: string) => {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(missingFeatureKey(featureKey), "1");
};

export const isRememberedMissingFeature = (featureKey: string) => {
  if (typeof window === "undefined") return false;
  return window.sessionStorage.getItem(missingFeatureKey(featureKey)) === "1";
};
