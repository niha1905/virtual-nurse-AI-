# Model Inventory

This folder stores the trained-model evidence for the Care Companion AI project. For major-project review, the important distinction is between:

- runtime models that are actively used by the application
- retained artifacts that document experimentation and training outputs

## Runtime-facing models

| Model | Purpose | Runtime entry point |
| --- | --- | --- |
| MedPalm Nurse Chat | Conversational clinical assistant for the Nurse Ada workflow | `medpalm_service/app/main.py` |
| Whisper Keyword Detection | Speech transcription for emergency help-word detection | `medpalm_service/app/main.py` |
| Fall Audio Model | Deployed custom backend fall-vs-non-fall classifier sourced from `models/fall` | `medpalm_service/app/audio_models.py` |
| Cough MobileNetV2 | Deployed custom backend cough-vs-no-cough classifier sourced from `models/coug` | `medpalm_service/app/audio_models.py` |

## Stored artifacts in this folder

### `models/fall`

- `cnn_fall_detector.h5`: Keras training artifact for fall audio classification
- `rf_fall_detector.joblib`: Random forest baseline retained for comparison
- `saved_model.keras`: additional Keras export snapshot
- `scaler.joblib`: preprocessing scaler from classical-model experiments
- `fall-detection.ipynb`: training and experimentation notebook

The deployed service now uses these artifacts as the primary fall-detection backend. The browser-friendly file at `public/models/fall-cnn-weights.json` is kept as a fallback runtime path.

### `models/coug`

- `network.h5`, `network.json`, `network.yaml`: TensorFlow / Keras MobileNetV2 cough-model artifacts
- `cough-analysis-with-mobilenet.ipynb`: notebook documenting the cough-model workflow

These files are now used by the deployed backend cough route. Whisper remains separate and is still used only for spoken emergency keyword transcription.

## Review Notes

- Runtime inference code now promotes `models/fall` and `models/coug` into real backend-served custom models.
- The frontend still keeps a heuristic and browser fallback path so demos remain resilient when the backend model service is unavailable.
- The `src/lib/modelCatalog.ts` file provides a single review-friendly registry of all important models in the project.
