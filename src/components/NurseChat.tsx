import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Loader2, Mic, MicOff, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import { findHelpKeywordMatch } from "@/lib/helpKeywords";

type Msg = { role: "user" | "assistant"; content: string };
type StreamChunk = {
  choices?: Array<{
    delta?: {
      content?: string;
    };
  }>;
};

type SpeechRecognitionAlternativeLite = {
  transcript: string;
};

type SpeechRecognitionResultLite = ArrayLike<SpeechRecognitionAlternativeLite> & {
  0: SpeechRecognitionAlternativeLite;
  isFinal: boolean;
};

type SpeechRecognitionEventLite = Event & {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLite>;
};

type SpeechRecognitionErrorEventLite = Event & {
  error?: string;
};

type SpeechRecognitionInstance = EventTarget & {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLite) => void) | null;
  onresult: ((event: SpeechRecognitionEventLite) => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionInstance;

export const NurseChat = () => {
  const { session } = useAuth();
  const [messages, setMessages] = useState<Msg[]>([
    { role: "assistant", content: "Hi, I'm Nurse Ada. Tell me how you're feeling today." },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRecognitionInstance | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  const startListening = () => {
    const browserWindow = window as Window &
      typeof globalThis & {
        SpeechRecognition?: SpeechRecognitionCtor;
        webkitSpeechRecognition?: SpeechRecognitionCtor;
      };
    const SpeechRecognitionClass =
      browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition;

    if (!SpeechRecognitionClass) {
      toast.error("Voice input is not supported in this browser. Try Chrome.");
      return;
    }

    const recognition = new SpeechRecognitionClass();
    recognition.lang = "en-IN";
    recognition.interimResults = true;
    recognition.continuous = false;

    let finalText = "";

    recognition.onresult = (event: SpeechRecognitionEventLite) => {
      let interimText = "";
      for (let index = event.resultIndex; index < event.results.length; index++) {
        const transcript = event.results[index][0].transcript;
        if (event.results[index].isFinal) finalText += transcript;
        else interimText += transcript;
      }
      setInput(finalText + interimText);
    };

    recognition.onend = () => {
      setListening(false);
      if (finalText.trim()) sendMessage(finalText.trim());
    };

    recognition.onerror = (event: SpeechRecognitionErrorEventLite) => {
      setListening(false);
      toast.error(`Mic error: ${event.error || "unknown"}`);
    };

    recRef.current = recognition;
    recognition.start();
    setListening(true);
  };

  const stopListening = () => {
    recRef.current?.stop();
    setListening(false);
  };

  const sendMessage = async (text: string) => {
    if (!text.trim() || busy) return;

    setInput("");
    const userMessage: Msg = { role: "user", content: text };
    setMessages((previous) => [...previous, userMessage]);
    setBusy(true);

    const helpMatch = findHelpKeywordMatch(text);
    if (helpMatch && session?.user?.id) {
      try {
        await supabase.from("alerts").insert({
          patient_id: session.user.id,
          type: "HELP",
          message: `Patient said: "${text.slice(0, 200)}"`,
          metadata: {
            source: "nurse_chat",
            matched_keyword: helpMatch.keyword,
            detected_language: helpMatch.language,
          },
          auto_escalate_at: new Date(Date.now() + 40_000).toISOString(),
        });
      } catch (error) {
        console.error(error);
      }
    }

    let assistantText = "";
    const upsert = (chunk: string) => {
      assistantText += chunk;
      setMessages((previous) => {
        const last = previous[previous.length - 1];
        if (
          last?.role === "assistant" &&
          last.content === assistantText.slice(0, last.content.length) &&
          last.content !== ""
        ) {
          return previous.map((message, index) =>
            index === previous.length - 1 ? { ...message, content: assistantText } : message,
          );
        }
        if (last?.role === "user") {
          return [...previous, { role: "assistant", content: assistantText }];
        }
        return previous.map((message, index) =>
          index === previous.length - 1 ? { ...message, content: assistantText } : message,
        );
      });
    };

    try {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-chat`;
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${
            session?.access_token ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
          }`,
        },
        body: JSON.stringify({
          messages: [...messages, userMessage].map(({ role, content }) => ({ role, content })),
        }),
      });

      if (response.status === 429) {
        toast.error("Too many requests. Slow down a moment.");
        setBusy(false);
        return;
      }

      if (response.status === 402) {
        toast.error("AI credits are depleted.");
        setBusy(false);
        return;
      }

      if (!response.ok || !response.body) {
        toast.error("Chat failed");
        setBusy(false);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let done = false;

      while (!done) {
        const { done: readDone, value } = await reader.read();
        if (readDone) break;

        buffer += decoder.decode(value, { stream: true });
        let newlineIndex: number;

        while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
          let line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (!line.startsWith("data: ")) continue;

          const json = line.slice(6).trim();
          if (json === "[DONE]") {
            done = true;
            break;
          }

          try {
            const parsed = JSON.parse(json) as StreamChunk;
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) upsert(content);
          } catch {
            buffer = `${line}\n${buffer}`;
            break;
          }
        }
      }
    } catch (error) {
      console.error(error);
      toast.error("Chat error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="flex h-[600px] flex-col gradient-card shadow-soft">
      <div className="flex items-center gap-2 border-b border-border/60 px-5 py-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg gradient-primary">
          <Sparkles className="h-4 w-4 text-primary-foreground" />
        </div>
        <div>
          <p className="text-sm font-semibold">Nurse Ada</p>
          <p className="text-xs text-muted-foreground">AI care companion</p>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-5">
        {messages.map((message, index) => (
          <div
            key={index}
            className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-soft ${
                message.role === "user"
                  ? "gradient-primary text-primary-foreground"
                  : "bg-secondary text-secondary-foreground"
              }`}
            >
              <div className="prose prose-sm max-w-none prose-p:my-1 prose-headings:my-1">
                <ReactMarkdown>{message.content || "..."}</ReactMarkdown>
              </div>
            </div>
          </div>
        ))}

        {busy && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Nurse Ada is thinking...
          </div>
        )}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          sendMessage(input);
        }}
        className="flex items-center gap-2 border-t border-border/60 p-3"
      >
        <Button
          type="button"
          size="icon"
          variant={listening ? "destructive" : "outline"}
          onClick={listening ? stopListening : startListening}
          aria-label={listening ? "Stop listening" : "Start voice input"}
          className={listening ? "animate-pulse-ring" : ""}
        >
          {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        </Button>

        <Input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={listening ? "Listening..." : "Type or speak how you feel..."}
          disabled={busy}
        />

        <Button type="submit" size="icon" disabled={busy || !input.trim()} className="gradient-primary">
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </Card>
  );
};
