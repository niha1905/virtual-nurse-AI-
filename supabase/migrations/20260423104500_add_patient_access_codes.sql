ALTER TABLE public.profiles
ADD COLUMN patient_access_code TEXT UNIQUE;

CREATE OR REPLACE FUNCTION public.generate_patient_access_code()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  candidate TEXT;
BEGIN
  LOOP
    candidate := 'PT-' || upper(substring(md5(random()::text || clock_timestamp()::text) from 1 for 8));
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.profiles WHERE patient_access_code = candidate
    );
  END LOOP;

  RETURN candidate;
END;
$$;

UPDATE public.profiles
SET patient_access_code = public.generate_patient_access_code()
WHERE patient_access_code IS NULL
  AND EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = public.profiles.id
      AND ur.role = 'patient'::public.app_role
  );

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _role public.app_role;
  _patient_access_code TEXT;
BEGIN
  _role := COALESCE((NEW.raw_user_meta_data->>'role')::public.app_role, 'patient');
  _patient_access_code := CASE
    WHEN _role = 'patient' THEN public.generate_patient_access_code()
    ELSE NULL
  END;

  INSERT INTO public.profiles (id, full_name, phone, patient_access_code)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'phone',
    _patient_access_code
  );

  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, _role);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_patient_by_code(
  _patient_access_code TEXT,
  _role public.app_role
)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_profile public.profiles%ROWTYPE;
BEGIN
  IF _role NOT IN ('doctor'::public.app_role, 'caregiver'::public.app_role) THEN
    RAISE EXCEPTION 'Only doctors and caregivers can claim patients';
  END IF;

  IF NOT public.has_role(auth.uid(), _role) THEN
    RAISE EXCEPTION 'Current user does not have role %', _role;
  END IF;

  SELECT *
  INTO target_profile
  FROM public.profiles
  WHERE patient_access_code = upper(trim(_patient_access_code));

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No patient found for code %', _patient_access_code;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = target_profile.id
      AND ur.role = 'patient'::public.app_role
  ) THEN
    RAISE EXCEPTION 'The code belongs to a non-patient account';
  END IF;

  IF _role = 'doctor'::public.app_role THEN
    IF target_profile.assigned_doctor_id IS NOT NULL
       AND target_profile.assigned_doctor_id <> auth.uid() THEN
      RAISE EXCEPTION 'This patient is already assigned to another doctor';
    END IF;

    UPDATE public.profiles
    SET assigned_doctor_id = auth.uid()
    WHERE id = target_profile.id
    RETURNING * INTO target_profile;
  ELSE
    IF target_profile.assigned_caregiver_id IS NOT NULL
       AND target_profile.assigned_caregiver_id <> auth.uid() THEN
      RAISE EXCEPTION 'This patient is already assigned to another caregiver';
    END IF;

    UPDATE public.profiles
    SET assigned_caregiver_id = auth.uid()
    WHERE id = target_profile.id
    RETURNING * INTO target_profile;
  END IF;

  RETURN target_profile;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_patient_assignment(
  _patient_id UUID,
  _role public.app_role
)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_profile public.profiles%ROWTYPE;
BEGIN
  IF _role NOT IN ('doctor'::public.app_role, 'caregiver'::public.app_role) THEN
    RAISE EXCEPTION 'Only doctors and caregivers can release patients';
  END IF;

  IF NOT public.has_role(auth.uid(), _role) THEN
    RAISE EXCEPTION 'Current user does not have role %', _role;
  END IF;

  IF _role = 'doctor'::public.app_role THEN
    UPDATE public.profiles
    SET assigned_doctor_id = NULL
    WHERE id = _patient_id
      AND assigned_doctor_id = auth.uid()
    RETURNING * INTO target_profile;
  ELSE
    UPDATE public.profiles
    SET assigned_caregiver_id = NULL
    WHERE id = _patient_id
      AND assigned_caregiver_id = auth.uid()
    RETURNING * INTO target_profile;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Patient not assigned to current user';
  END IF;

  RETURN target_profile;
END;
$$;
