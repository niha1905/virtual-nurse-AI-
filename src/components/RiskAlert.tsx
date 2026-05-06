import { AlertCircle, AlertTriangle, CheckCircle } from "lucide-react";
import { Card } from "@/components/ui/card";

export interface RiskAnalysisResult {
  risk_level: "LOW" | "MEDIUM" | "HIGH" | null;
  confidence: number;
  probabilities: {
    LOW?: number;
    MEDIUM?: number;
    HIGH?: number;
  };
  explanation: string;
  features_used?: string[];
  error?: string;
}

interface RiskAlertProps {
  result: RiskAnalysisResult;
  onDismiss?: () => void;
}

const getRiskStyles = (riskLevel: string | null) => {
  switch (riskLevel) {
    case "HIGH":
      return {
        bgColor: "bg-red-50 dark:bg-red-950",
        borderColor: "border-red-300 dark:border-red-700",
        textColor: "text-red-900 dark:text-red-100",
        badgeBg: "bg-red-200 dark:bg-red-800",
        icon: AlertCircle,
      };
    case "MEDIUM":
      return {
        bgColor: "bg-amber-50 dark:bg-amber-950",
        borderColor: "border-amber-300 dark:border-amber-700",
        textColor: "text-amber-900 dark:text-amber-100",
        badgeBg: "bg-amber-200 dark:bg-amber-800",
        icon: AlertTriangle,
      };
    case "LOW":
      return {
        bgColor: "bg-green-50 dark:bg-green-950",
        borderColor: "border-green-300 dark:border-green-700",
        textColor: "text-green-900 dark:text-green-100",
        badgeBg: "bg-green-200 dark:bg-green-800",
        icon: CheckCircle,
      };
    default:
      return {
        bgColor: "bg-gray-50 dark:bg-gray-950",
        borderColor: "border-gray-300 dark:border-gray-700",
        textColor: "text-gray-900 dark:text-gray-100",
        badgeBg: "bg-gray-200 dark:bg-gray-800",
        icon: AlertTriangle,
      };
  }
};

export const RiskAlert: React.FC<RiskAlertProps> = ({ result, onDismiss }) => {
  if (!result) return null;

  const styles = getRiskStyles(result.risk_level);
  const Icon = styles.icon;

  if (result.error) {
    return (
      <Card className={`border-2 p-4 ${styles.borderColor} ${styles.bgColor}`}>
        <div className={`text-sm font-semibold ${styles.textColor}`}>
          ⚠️ Risk Analysis Error
        </div>
        <p className={`text-sm mt-1 ${styles.textColor}`}>{result.error}</p>
      </Card>
    );
  }

  return (
    <Card className={`border-2 p-4 ${styles.borderColor} ${styles.bgColor}`}>
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3 flex-1">
          <Icon className={`w-5 h-5 mt-0.5 flex-shrink-0`} />
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h3 className={`font-bold text-lg ${styles.textColor}`}>
                {result.risk_level} RISK
              </h3>
              <span className={`text-sm font-semibold px-2 py-1 rounded ${styles.badgeBg}`}>
                {(result.confidence * 100).toFixed(0)}% confidence
              </span>
            </div>

            <p className={`text-sm mt-2 ${styles.textColor}`}>
              {result.explanation}
            </p>

            {/* Risk probability breakdown */}
            <div className="mt-3 space-y-1">
              <p className={`text-xs font-semibold ${styles.textColor}`}>
                Risk Distribution:
              </p>
              <div className="flex gap-4 text-xs">
                <div>
                  🟢 LOW:{" "}
                  <span className="font-semibold">
                    {(result.probabilities.LOW ? result.probabilities.LOW * 100 : 0).toFixed(1)}%
                  </span>
                </div>
                <div>
                  🟡 MEDIUM:{" "}
                  <span className="font-semibold">
                    {(result.probabilities.MEDIUM ? result.probabilities.MEDIUM * 100 : 0).toFixed(1)}%
                  </span>
                </div>
                <div>
                  🔴 HIGH:{" "}
                  <span className="font-semibold">
                    {(result.probabilities.HIGH ? result.probabilities.HIGH * 100 : 0).toFixed(1)}%
                  </span>
                </div>
              </div>
            </div>

            {/* Risk recommendations */}
            {result.risk_level === "HIGH" && (
              <div className={`mt-3 p-2 rounded text-sm ${styles.badgeBg}`}>
                <p className={`font-semibold ${styles.textColor}`}>
                  ⚡ Recommended Actions:
                </p>
                <ul className={`text-xs mt-1 list-disc list-inside ${styles.textColor}`}>
                  <li>Contact healthcare provider immediately</li>
                  <li>Monitor vitals closely</li>
                  <li>Ensure emergency contacts are available</li>
                </ul>
              </div>
            )}

            {result.risk_level === "MEDIUM" && (
              <div className={`mt-3 p-2 rounded text-sm ${styles.badgeBg}`}>
                <p className={`font-semibold ${styles.textColor}`}>
                  📋 Recommended Actions:
                </p>
                <ul className={`text-xs mt-1 list-disc list-inside ${styles.textColor}`}>
                  <li>Schedule check-in with healthcare provider</li>
                  <li>Increase monitoring frequency</li>
                  <li>Review recent activity and vitals</li>
                </ul>
              </div>
            )}
          </div>
        </div>

        {onDismiss && (
          <button
            onClick={onDismiss}
            className={`ml-4 text-lg hover:opacity-70 ${styles.textColor}`}
          >
            ✕
          </button>
        )}
      </div>
    </Card>
  );
};

export default RiskAlert;
