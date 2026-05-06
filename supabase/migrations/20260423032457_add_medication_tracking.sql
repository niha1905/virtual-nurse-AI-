CREATE TABLE public.medications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  generic_name TEXT,
  description TEXT,
  dosage_form TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.medications ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.prescriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  medication_id UUID NOT NULL REFERENCES public.medications(id) ON DELETE CASCADE,
  dosage TEXT NOT NULL,
  frequency TEXT NOT NULL,
  duration_days INTEGER,
  instructions TEXT,
  start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  end_date DATE,
  dose_times TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  reminder_minutes_before INTEGER NOT NULL DEFAULT 15,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.prescriptions ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.medication_administrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prescription_id UUID NOT NULL REFERENCES public.prescriptions(id) ON DELETE CASCADE,
  caregiver_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  administered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'administered' CHECK (status IN ('administered', 'missed', 'refused')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.medication_administrations ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.patient_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  activity_type TEXT NOT NULL,
  description TEXT,
  duration_minutes INTEGER,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  recorded_by UUID REFERENCES auth.users(id),
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.patient_activities ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_prescriptions_patient ON public.prescriptions(patient_id, created_at DESC);
CREATE INDEX idx_prescriptions_doctor ON public.prescriptions(doctor_id, created_at DESC);
CREATE INDEX idx_med_admin_prescription ON public.medication_administrations(prescription_id, administered_at DESC);
CREATE INDEX idx_patient_activities_patient ON public.patient_activities(patient_id, recorded_at DESC);

CREATE TRIGGER medications_touch BEFORE UPDATE ON public.medications
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER prescriptions_touch BEFORE UPDATE ON public.prescriptions
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE POLICY "Doctors manage medications" ON public.medications
  FOR ALL
  USING (public.has_role(auth.uid(), 'doctor'))
  WITH CHECK (public.has_role(auth.uid(), 'doctor'));

CREATE POLICY "Care team view medications" ON public.medications
  FOR SELECT
  USING (
    public.has_role(auth.uid(), 'caregiver') OR
    public.has_role(auth.uid(), 'patient') OR
    public.has_role(auth.uid(), 'doctor')
  );

CREATE POLICY "Doctors manage own prescriptions" ON public.prescriptions
  FOR ALL
  USING (public.has_role(auth.uid(), 'doctor') AND doctor_id = auth.uid())
  WITH CHECK (public.has_role(auth.uid(), 'doctor') AND doctor_id = auth.uid());

CREATE POLICY "Caregivers view assigned prescriptions" ON public.prescriptions
  FOR SELECT
  USING (
    public.has_role(auth.uid(), 'caregiver') AND
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = patient_id AND p.assigned_caregiver_id = auth.uid()
    )
  );

CREATE POLICY "Patients view own prescriptions" ON public.prescriptions
  FOR SELECT
  USING (public.has_role(auth.uid(), 'patient') AND patient_id = auth.uid());

CREATE POLICY "Caregivers manage administrations for assigned patients" ON public.medication_administrations
  FOR ALL
  USING (
    public.has_role(auth.uid(), 'caregiver') AND
    EXISTS (
      SELECT 1
      FROM public.prescriptions pr
      JOIN public.profiles pf ON pf.id = pr.patient_id
      WHERE pr.id = prescription_id AND pf.assigned_caregiver_id = auth.uid()
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'caregiver') AND
    caregiver_id = auth.uid() AND
    EXISTS (
      SELECT 1
      FROM public.prescriptions pr
      JOIN public.profiles pf ON pf.id = pr.patient_id
      WHERE pr.id = prescription_id AND pf.assigned_caregiver_id = auth.uid()
    )
  );

CREATE POLICY "Doctors view administrations for own prescriptions" ON public.medication_administrations
  FOR SELECT
  USING (
    public.has_role(auth.uid(), 'doctor') AND
    EXISTS (
      SELECT 1 FROM public.prescriptions pr
      WHERE pr.id = prescription_id AND pr.doctor_id = auth.uid()
    )
  );

CREATE POLICY "Patients view own administrations" ON public.medication_administrations
  FOR SELECT
  USING (
    public.has_role(auth.uid(), 'patient') AND
    EXISTS (
      SELECT 1 FROM public.prescriptions pr
      WHERE pr.id = prescription_id AND pr.patient_id = auth.uid()
    )
  );

CREATE POLICY "Caregivers manage activities for assigned patients" ON public.patient_activities
  FOR ALL
  USING (
    public.has_role(auth.uid(), 'caregiver') AND
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = patient_id AND p.assigned_caregiver_id = auth.uid()
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'caregiver') AND
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = patient_id AND p.assigned_caregiver_id = auth.uid()
    )
  );

CREATE POLICY "Patients manage own activities" ON public.patient_activities
  FOR ALL
  USING (public.has_role(auth.uid(), 'patient') AND patient_id = auth.uid())
  WITH CHECK (public.has_role(auth.uid(), 'patient') AND patient_id = auth.uid());

CREATE POLICY "Doctors view assigned activities" ON public.patient_activities
  FOR SELECT
  USING (
    public.has_role(auth.uid(), 'doctor') AND
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = patient_id AND p.assigned_doctor_id = auth.uid()
    )
  );

ALTER PUBLICATION supabase_realtime ADD TABLE public.medication_administrations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.patient_activities;
