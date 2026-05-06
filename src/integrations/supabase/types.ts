export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      alert_escalations: {
        Row: {
          alert_id: string
          created_at: string
          escalated_by: string
          escalated_to: string | null
          id: string
          patient_id: string
          reason: string
        }
        Insert: {
          alert_id: string
          created_at?: string
          escalated_by: string
          escalated_to?: string | null
          id?: string
          patient_id: string
          reason: string
        }
        Update: {
          alert_id?: string
          created_at?: string
          escalated_by?: string
          escalated_to?: string | null
          id?: string
          patient_id?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "alert_escalations_alert_id_fkey"
            columns: ["alert_id"]
            isOneToOne: false
            referencedRelation: "alerts"
            referencedColumns: ["id"]
          },
        ]
      }
      alerts: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          alarm_cancelled_at: string | null
          alarm_cancelled_by: string | null
          auto_escalate_at: string | null
          created_at: string
          id: string
          message: string | null
          metadata: Json | null
          patient_id: string
          status: Database["public"]["Enums"]["alert_status"]
          type: Database["public"]["Enums"]["alert_type"]
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          alarm_cancelled_at?: string | null
          alarm_cancelled_by?: string | null
          auto_escalate_at?: string | null
          created_at?: string
          id?: string
          message?: string | null
          metadata?: Json | null
          patient_id: string
          status?: Database["public"]["Enums"]["alert_status"]
          type: Database["public"]["Enums"]["alert_type"]
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          alarm_cancelled_at?: string | null
          alarm_cancelled_by?: string | null
          auto_escalate_at?: string | null
          created_at?: string
          id?: string
          message?: string | null
          metadata?: Json | null
          patient_id?: string
          status?: Database["public"]["Enums"]["alert_status"]
          type?: Database["public"]["Enums"]["alert_type"]
        }
        Relationships: []
      }
      conversations: {
        Row: {
          created_at: string
          id: string
          patient_id: string
          title: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          patient_id: string
          title?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          patient_id?: string
          title?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      health_data: {
        Row: {
          activity_level: string | null
          diastolic_bp: number | null
          heart_rate: number | null
          id: string
          notes: string | null
          patient_id: string
          recorded_at: string
          risk_explanation: string | null
          risk_level: Database["public"]["Enums"]["risk_level"] | null
          risk_score: number | null
          spo2: number | null
          systolic_bp: number | null
          temperature_c: number | null
        }
        Insert: {
          activity_level?: string | null
          diastolic_bp?: number | null
          heart_rate?: number | null
          id?: string
          notes?: string | null
          patient_id: string
          recorded_at?: string
          risk_explanation?: string | null
          risk_level?: Database["public"]["Enums"]["risk_level"] | null
          risk_score?: number | null
          spo2?: number | null
          systolic_bp?: number | null
          temperature_c?: number | null
        }
        Update: {
          activity_level?: string | null
          diastolic_bp?: number | null
          heart_rate?: number | null
          id?: string
          notes?: string | null
          patient_id?: string
          recorded_at?: string
          risk_explanation?: string | null
          risk_level?: Database["public"]["Enums"]["risk_level"] | null
          risk_score?: number | null
          spo2?: number | null
          systolic_bp?: number | null
          temperature_c?: number | null
        }
        Relationships: []
      }
      messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          role: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          role: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      medication_administrations: {
        Row: {
          administered_at: string
          caregiver_id: string
          created_at: string
          id: string
          notes: string | null
          prescription_id: string
          status: string
        }
        Insert: {
          administered_at?: string
          caregiver_id: string
          created_at?: string
          id?: string
          notes?: string | null
          prescription_id: string
          status?: string
        }
        Update: {
          administered_at?: string
          caregiver_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          prescription_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "medication_administrations_prescription_id_fkey"
            columns: ["prescription_id"]
            isOneToOne: false
            referencedRelation: "prescriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      medications: {
        Row: {
          created_at: string
          description: string | null
          dosage_form: string | null
          generic_name: string | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          dosage_form?: string | null
          generic_name?: string | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          dosage_form?: string | null
          generic_name?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      patient_activities: {
        Row: {
          activity_type: string
          created_at: string
          description: string | null
          duration_minutes: number | null
          id: string
          metadata: Json | null
          patient_id: string
          recorded_at: string
          recorded_by: string | null
        }
        Insert: {
          activity_type: string
          created_at?: string
          description?: string | null
          duration_minutes?: number | null
          id?: string
          metadata?: Json | null
          patient_id: string
          recorded_at?: string
          recorded_by?: string | null
        }
        Update: {
          activity_type?: string
          created_at?: string
          description?: string | null
          duration_minutes?: number | null
          id?: string
          metadata?: Json | null
          patient_id?: string
          recorded_at?: string
          recorded_by?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          assigned_caregiver_id: string | null
          assigned_doctor_id: string | null
          created_at: string
          date_of_birth: string | null
          full_name: string | null
          id: string
          patient_access_code: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          assigned_caregiver_id?: string | null
          assigned_doctor_id?: string | null
          created_at?: string
          date_of_birth?: string | null
          full_name?: string | null
          id: string
          patient_access_code?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          assigned_caregiver_id?: string | null
          assigned_doctor_id?: string | null
          created_at?: string
          date_of_birth?: string | null
          full_name?: string | null
          id?: string
          patient_access_code?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      prescriptions: {
        Row: {
          created_at: string
          doctor_id: string
          dose_times: string[]
          dosage: string
          duration_days: number | null
          end_date: string | null
          frequency: string
          id: string
          instructions: string | null
          is_active: boolean
          medication_id: string
          patient_id: string
          reminder_minutes_before: number
          start_date: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          doctor_id: string
          dose_times?: string[]
          dosage: string
          duration_days?: number | null
          end_date?: string | null
          frequency: string
          id?: string
          instructions?: string | null
          is_active?: boolean
          medication_id: string
          patient_id: string
          reminder_minutes_before?: number
          start_date?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          doctor_id?: string
          dose_times?: string[]
          dosage?: string
          duration_days?: number | null
          end_date?: string | null
          frequency?: string
          id?: string
          instructions?: string | null
          is_active?: boolean
          medication_id?: string
          patient_id?: string
          reminder_minutes_before?: number
          start_date?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "prescriptions_medication_id_fkey"
            columns: ["medication_id"]
            isOneToOne: false
            referencedRelation: "medications"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_patient_by_code: {
        Args: {
          _patient_access_code: string
          _role: Database["public"]["Enums"]["app_role"]
        }
        Returns: Database["public"]["Tables"]["profiles"]["Row"]
      }
      generate_patient_access_code: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      get_user_roles: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["app_role"][]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      release_patient_assignment: {
        Args: {
          _patient_id: string
          _role: Database["public"]["Enums"]["app_role"]
        }
        Returns: Database["public"]["Tables"]["profiles"]["Row"]
      }
    }
    Enums: {
      alert_status: "NEW" | "ACKNOWLEDGED" | "ESCALATED" | "RESOLVED"
      alert_type: "FALL" | "COUGH" | "HELP" | "HIGH_RISK" | "MANUAL_SOS"
      app_role: "patient" | "caregiver" | "doctor"
      risk_level: "LOW" | "MEDIUM" | "HIGH"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      alert_status: ["NEW", "ACKNOWLEDGED", "ESCALATED", "RESOLVED"],
      alert_type: ["FALL", "COUGH", "HELP", "HIGH_RISK", "MANUAL_SOS"],
      app_role: ["patient", "caregiver", "doctor"],
      risk_level: ["LOW", "MEDIUM", "HIGH"],
    },
  },
} as const
