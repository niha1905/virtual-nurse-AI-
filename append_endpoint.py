import os

endpoint_code = '\n\n@app.post("/v1/risk/analyze", response_model=RiskAnalysisResponse)\nasync def analyze_risk(request: RiskAnalysisRequest):\n    """\n    Analyze patient risk level based on multimodal health data.\n\n    Uses the trained multimodal risk classifier to predict if a patient is at\n    LOW, MEDIUM, or HIGH risk based on vital signs, activity levels, and alert history.\n\n    Returns:\n        - risk_level: Classification result (LOW, MEDIUM, HIGH)\n        - confidence: Confidence score for the prediction\n        - probabilities: Breakdown of probability for each class\n        - explanation: Human-readable summary of risk factors\n    """\n    try:\n        risk_classifier = get_risk_classifier()\n\n        # Convert request to dict, filtering out None values\n        patient_data = {k: v for k, v in request.model_dump().items() if v is not None}\n\n        # Get prediction from risk classifier\n        result = risk_classifier.predict_risk(patient_data)\n\n        return RiskAnalysisResponse(**result)\n\n    except Exception as exc:  # pragma: no cover - runtime-specific\n        logger.exception("Risk analysis failed")\n        raise HTTPException(status_code=500, detail=f"Risk analysis failed: {exc}") from exc\n'

main_py_path = 'medpalm_service/app/main.py'
with open(main_py_path, 'a', encoding='utf-8') as f:
    f.write(endpoint_code)

print('✅ Risk analysis endpoint added to main.py')
