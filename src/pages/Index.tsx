import { Link } from "react-router-dom";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Activity, Bell, Brain, Heart, Mic, ShieldCheck } from "lucide-react";

const features = [
  { icon: Mic, title: "Voice Companion", desc: "Speak naturally — Nurse Ada listens and responds with empathy." },
  { icon: Brain, title: "AI Health Insights", desc: "Conversational triage powered by leading language models." },
  { icon: Activity, title: "Risk Analysis", desc: "Weighted scoring of vitals, activity & history with explanations." },
  { icon: Bell, title: "Emergency Alerts", desc: "Real-time notifications to caregivers and doctors." },
  { icon: ShieldCheck, title: "Privacy First", desc: "Row-level security keeps every patient's data isolated." },
  { icon: Heart, title: "Multi-Role Care", desc: "Tailored dashboards for patients, caregivers, and doctors." },
];

const Index = () => {
  return (
    <div className="min-h-screen bg-background">
      <AppHeader />

      <main>
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div className="absolute inset-0 gradient-hero opacity-95" aria-hidden />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.15),transparent_50%)]" aria-hidden />
          <div className="container relative py-24 text-primary-foreground sm:py-32">
            <div className="mx-auto max-w-3xl text-center">
              <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary-foreground/20 bg-primary-foreground/10 px-4 py-1.5 text-xs font-medium backdrop-blur">
                <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
                AI-powered virtual nursing
              </span>
              <h1 className="text-balance text-4xl font-bold leading-tight tracking-tight sm:text-6xl">
                Compassionate AI care, available 24/7
              </h1>
              <p className="mx-auto mt-6 max-w-2xl text-balance text-lg text-primary-foreground/90">
                Virtual Nurse AI listens to your symptoms, analyzes your vitals, and instantly
                alerts your caregivers when something isn't right.
              </p>
              <div className="mt-10 flex flex-wrap justify-center gap-3">
                <Button asChild size="lg" variant="secondary" className="text-base shadow-elegant">
                  <Link to="/auth">Get started free</Link>
                </Button>
                <Button asChild size="lg" variant="outline" className="border-primary-foreground/30 bg-transparent text-base text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground">
                  <Link to="/auth">I already have an account</Link>
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* Features */}
        <section className="container py-20">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">A complete care companion</h2>
            <p className="mt-4 text-muted-foreground">
              Built for patients who deserve continuous attention, and caregivers who need to act fast.
            </p>
          </div>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <Card key={f.title} className="group gradient-card border-border/60 p-6 transition-smooth hover:shadow-elegant">
                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl gradient-primary shadow-soft transition-smooth group-hover:shadow-glow">
                  <f.icon className="h-5 w-5 text-primary-foreground" />
                </div>
                <h3 className="text-lg font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{f.desc}</p>
              </Card>
            ))}
          </div>
        </section>

        <section className="border-t border-border/60 bg-muted/30">
          <div className="container py-16 text-center">
            <h2 className="text-2xl font-semibold sm:text-3xl">Ready to feel safer at home?</h2>
            <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
              Create an account in seconds and choose your role: patient, caregiver, or doctor.
            </p>
            <Button asChild size="lg" className="mt-8 gradient-primary text-primary-foreground shadow-elegant">
              <Link to="/auth">Create account</Link>
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t border-border/60 py-8 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} Virtual Nurse AI · For demonstration only — not a substitute for professional medical advice.
      </footer>
    </div>
  );
};

export default Index;
