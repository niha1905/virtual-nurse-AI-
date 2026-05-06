import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import Dashboard from "./pages/Dashboard";
import PatientDashboard from "./pages/PatientDashboard";
import CaregiverDashboard from "./pages/CaregiverDashboard";
import DoctorDashboard from "./pages/DoctorDashboard";
import NotFound from "./pages/NotFound";
import { EmergencyAlarm } from "@/components/EmergencyAlarm";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AuthProvider>
          <EmergencyAlarm />
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/patient" element={<ProtectedRoute requireRoles={["patient"]}><PatientDashboard /></ProtectedRoute>} />
            <Route path="/caregiver" element={<ProtectedRoute requireRoles={["caregiver"]}><CaregiverDashboard /></ProtectedRoute>} />
            <Route path="/doctor" element={<ProtectedRoute requireRoles={["doctor"]}><DoctorDashboard /></ProtectedRoute>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
