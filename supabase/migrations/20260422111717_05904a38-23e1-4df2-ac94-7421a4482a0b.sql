-- Enums
CREATE TYPE public.app_role AS ENUM ('patient', 'caregiver', 'doctor');
CREATE TYPE public.risk_level AS ENUM ('LOW', 'MEDIUM', 'HIGH');
CREATE TYPE public.alert_type AS ENUM ('FALL', 'COUGH', 'HELP', 'HIGH_RISK', 'MANUAL_SOS');
CREATE TYPE public.alert_status AS ENUM ('NEW', 'ACKNOWLEDGED', 'ESCALATED', 'RESOLVED');

-- Profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  phone TEXT,
  date_of_birth DATE,
  assigned_caregiver_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_doctor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- User Roles
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Security definer for role checks
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION public.get_user_roles(_user_id UUID)
RETURNS SETOF public.app_role LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT role FROM public.user_roles WHERE user_id = _user_id;
$$;

-- Health vitals
CREATE TABLE public.health_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  heart_rate INT,
  systolic_bp INT,
  diastolic_bp INT,
  spo2 INT,
  temperature_c NUMERIC(4,1),
  activity_level TEXT,
  notes TEXT,
  risk_score NUMERIC,
  risk_level public.risk_level,
  risk_explanation TEXT,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.health_data ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_health_data_patient ON public.health_data(patient_id, recorded_at DESC);

-- Conversations
CREATE TABLE public.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_messages_conv ON public.messages(conversation_id, created_at);

-- Alerts
CREATE TABLE public.alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type public.alert_type NOT NULL,
  status public.alert_status NOT NULL DEFAULT 'NEW',
  message TEXT,
  metadata JSONB,
  acknowledged_by UUID REFERENCES auth.users(id),
  acknowledged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_alerts_patient ON public.alerts(patient_id, created_at DESC);
CREATE INDEX idx_alerts_status ON public.alerts(status, created_at DESC);

-- RLS POLICIES

-- profiles
CREATE POLICY "Users view own profile" ON public.profiles FOR SELECT
  USING (auth.uid() = id);
CREATE POLICY "Caregivers view assigned patients" ON public.profiles FOR SELECT
  USING (auth.uid() = assigned_caregiver_id OR auth.uid() = assigned_doctor_id);
CREATE POLICY "Doctors view all profiles" ON public.profiles FOR SELECT
  USING (public.has_role(auth.uid(), 'doctor'));
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE
  USING (auth.uid() = id);
CREATE POLICY "Users insert own profile" ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- user_roles
CREATE POLICY "Users view own roles" ON public.user_roles FOR SELECT
  USING (auth.uid() = user_id);
CREATE POLICY "Doctors view all roles" ON public.user_roles FOR SELECT
  USING (public.has_role(auth.uid(), 'doctor'));

-- health_data
CREATE POLICY "Patients manage own vitals" ON public.health_data FOR ALL
  USING (auth.uid() = patient_id) WITH CHECK (auth.uid() = patient_id);
CREATE POLICY "Caregivers view assigned vitals" ON public.health_data FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = patient_id AND (p.assigned_caregiver_id = auth.uid() OR p.assigned_doctor_id = auth.uid())));
CREATE POLICY "Doctors view all vitals" ON public.health_data FOR SELECT
  USING (public.has_role(auth.uid(), 'doctor'));

-- conversations
CREATE POLICY "Patients manage own conversations" ON public.conversations FOR ALL
  USING (auth.uid() = patient_id) WITH CHECK (auth.uid() = patient_id);
CREATE POLICY "Caregivers view assigned conversations" ON public.conversations FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = patient_id AND (p.assigned_caregiver_id = auth.uid() OR p.assigned_doctor_id = auth.uid())));
CREATE POLICY "Doctors view all conversations" ON public.conversations FOR SELECT
  USING (public.has_role(auth.uid(), 'doctor'));

-- messages
CREATE POLICY "Patients manage own messages" ON public.messages FOR ALL
  USING (EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = conversation_id AND c.patient_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = conversation_id AND c.patient_id = auth.uid()));
CREATE POLICY "Caregivers view assigned messages" ON public.messages FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.conversations c JOIN public.profiles p ON p.id = c.patient_id WHERE c.id = conversation_id AND (p.assigned_caregiver_id = auth.uid() OR p.assigned_doctor_id = auth.uid())));
CREATE POLICY "Doctors view all messages" ON public.messages FOR SELECT
  USING (public.has_role(auth.uid(), 'doctor'));

-- alerts
CREATE POLICY "Patients manage own alerts" ON public.alerts FOR ALL
  USING (auth.uid() = patient_id) WITH CHECK (auth.uid() = patient_id);
CREATE POLICY "Caregivers view assigned alerts" ON public.alerts FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = patient_id AND (p.assigned_caregiver_id = auth.uid() OR p.assigned_doctor_id = auth.uid())));
CREATE POLICY "Caregivers ack assigned alerts" ON public.alerts FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = patient_id AND (p.assigned_caregiver_id = auth.uid() OR p.assigned_doctor_id = auth.uid())));
CREATE POLICY "Doctors view all alerts" ON public.alerts FOR SELECT
  USING (public.has_role(auth.uid(), 'doctor'));
CREATE POLICY "Doctors ack all alerts" ON public.alerts FOR UPDATE
  USING (public.has_role(auth.uid(), 'doctor'));

-- Trigger: auto-create profile + default role on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _role public.app_role;
BEGIN
  INSERT INTO public.profiles (id, full_name, phone)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'phone');

  _role := COALESCE((NEW.raw_user_meta_data->>'role')::public.app_role, 'patient');
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, _role);
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER profiles_touch BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER conversations_touch BEFORE UPDATE ON public.conversations
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.alerts;
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;