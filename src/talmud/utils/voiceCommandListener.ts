export type VoiceGazeCommand = "go";

export type VoiceListenerStatus = "off" | "listening" | "unsupported" | "denied" | "error";

/**
 * Matches the unified Georgian eye-tracking navigation command ("გადადი")
 * including common Web Speech API phonetic variations without false positives on reading speech.
 */
export function parseGeorgianGazeCommand(rawTranscript: string): VoiceGazeCommand | null {
  const text = String(rawTranscript || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return null;

  if (
    /(?:^|\s)(?:გადადი|გადადით|გადასვლა|მიდი)(?:\s+(?:აქ|მანდ|ამაზე|მაგაზე))?(?:\s|$)/u.test(text)
  ) {
    return "go";
  }

  return null;
}

export function isSpeechRecognitionSupported(): boolean {
  if (typeof window === "undefined") return false;
  const win = window as unknown as {
    SpeechRecognition?: unknown;
    webkitSpeechRecognition?: unknown;
  };
  return Boolean(win.SpeechRecognition || win.webkitSpeechRecognition);
}

interface SpeechRecognitionResultEvent {
  resultIndex?: number;
  results?: ArrayLike<{
    length: number;
    [index: number]: { transcript?: string } | undefined;
  }>;
}

interface SpeechRecognitionErrorEventLike {
  error?: string;
}

interface SpeechRecognitionInstance {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives?: number;
  onresult: ((ev: SpeechRecognitionResultEvent) => void) | null;
  onerror: ((ev: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

export class VoiceCommandController {
  private recognition: SpeechRecognitionInstance | null = null;
  private active = false;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private lastCommand: VoiceGazeCommand | null = null;
  private lastCommandAt = 0;
  private onCommand: (cmd: VoiceGazeCommand, transcript: string) => void;
  private onStatusChange: (status: VoiceListenerStatus) => void;

  constructor(options: {
    onCommand: (cmd: VoiceGazeCommand, transcript: string) => void;
    onStatusChange: (status: VoiceListenerStatus) => void;
  }) {
    this.onCommand = options.onCommand;
    this.onStatusChange = options.onStatusChange;
  }

  start(): void {
    if (this.active) return;
    if (typeof window === "undefined") return;

    const win = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionInstance;
      webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
    };
    const SpeechRec = win.SpeechRecognition || win.webkitSpeechRecognition;
    if (!SpeechRec) {
      this.onStatusChange("unsupported");
      return;
    }

    this.active = true;
    this.spawnSession(SpeechRec);
  }

  stop(): void {
    this.active = false;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (this.recognition) {
      try {
        this.recognition.onresult = null;
        this.recognition.onerror = null;
        this.recognition.onend = null;
        this.recognition.stop();
      } catch {
        // ignore stop errors
      }
      this.recognition = null;
    }
    this.onStatusChange("off");
  }

  private spawnSession(SpeechRec: new () => SpeechRecognitionInstance): void {
    if (!this.active) return;

    try {
      const rec = new SpeechRec();
      rec.lang = "ka-GE";
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 3;

      rec.onresult = (event: SpeechRecognitionResultEvent) => {
        if (!this.active || !event?.results) return;
        const startIdx = Math.max(0, Number(event.resultIndex) || 0);
        for (let i = startIdx; i < event.results.length; i++) {
          const result = event.results[i];
          if (!result) continue;
          const altCount = Math.min(3, result.length || 1);
          for (let a = 0; a < altCount; a++) {
            const transcript = String(result[a]?.transcript || "").trim();
            if (!transcript) continue;
            const cmd = parseGeorgianGazeCommand(transcript);
            if (cmd) {
              const now = Date.now();
              if (this.lastCommand === cmd && now - this.lastCommandAt < 1500) {
                return;
              }
              this.lastCommand = cmd;
              this.lastCommandAt = now;
              this.onCommand(cmd, transcript);
              return;
            }
          }
        }
      };

      rec.onerror = (event: SpeechRecognitionErrorEventLike) => {
        const err = String(event?.error || "");
        if (err === "not-allowed" || err === "service-not-allowed") {
          this.active = false;
          this.onStatusChange("denied");
          return;
        }
        if (err === "no-speech" || err === "aborted") {
          return;
        }
        if (this.active) {
          this.onStatusChange("error");
        }
      };

      rec.onend = () => {
        this.recognition = null;
        if (!this.active) return;
        if (this.restartTimer) clearTimeout(this.restartTimer);
        this.restartTimer = setTimeout(() => {
          this.restartTimer = null;
          if (!this.active) return;
          const win = window as unknown as {
            SpeechRecognition?: new () => SpeechRecognitionInstance;
            webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
          };
          const NextRec = win.SpeechRecognition || win.webkitSpeechRecognition;
          if (NextRec) this.spawnSession(NextRec);
        }, 420);
      };

      rec.start();
      this.recognition = rec;
      this.onStatusChange("listening");
    } catch {
      this.recognition = null;
      this.active = false;
      this.onStatusChange("error");
    }
  }
}
