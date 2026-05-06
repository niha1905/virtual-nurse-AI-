
# Risk Analysis Endpoint
# This endpoint is added to main.py via import integration

from fastapi import HTTPException
from .risk_classifier import get_risk_classifier
from .main import RiskAnalysisRequest, RiskAnalysisResponse, app
import logging

logger = logging.getLogger("medpalm-service")


@app.post("/v1/risk/analyze", response_model=RiskAnalysisResponse)
async def analyze_risk(request: RiskAnalysisRequest):
    """
    Analyze patient risk level based on multimodal health data.

    Uses the trained multimodal risk classifier to predict if a patient is at
    LOW, MEDIUM, or HIGH risk based on vital signs, activity levels, and alert history.

    Returns:
        - risk_level: Classification result (LOW, MEDIUM, HIGH)
        - confidence: Confidence score for the prediction
        - probabilities: Breakdown of probability for each class
        - explanation: Human-readable summary of risk factors
    """
    try:
        risk_classifier = get_risk_classifier()

        # Convert request to dict, filtering out None values
        patient_data = {k: v for k, v in request.model_dump().items() if v is not None}

        # Get prediction from risk classifier
        result = risk_classifier.predict_risk(patient_data)

        return RiskAnalysisResponse(**result)

    except Exception as exc:  # pragma: no cover - runtime-specific
        logger.exception("Risk analysis failed")
        raise HTTPException(status_code=500, detail=f"Risk analysis failed: {exc}") from exc
