import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Lock } from "lucide-react";

const STORAGE_KEY = "mbs_pin_hash";
const UNLOCK_KEY = "mbs_unlocked";

async function sha256(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function PasscodeGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [hasPin, setHasPin] = useState(false);
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    setHasPin(!!stored);
    if (sessionStorage.getItem(UNLOCK_KEY) === "1") setUnlocked(true);
    setReady(true);
  }, []);

  if (!ready) return null;
  if (unlocked) return <>{children}</>;

  async function handleSetup(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    if (pin.length < 4) return setErr("Use at least 4 digits/characters.");
    if (pin !== pin2) return setErr("Passcodes don't match.");
    const h = await sha256(pin);
    localStorage.setItem(STORAGE_KEY, h);
    sessionStorage.setItem(UNLOCK_KEY, "1");
    setUnlocked(true);
  }

  async function handleUnlock(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    const h = await sha256(pin);
    if (h === localStorage.getItem(STORAGE_KEY)) {
      sessionStorage.setItem(UNLOCK_KEY, "1");
      setUnlocked(true);
    } else {
      setErr("Wrong passcode.");
      setPin("");
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-lg border bg-card p-6 shadow-sm">
        <div className="flex flex-col items-center gap-2 mb-6">
          <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
            <Lock className="h-6 w-6 text-primary" />
          </div>
          <h1 className="text-xl font-bold">Maa Bhavani Steel</h1>
          <p className="text-sm text-muted-foreground text-center">
            {hasPin ? "Enter your passcode to continue" : "Set a passcode to protect this app"}
          </p>
        </div>

        {hasPin ? (
          <form onSubmit={handleUnlock} className="space-y-4">
            <div>
              <Label htmlFor="pin">Passcode</Label>
              <Input
                id="pin"
                type="password"
                inputMode="numeric"
                autoFocus
                value={pin}
                onChange={(e) => setPin(e.target.value)}
              />
            </div>
            {err && <p className="text-sm text-destructive">{err}</p>}
            <Button type="submit" className="w-full">Unlock</Button>
            <button
              type="button"
              onClick={() => {
                if (confirm("Reset passcode? You'll set a new one.")) {
                  localStorage.removeItem(STORAGE_KEY);
                  setHasPin(false);
                  setPin("");
                  setErr("");
                }
              }}
              className="w-full text-xs text-muted-foreground hover:text-foreground"
            >
              Forgot passcode? Reset
            </button>
          </form>
        ) : (
          <form onSubmit={handleSetup} className="space-y-4">
            <div>
              <Label htmlFor="pin">New passcode</Label>
              <Input
                id="pin"
                type="password"
                inputMode="numeric"
                autoFocus
                value={pin}
                onChange={(e) => setPin(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="pin2">Confirm passcode</Label>
              <Input
                id="pin2"
                type="password"
                inputMode="numeric"
                value={pin2}
                onChange={(e) => setPin2(e.target.value)}
              />
            </div>
            {err && <p className="text-sm text-destructive">{err}</p>}
            <Button type="submit" className="w-full">Set passcode</Button>
          </form>
        )}
      </div>
    </div>
  );
}
