#!/usr/bin/env python3
"""
Test script to verify risk classifier model loads and makes predictions
"""

import sys
import os
from pathlib import Path

# Add medpalm_service to path
sys.path.insert(0, str(Path(__file__).parent / "medpalm_service"))

from app.risk_classifier import get_risk_classifier

def test_model_loading():
    """Test that the model loads correctly"""
    print("🧪 Testing risk classifier model loading...\n")
    
    classifier = get_risk_classifier()
    
    if not classifier.ready:
        print("❌ Model failed to load")
        if classifier._import_error:
            print(f"   Error: {classifier._import_error}")
        return False
    
    print("✅ Model loaded successfully")
    return True


def test_predictions():
    """Test that the model makes predictions"""
    print("\n🧪 Testing risk predictions...\n")
    
    classifier = get_risk_classifier()
    
    if not classifier.ready:
        print("❌ Model not ready")
        return False
    
    # Test case 1: Normal vitals (LOW risk)
    patient_data_low = {
        "heart_rate": 72,
        "systolic_bp": 120,
        "diastolic_bp": 80,
        "spo2": 98,
        "temperature_c": 37.0,
        "steps_24h": 8000,
        "active_minutes_24h": 60,
        "fall_alerts_24h": 0,
        "cough_alerts_24h": 0,
        "help_alerts_24h": 0,
        "manual_sos_alerts_7d": 0,
        "high_risk_alerts_7d": 0,
        "activity_level": "moderate",
    }
    
    result_low = classifier.predict_risk(patient_data_low)
    print(f"Normal vitals prediction:")
    print(f"  Risk level: {result_low['risk_level']}")
    print(f"  Confidence: {result_low['confidence']:.2%}")
    print(f"  Probabilities: {result_low['probabilities']}")
    print(f"  Explanation: {result_low['explanation']}")
    
    # Test case 2: Abnormal vitals (HIGH risk)
    patient_data_high = {
        "heart_rate": 125,
        "systolic_bp": 160,
        "diastolic_bp": 95,
        "spo2": 85,
        "temperature_c": 39.2,
        "steps_24h": 100,
        "active_minutes_24h": 0,
        "fall_alerts_24h": 2,
        "cough_alerts_24h": 3,
        "help_alerts_24h": 1,
        "manual_sos_alerts_7d": 1,
        "high_risk_alerts_7d": 3,
        "activity_level": "bed_bound",
    }
    
    result_high = classifier.predict_risk(patient_data_high)
    print(f"\nAbnormal vitals prediction:")
    print(f"  Risk level: {result_high['risk_level']}")
    print(f"  Confidence: {result_high['confidence']:.2%}")
    print(f"  Probabilities: {result_high['probabilities']}")
    print(f"  Explanation: {result_high['explanation']}")
    
    # Test case 3: Missing/partial data
    patient_data_partial = {
        "heart_rate": 88,
        "spo2": 92,
        "temperature_c": 37.5,
    }
    
    result_partial = classifier.predict_risk(patient_data_partial)
    print(f"\nPartial data prediction:")
    print(f"  Risk level: {result_partial['risk_level']}")
    print(f"  Confidence: {result_partial['confidence']:.2%}")
    print(f"  Explanation: {result_partial['explanation']}")
    
    return result_low.get('risk_level') and result_high.get('risk_level')


if __name__ == "__main__":
    print("=" * 60)
    print("Risk Classifier Model Testing")
    print("=" * 60)
    
    # Test loading
    load_success = test_model_loading()
    
    # Test predictions if loading succeeded
    if load_success:
        pred_success = test_predictions()
    else:
        pred_success = False
    
    print("\n" + "=" * 60)
    if load_success and pred_success:
        print("✅ All tests passed!")
        sys.exit(0)
    else:
        print("❌ Some tests failed")
        sys.exit(1)
