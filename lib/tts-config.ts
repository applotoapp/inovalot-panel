export const audioReplyModes = ["never", "mirror", "always"] as const;
export type AudioReplyMode = (typeof audioReplyModes)[number];

export const geminiTtsVoices = [
  "Achird",
  "Sulafat",
  "Kore",
  "Aoede",
  "Callirrhoe",
  "Iapetus",
  "Charon",
  "Schedar",
] as const;

export type GeminiTtsVoice = (typeof geminiTtsVoices)[number];

export const geminiTtsPaces = ["slow", "normal", "fast"] as const;
export type GeminiTtsPace = (typeof geminiTtsPaces)[number];

export const geminiTtsStyles = [
  "professional_warm",
  "formal_confident",
  "empathetic_calm",
  "friendly_natural",
  "objective_neutral",
] as const;
export type GeminiTtsStyle = (typeof geminiTtsStyles)[number];

export const geminiTtsExpressivenessLevels = ["restrained", "balanced", "expressive"] as const;
export type GeminiTtsExpressiveness = (typeof geminiTtsExpressivenessLevels)[number];

export const geminiTtsVoiceLabels: Record<GeminiTtsVoice, string> = {
  Achird: "Achird — amigável",
  Sulafat: "Sulafat — acolhedora",
  Kore: "Kore — firme",
  Aoede: "Aoede — leve",
  Callirrhoe: "Callirrhoe — tranquila",
  Iapetus: "Iapetus — clara",
  Charon: "Charon — informativa",
  Schedar: "Schedar — equilibrada",
};

export const geminiTtsPaceLabels: Record<GeminiTtsPace, string> = {
  slow: "Calma e pausada",
  normal: "Natural",
  fast: "Ágil",
};

export const geminiTtsStyleLabels: Record<GeminiTtsStyle, string> = {
  professional_warm: "Profissional e acolhedora",
  formal_confident: "Formal e segura",
  empathetic_calm: "Empática e tranquila",
  friendly_natural: "Amigável e natural",
  objective_neutral: "Objetiva e neutra",
};

export const geminiTtsExpressivenessLabels: Record<GeminiTtsExpressiveness, string> = {
  restrained: "Discreta",
  balanced: "Equilibrada",
  expressive: "Expressiva",
};

export const geminiTtsStyleDirections: Record<GeminiTtsStyle, string> = {
  professional_warm: "mantenha um tom profissional, acolhedor e prestativo",
  formal_confident: "mantenha um tom formal, seguro e respeitoso",
  empathetic_calm: "demonstre empatia, calma e atenção genuína",
  friendly_natural: "soe amigável, próxima e espontânea, sem perder o profissionalismo",
  objective_neutral: "mantenha um tom neutro, direto e objetivo",
};

export const geminiTtsExpressivenessDirections: Record<GeminiTtsExpressiveness, string> = {
  restrained: "use pouca variação emocional e entonação discreta",
  balanced: "use expressividade moderada e entonação natural",
  expressive: "use entonação mais expressiva e envolvente, sem soar teatral",
};

export const defaultAudioReplyMode: AudioReplyMode = "mirror";
export const defaultGeminiTtsVoice: GeminiTtsVoice = "Achird";
export const defaultGeminiTtsPace: GeminiTtsPace = "normal";
export const defaultGeminiTtsStyle: GeminiTtsStyle = "professional_warm";
export const defaultGeminiTtsExpressiveness: GeminiTtsExpressiveness = "balanced";

export type GeminiTtsSettings = {
  voice: GeminiTtsVoice;
  pace: GeminiTtsPace;
  style: GeminiTtsStyle;
  expressiveness: GeminiTtsExpressiveness;
  instructions: string;
};

export function shouldReplyWithAudio(mode: string, incomingMessageType: string) {
  return mode === "always" || (mode === "mirror" && incomingMessageType === "audio");
}
