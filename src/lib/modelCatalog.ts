export type ModelLifecycle = "runtime" | "artifact";
export type ModelModality = "audio" | "multimodal" | "tabular";

export type ProjectModel = {
  id: string;
  name: string;
  purpose: string;
  modality: ModelModality;
  lifecycle: ModelLifecycle;
  implementation: string;
  sourcePath: string;
  notes: string;
};

export const PROJECT_MODELS: ProjectModel[] = [
  {
    id: "medpalm-chat",
    name: "MedPalm Nurse Chat",
    purpose: "Clinical-style conversational assistance for the Nurse Ada chat flow",
    modality: "multimodal",
    lifecycle: "runtime",
    implementation: "Python service wrapper with OpenAI-compatible chat completions surface",
    sourcePath: "medpalm_service/app/main.py",
    notes: "Loads the MedPalm runtime when local weights are available and otherwise falls back to a scaffold response.",
  },
  {
    id: "whisper-keyword",
    name: "Whisper Keyword Detection",
    purpose: "Speech-to-text transcription for emergency help-word detection",
    modality: "audio",
    lifecycle: "runtime",
    implementation: "faster-whisper runtime configured through environment variables",
    sourcePath: "medpalm_service/app/main.py",
    notes: "The frontend posts clipped audio to the local service for transcription and keyword matching.",
  },
  {
    id: "fall-cnn-runtime",
    name: "Fall Audio CNN",
    purpose: "Binary classification of fall vs non-fall audio events",
    modality: "audio",
    lifecycle: "runtime",
    implementation: "Backend TensorFlow inference over deployed artifacts from models/fall, with browser inference retained as fallback",
    sourcePath: "medpalm_service/app/audio_models.py",
    notes: "Primary path is the deployed backend custom model; browser-side weights remain as a resilience fallback.",
  },
  {
    id: "cough-mobilenet-runtime",
    name: "Cough MobileNetV2 Runtime",
    purpose: "Binary cough vs no-cough audio classification",
    modality: "audio",
    lifecycle: "runtime",
    implementation: "Backend TensorFlow inference route over MobileNetV2 artifacts from models/coug",
    sourcePath: "medpalm_service/app/audio_models.py",
    notes: "Turns the saved cough artifact bundle into a real deployed inference path for the application.",
  },
  {
    id: "cough-mobilenet-artifact",
    name: "Cough MobileNetV2 Artifact",
    purpose: "Prototype cough classification model retained for review and future integration",
    modality: "audio",
    lifecycle: "artifact",
    implementation: "TensorFlow / Keras artifact bundle",
    sourcePath: "models/coug",
    notes: "Retained as the underlying artifact source for the deployed backend cough model.",
  },
  {
    id: "fall-training-artifacts",
    name: "Fall Training Artifacts",
    purpose: "Saved training outputs for comparative fall-detection experiments",
    modality: "audio",
    lifecycle: "artifact",
    implementation: "Keras and joblib files for CNN, random forest, scaler, and saved model snapshots",
    sourcePath: "models/fall",
    notes: "The production app uses exported browser weights rather than these raw training artifacts.",
  },
];

export const getRuntimeModels = () =>
  PROJECT_MODELS.filter((model) => model.lifecycle === "runtime");

export const getArtifactModels = () =>
  PROJECT_MODELS.filter((model) => model.lifecycle === "artifact");
