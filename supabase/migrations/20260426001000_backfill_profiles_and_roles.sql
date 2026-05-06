DO $$
BEGIN
  INSERT INTO public.profiles (id, full_name, phone, patient_access_code)
  SELECT
    users.id,
    users.raw_user_meta_data->>'full_name',
    users.raw_user_meta_data->>'phone',
    CASE
      WHEN COALESCE(users.raw_user_meta_data->>'role', 'patient') = 'patient'
        THEN public.generate_patient_access_code()
      ELSE NULL
    END
  FROM auth.users AS users
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE profiles.id = users.id
  );

  INSERT INTO public.user_roles (user_id, role)
  SELECT
    users.id,
    CASE
      WHEN users.raw_user_meta_data->>'role' IN ('patient', 'caregiver', 'doctor')
        THEN (users.raw_user_meta_data->>'role')::public.app_role
      ELSE 'patient'::public.app_role
    END
  FROM auth.users AS users
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_roles.user_id = users.id
  );

  UPDATE public.profiles
  SET patient_access_code = public.generate_patient_access_code()
  WHERE patient_access_code IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.user_roles
      WHERE user_roles.user_id = profiles.id
        AND user_roles.role = 'patient'::public.app_role
    );
END $$;
