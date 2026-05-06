"""
Risk Classifier Module - Multimodal Patient Risk Assessment

This module provides risk classification capabilities for patient vitals and alerts.
It uses a trained ensemble model to predict risk levels (LOW, MEDIUM, HIGH) based on
multimodal patient data including physiological state, event burden, and functional context.
"""

import logging
import os
import warnings
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

logger = logging.getLogger("risk-classifier")

# Feature definitions - must match the trained model
NUMERIC_FEATURES = [
    # Raw vitals
    "heart_rate", "systolic_bp", "diastolic_bp", "spo2", "temperature_c",
    # Functional
    "steps_24h", "active_minutes_24h",
    # Alert counts
    "fall_alerts_24h", "cough_alerts_24h", "help_alerts_24h",
    "manual_sos_alerts_7d", "high_risk_alerts_7d",
    # Haemodynamic indices
    "pulse_pressure", "map_estimate", "shock_index", "spo2_deficit",
    # Binary clinical flags
    "fever_flag", "hypoxia_flag", "severe_hypoxia_flag",
    "tachycardia_flag", "hypotension_flag",
    "low_steps_flag", "low_activity_minutes_flag",
    # History and notes
    "history_condition_count", "note_issue_count",
    # Event-burden aggregates
    "event_burden_24h", "event_burden_7d", "weighted_event_burden",
    # Cross-modal interaction features (key novelty)
    "cough_hypoxia_interaction", "cough_fever_interaction",
    "fall_hypotension_interaction", "fall_low_mobility_interaction",
    "help_recurrence_interaction", "sos_fall_interaction",
    # Composite index
    "instability_index",
]

CATEGORICAL_FEATURES = ["activity_level"]
RISK_CLASSES = ["LOW", "MEDIUM", "HIGH"]


class RiskClassifierRuntime:
    """
    Runtime environment for the multimodal risk classifier.
    
    Handles model loading with sklearn version compatibility and provides
    risk prediction capabilities.
    """

    def __init__(self) -> None:
        self.model_path = os.getenv(
            "RISK_MODEL_PATH",
            str(Path(__file__).resolve().parents[2] / "models" / "risk" / "experimental_risk_classifier_bundle.joblib")
        )
        self._model: Any | None = None
        self._preprocessor: Any | None = None
        self._label_encoder: Any | None = None
        self._import_error: Exception | None = None
        self._load_attempted = False

    def _load(self) -> None:
        """Load the model from disk with compatibility handling."""
        if self._load_attempted:
            return

        self._load_attempted = True

        try:
            import joblib

            # Suppress sklearn version warnings
            warnings.filterwarnings("ignore", category=UserWarning)

            # Load the complete bundle
            model_bundle = joblib.load(self.model_path)
            
            # Handle different bundle structures
            # First, check if it's the experimental bundle (with nested models/preprocessors)
            if "models" in model_bundle:
                # Experimental bundle structure: use temporal model (has better features)
                self._model = model_bundle["models"].get("temporal") or model_bundle["models"].get("baseline")
                preprocessors = model_bundle.get("preprocessors", {})
                self._preprocessor = preprocessors.get("temporal") or preprocessors.get("baseline")
                self._label_encoder = model_bundle.get("label_encoder")
            else:
                # Original bundle structure: direct model access
                self._model = model_bundle.get("model")
                self._preprocessor = model_bundle.get("preprocessor")
                self._label_encoder = model_bundle.get("label_encoder")

            if self._model is None:
                raise ValueError("Model bundle does not contain 'model' or 'models' key")

            logger.info(f"✅ Risk classifier loaded from {self.model_path}")
            logger.info(f"   - Model: {type(self._model).__name__}")
            logger.info(f"   - Preprocessor: {'present' if self._preprocessor else 'not required'}")
            logger.info(f"   - Label encoder: {'present' if self._label_encoder else 'not required'}")

        except FileNotFoundError as exc:
            self._import_error = exc
            logger.warning(f"⚠️ Risk model not found at {self.model_path}: {exc}")

        except Exception as exc:
            self._import_error = exc
            logger.warning(f"⚠️ Risk classifier load failed: {exc}")

    @property
    def ready(self) -> bool:
        """Check if model is ready for inference."""
        self._load()
        return self._model is not None

    def predict_risk(self, patient_data: dict[str, Any]) -> dict[str, Any]:
        """
        Predict patient risk level based on multimodal data.

        Args:
            patient_data: Dictionary containing patient vitals and alert information
                         Should include keys from NUMERIC_FEATURES and CATEGORICAL_FEATURES

        Returns:
            Dictionary with:
                - risk_level: "LOW", "MEDIUM", or "HIGH"
                - confidence: Probability of predicted class (0-1)
                - probabilities: Dict of all class probabilities
                - explanation: Human-readable explanation
                - features_used: List of features actually used for prediction
        """
        if not self.ready:
            if self._import_error:
                return {
                    "error": f"Model not available: {str(self._import_error)}",
                    "risk_level": None,
                    "confidence": 0.0,
                }
            return {
                "error": "Risk classifier not initialized",
                "risk_level": None,
                "confidence": 0.0,
            }

        try:
            # Build feature DataFrame
            df = self._prepare_features(patient_data)

            # If preprocessor is available, use it; otherwise use raw features
            if self._preprocessor:
                try:
                    df_processed = self._preprocessor.transform(df)
                except Exception as preprocess_error:
                    logger.warning(f"Preprocessing failed, using raw features: {preprocess_error}")
                    df_processed = df.values
            else:
                df_processed = df

            # Get prediction and probabilities
            risk_prediction_encoded = self._model.predict(df_processed)[0]
            risk_probabilities = self._model.predict_proba(df_processed)[0]

            # Decode risk level using label encoder if available
            if self._label_encoder:
                try:
                    risk_prediction = self._label_encoder.inverse_transform([risk_prediction_encoded])[0]
                except Exception:
                    # Fallback if label encoder doesn't work
                    risk_prediction = RISK_CLASSES[int(risk_prediction_encoded)] if int(risk_prediction_encoded) < len(RISK_CLASSES) else "UNKNOWN"
            else:
                # Direct prediction (already decoded by model)
                risk_prediction = risk_prediction_encoded

            # Map probabilities using the model's encoded class order. The saved
            # label encoder stores classes as HIGH, LOW, MEDIUM, not RISK_CLASSES.
            if self._label_encoder:
                class_order = [str(cls) for cls in self._label_encoder.classes_]
            elif hasattr(self._model, "classes_"):
                class_order = [str(cls) for cls in self._model.classes_]
            else:
                class_order = RISK_CLASSES

            probs_dict = {
                risk_class: float(prob)
                for risk_class, prob in zip(class_order, risk_probabilities)
            }

            # Get confidence (max probability)
            confidence = float(max(risk_probabilities))

            # Generate explanation
            explanation = self._generate_explanation(patient_data, str(risk_prediction), probs_dict)

            return {
                "risk_level": str(risk_prediction),
                "confidence": confidence,
                "probabilities": probs_dict,
                "explanation": explanation,
                "features_used": list(df.columns) if isinstance(df, pd.DataFrame) else None,
            }

        except Exception as exc:
            logger.error(f"Prediction error: {exc}", exc_info=True)
            return {
                "error": f"Prediction failed: {str(exc)}",
                "risk_level": None,
                "confidence": 0.0,
            }

    def _prepare_features(self, patient_data: dict[str, Any]) -> pd.DataFrame:
        """
        Prepare feature DataFrame from patient data.

        Handles missing values and ensures all required features are present.
        Also computes temporal features if the raw time-series data is available.
        """
        # Create dict with all required features, filling missing with defaults
        prepared_data = {}

        for feature in NUMERIC_FEATURES:
            prepared_data[feature] = patient_data.get(feature, 0.0)

        for feature in CATEGORICAL_FEATURES:
            # Default activity level to "moderate"
            prepared_data[feature] = patient_data.get(feature, "moderate")

        # If this is the experimental bundle with temporal features, 
        # add computed temporal features (rolling means, trends)
        # Note: In real deployment with streaming data, these would be computed
        # from historical windows. For now, we use reasonable defaults.
        
        temporal_features = [
            "heart_rate_ma3", "heart_rate_std3", "heart_rate_trend3",
            "systolic_bp_ma3", "systolic_bp_std3", "systolic_bp_trend3",
            "spo2_ma3", "spo2_std3", "spo2_trend3",
            "temperature_c_ma3", "temperature_c_std3", "temperature_c_trend3",
            "heart_rate_ma7", "heart_rate_std7", "heart_rate_trend7",
            "systolic_bp_ma7", "systolic_bp_std7", "systolic_bp_trend7",
            "spo2_ma7", "spo2_std7", "spo2_trend7",
            "temperature_c_ma7", "temperature_c_std7", "temperature_c_trend7",
            "fall_alerts_24h_trend", "fall_alerts_24h_accel",
            "cough_alerts_24h_trend", "cough_alerts_24h_accel",
            "help_alerts_24h_trend", "help_alerts_24h_accel",
            "manual_sos_alerts_7d_trend", "manual_sos_alerts_7d_accel",
            "high_risk_alerts_7d_trend", "high_risk_alerts_7d_accel",
            "deterioration_velocity",
        ]
        
        # Compute approximate temporal features from current values
        # (In production, these would come from actual time-series data)
        hr = patient_data.get("heart_rate", 72)
        sbp = patient_data.get("systolic_bp", 120)
        spo2 = patient_data.get("spo2", 97)
        temp = patient_data.get("temperature_c", 37)
        
        # Use current values as moving average approximations
        for feature in temporal_features:
            if "ma3" in feature or "ma7" in feature:
                # Use current value as proxy for moving average
                if "heart_rate" in feature:
                    prepared_data[feature] = float(hr)
                elif "systolic_bp" in feature:
                    prepared_data[feature] = float(sbp)
                elif "spo2" in feature:
                    prepared_data[feature] = float(spo2)
                elif "temperature" in feature:
                    prepared_data[feature] = float(temp)
                else:
                    prepared_data[feature] = 0.0
            elif "std" in feature:
                # Use low std for stable signals
                prepared_data[feature] = 2.0
            elif "trend" in feature or "accel" in feature:
                # Zero trend for stable signals
                prepared_data[feature] = 0.0
            elif feature == "deterioration_velocity":
                prepared_data[feature] = 0.0
            else:
                prepared_data[feature] = 0.0

        return pd.DataFrame([prepared_data])

    def _generate_explanation(
        self,
        patient_data: dict[str, Any],
        risk_level: str,
        probabilities: dict[str, float],
    ) -> str:
        """Generate human-readable explanation for the prediction."""
        high_prob = probabilities.get("HIGH", 0.0)
        medium_prob = probabilities.get("MEDIUM", 0.0)

        # Collect contributing factors
        factors = []

        # Check vitals
        hr = patient_data.get("heart_rate", 0)
        if hr < 50 or hr > 110:
            factors.append(f"abnormal heart rate ({hr} bpm)")

        spo2 = patient_data.get("spo2", 100)
        if spo2 < 94:
            factors.append(f"low SpO2 ({spo2}%)")

        temp = patient_data.get("temperature_c", 37)
        if temp > 38 or temp < 35:
            factors.append(f"abnormal temperature ({temp}°C)")

        # Check alerts
        fall_alerts = patient_data.get("fall_alerts_24h", 0)
        if fall_alerts > 0:
            factors.append(f"{fall_alerts} fall alert(s) in 24h")

        cough_alerts = patient_data.get("cough_alerts_24h", 0)
        if cough_alerts > 0:
            factors.append(f"{cough_alerts} cough alert(s) in 24h")

        help_alerts = patient_data.get("help_alerts_24h", 0)
        if help_alerts > 0:
            factors.append(f"{help_alerts} help request(s) in 24h")

        # Base explanation
        if risk_level == "HIGH":
            base = f"🔴 HIGH RISK - {high_prob*100:.0f}% confidence. "
        elif risk_level == "MEDIUM":
            base = f"🟡 MEDIUM RISK - {medium_prob*100:.0f}% confidence. "
        else:
            base = f"🟢 LOW RISK - {(1-high_prob-medium_prob)*100:.0f}% confidence. "

        if factors:
            return base + "Contributing factors: " + ", ".join(factors) + "."
        else:
            return base + "Patient vitals and activity within normal ranges."

    def batch_predict(self, patients_data: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """
        Predict risk for multiple patients.

        Args:
            patients_data: List of patient data dictionaries

        Returns:
            List of prediction results
        """
        return [self.predict_risk(patient_data) for patient_data in patients_data]


# Global runtime instance
_risk_classifier_runtime: RiskClassifierRuntime | None = None


def get_risk_classifier() -> RiskClassifierRuntime:
    """Get or create the global risk classifier runtime instance."""
    global _risk_classifier_runtime
    if _risk_classifier_runtime is None:
        _risk_classifier_runtime = RiskClassifierRuntime()
    return _risk_classifier_runtime
