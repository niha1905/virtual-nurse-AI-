import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Heart, LogOut, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

export const AppHeader = () => {
  const { user, signOut, roles } = useAuth();
  const navigate = useNavigate();
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("theme") === "dark";
    setDark(saved);
    document.documentElement.classList.toggle("dark", saved);
  }, []);

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  };

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border/60 bg-background/80 backdrop-blur-lg">
      <div className="container flex h-16 items-center justify-between">
        <Link to="/" className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl gradient-primary shadow-soft">
            <Heart className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <p className="text-base font-bold leading-none">Virtual Nurse AI</p>
            <p className="text-[10px] text-muted-foreground">Compassionate care, always on</p>
          </div>
        </Link>

        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label="Toggle theme">
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
          {user ? (
            <>
              <span className="hidden text-xs text-muted-foreground sm:inline">
                {roles[0] ?? "user"}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  await signOut();
                  navigate("/auth");
                }}
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={() => navigate("/auth")} className="gradient-primary text-primary-foreground">
              Sign in
            </Button>
          )}
        </div>
      </div>
    </header>
  );
};
