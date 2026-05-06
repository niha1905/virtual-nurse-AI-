-- Audit trail of alert escalations from caregiver to doctor
CREATE TABLE public.alert_escalations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id uuid NOT NULL REFERENCES public.alerts(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL,
  escalated_by uuid NOT NULL,
  escalated_to uuid,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_alert_escalations_alert ON public.alert_escalations(alert_id);
CREATE INDEX idx_alert_escalations_patient ON public.alert_escalations(patient_id);

ALTER TABLE public.alert_escalations ENABLE ROW LEVEL SECURITY;

-- View: caregivers/doctors assigned to the patient
CREATE POLICY "Assigned care team views escalations"
ON public.alert_escalations
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = alert_escalations.patient_id
      AND (p.assigned_caregiver_id = auth.uid() OR p.assigned_doctor_id = auth.uid())
  )
);

-- View: any doctor
CREATE POLICY "Doctors view all escalations"
ON public.alert_escalations
FOR SELECT
USING (public.has_role(auth.uid(), 'doctor'::public.app_role));

-- View: the patient themselves
CREATE POLICY "Patients view own escalations"
ON public.alert_escalations
FOR SELECT
USING (auth.uid() = patient_id);

-- Insert: assigned caregiver/doctor for that patient, and must record themselves as the escalator
CREATE POLICY "Assigned care team creates escalations"
ON public.alert_escalations
FOR INSERT
WITH CHECK (
  auth.uid() = escalated_by
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = alert_escalations.patient_id
      AND (p.assigned_caregiver_id = auth.uid() OR p.assigned_doctor_id = auth.uid())
  )
);

-- Insert: any doctor can also create escalations
CREATE POLICY "Doctors create escalations"
ON public.alert_escalations
FOR INSERT
WITH CHECK (
  auth.uid() = escalated_by
  AND public.has_role(auth.uid(), 'doctor'::public.app_role)
);