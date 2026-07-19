"use client";

import {
  Archive,
  Bot,
  BotOff,
  Check,
  CheckCheck,
  ChevronDown,
  CircleUserRound,
  Download,
  FileText,
  Image as ImageIcon,
  Info,
  KeyRound,
  LoaderCircle,
  LogOut,
  Menu,
  MessageCircleMore,
  Mic,
  MoreVertical,
  Paperclip,
  PanelRightClose,
  PanelRightOpen,
  Phone,
  Plus,
  RefreshCw,
  Reply,
  Scale,
  Search,
  SendHorizontal,
  Settings,
  ShieldCheck,
  Smile,
  Sparkles,
  Square,
  Trash2,
  Users,
  Video,
  Volume2,
  X,
} from "lucide-react";
import Image from "next/image";
import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage, Conversation } from "@/lib/whatsapp-normalizers";
import {
  defaultContextMessageCount,
  defaultResponseDelaySeconds,
  maxContextMessageCount,
  maxResponseDelaySeconds,
  minContextMessageCount,
  minResponseDelaySeconds,
} from "@/lib/agent-runtime-config";
import {
  defaultAudioReplyMode,
  defaultGeminiTtsExpressiveness,
  defaultGeminiTtsPace,
  defaultGeminiTtsStyle,
  defaultGeminiTtsVoice,
  geminiTtsExpressivenessLabels,
  geminiTtsExpressivenessLevels,
  geminiTtsPaceLabels,
  geminiTtsPaces,
  geminiTtsStyleLabels,
  geminiTtsStyles,
  geminiTtsVoiceLabels,
  geminiTtsVoices,
  type AudioReplyMode,
  type GeminiTtsExpressiveness,
  type GeminiTtsPace,
  type GeminiTtsStyle,
  type GeminiTtsVoice,
} from "@/lib/tts-config";

type View = "inbox" | "agents" | "settings";
type Connection = "loading" | "open" | "closed" | "unconfigured";
type ProviderId = "openai" | "xai" | "openrouter" | "anthropic" | "google" | "groq";
type Agent = {
  id: string;
  name: string;
  description: string;
  provider: ProviderId;
  model: string;
  systemPrompt: string;
  temperature: number;
  enabled: boolean;
  responseDelaySeconds: number;
  contextMessageCount: number;
  audioReplyMode: AudioReplyMode;
  ttsVoice: GeminiTtsVoice;
  ttsPace: GeminiTtsPace;
  ttsStyle: GeminiTtsStyle;
  ttsExpressiveness: GeminiTtsExpressiveness;
  ttsInstructions: string;
  instanceName?: string | null;
  connectionConfigured?: boolean;
};

type ProviderStatus = {
  id: ProviderId;
  name: string;
  configured: boolean;
  source: "database" | "environment" | null;
};

const providerDescriptions: Record<ProviderId, string> = {
  openai: "Modelos GPT da OpenAI.",
  xai: "Modelos Grok da xAI.",
  openrouter: "Catálogo unificado de modelos do OpenRouter.",
  anthropic: "Modelos Claude da Anthropic.",
  google: "Modelos Gemini do Google AI.",
  groq: "Transcrição de áudios com Whisper Large V3 Turbo.",
};

const defaultAgent: Omit<Agent, "id"> = {
  name: "Assistente de triagem",
  description: "Primeiro atendimento e coleta de informações do potencial cliente.",
  provider: "openai",
  model: "gpt-4.1-mini",
  temperature: 0.35,
  enabled: false,
  responseDelaySeconds: defaultResponseDelaySeconds,
  contextMessageCount: defaultContextMessageCount,
  audioReplyMode: defaultAudioReplyMode,
  ttsVoice: defaultGeminiTtsVoice,
  ttsPace: defaultGeminiTtsPace,
  ttsStyle: defaultGeminiTtsStyle,
  ttsExpressiveness: defaultGeminiTtsExpressiveness,
  ttsInstructions: "",
  instanceName: null,
  systemPrompt:
    "Você é o assistente de triagem de um escritório de advocacia. Atenda com empatia e objetividade, identifique o nome da pessoa, o assunto jurídico, a cidade e a urgência. Não prometa resultado, não invente informação e não emita parecer jurídico definitivo. Quando houver risco de prazo, audiência, prisão, violência ou outra urgência, sinalize que um advogado humano deve assumir imediatamente. Finalize cada etapa com uma única pergunta clara.",
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Não foi possível concluir a operação.");
  return payload as T;
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function formatPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 13) return `+${digits.slice(0, 2)} (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
  if (digits.length === 12) return `+${digits.slice(0, 2)} (${digits.slice(2, 4)}) ${digits.slice(4, 8)}-${digits.slice(8)}`;
  return digits ? `+${digits}` : value;
}

function formatTime(timestamp: number, withDate = false) {
  if (!timestamp) return "";
  const date = new Date(timestamp < 2_000_000_000 ? timestamp * 1000 : timestamp);
  if (withDate && date.toDateString() !== new Date().toDateString()) {
    return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
  }
  return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function audioTranscript(value: string) {
  const content = value.replace(/^Transcrição do áudio:\s*/i, "").trim();
  return ["áudio", "audio", "mensagem"].includes(content.toLocaleLowerCase("pt-BR")) ? "" : content;
}

function conversationScope(conversation: Conversation) {
  return {
    agentId: conversation.agentId,
    instance: conversation.instanceName,
  };
}

function whatsappQrCode(payload: Record<string, unknown>) {
  const nested = (payload.data || payload) as Record<string, unknown>;
  const qrValue = nested.qrcode || nested.Qrcode;
  const qrObject = qrValue && typeof qrValue === "object"
    ? qrValue as Record<string, unknown>
    : nested;
  const value = String(
    nested.base64 ||
    nested.Qrcode ||
    (typeof qrValue === "string" ? qrValue : "") ||
    qrObject.base64 ||
    qrObject.qrcode ||
    qrObject.Qrcode ||
    "",
  );
  return value.startsWith("data:") ? value : value ? `data:image/png;base64,${value}` : "";
}

function Avatar({ name, src, size = "md" }: { name: string; src?: string; size?: "sm" | "md" | "lg" }) {
  return (
    <div className={`avatar avatar-${size}`}>
      {src ? <Image src={src} alt="" width={70} height={70} unoptimized /> : <span>{initials(name)}</span>}
    </div>
  );
}

function MessageMedia({ message }: { message: ChatMessage }) {
  const type = message.type.toLowerCase();
  if (!message.mediaUrl) {
    return (
      <div className="media-label">
        {type === "image" ? <ImageIcon size={16} /> : type === "audio" ? <Mic size={16} /> : <FileText size={16} />}
        {message.fileName || type}
      </div>
    );
  }

  if (type === "image") {
    return <a className="message-image" href={message.mediaUrl} target="_blank" rel="noreferrer"><Image src={message.mediaUrl} alt={message.text || "Imagem recebida"} fill sizes="(max-width: 680px) 75vw, 420px" unoptimized /></a>;
  }
  if (type === "video") {
    return <video className="message-video" src={message.mediaUrl} controls preload="none" />;
  }
  if (type === "audio") {
    return <audio className="message-audio" src={message.mediaUrl} controls preload="none" />;
  }
  return (
    <a className="media-label media-download" href={message.mediaUrl} target="_blank" rel="noreferrer" download={message.fileName}>
      <FileText size={18} /><span>{message.fileName || "Documento"}</span><Download size={15} />
    </a>
  );
}

export function AtendimentoApp() {
  const [view, setView] = useState<View>("inbox");
  const [agentFilter, setAgentFilter] = useState("all");
  const [agentConnections, setAgentConnections] = useState<Record<string, Connection>>({});
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "unread" | "groups">("all");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [togglingConversationAgent, setTogglingConversationAgent] = useState("");
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [reactionMessageId, setReactionMessageId] = useState("");
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showNewChat, setShowNewChat] = useState(false);
  const [newPhone, setNewPhone] = useState("");
  const [newMessage, setNewMessage] = useState("");
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [showDetails, setShowDetails] = useState(true);
  const [showQr, setShowQr] = useState(false);
  const [qrCode, setQrCode] = useState("");
  const [qrAgentId, setQrAgentId] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [disconnectingAgentId, setDisconnectingAgentId] = useState("");
  const [toast, setToast] = useState("");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [agentForm, setAgentForm] = useState<Omit<Agent, "id">>(defaultAgent);
  const [savingAgent, setSavingAgent] = useState(false);
  const [previewingVoice, setPreviewingVoice] = useState(false);
  const [voicePreviewUrl, setVoicePreviewUrl] = useState("");
  const [providerStatuses, setProviderStatuses] = useState<ProviderStatus[]>([]);
  const [providerKeys, setProviderKeys] = useState<Partial<Record<ProviderId, string>>>({});
  const [savingProvider, setSavingProvider] = useState<ProviderId | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const messageArea = useRef<HTMLDivElement>(null);
  const messageEnd = useRef<HTMLDivElement>(null);
  const stickMessagesToBottom = useRef(true);
  const lastRenderedMessageId = useRef("");
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const audioChunks = useRef<Blob[]>([]);
  const recordingTimer = useRef<number | null>(null);
  const presenceTimer = useRef<number | null>(null);
  const lastReadMessage = useRef("");

  const selected = conversations.find((chat) => `${chat.instanceName}::${chat.id}` === selectedId);
  const selectedAgentId = selected?.agentId;
  const selectedRemoteJid = selected?.id;
  const selectedInstanceName = selected?.instanceName;
  const selectedAgent = agents.find((agent) => agent.id === agentFilter);
  const configuredProviders = providerStatuses.filter((provider) => provider.configured);

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
  }, []);

  const loadStatus = useCallback(async (agentId: string) => {
    if (!agentId) return;
    try {
      const payload = await api<{ data: Record<string, unknown> }>(`/api/whatsapp?op=status&agentId=${encodeURIComponent(agentId)}`);
      const nested = (payload.data?.data || payload.data) as Record<string, unknown>;
      const instance = (nested?.instance || nested) as Record<string, unknown>;
      const state = String(instance?.state || instance?.connectionStatus || "").toLowerCase();
      const connected = "LoggedIn" in instance
        ? instance.LoggedIn === true
        : state === "open" || state === "connected" || instance?.Connected === true || instance?.connected === true;
      setAgentConnections((current) => ({ ...current, [agentId]: connected ? "open" : "closed" }));
      if (connected && qrAgentId === agentId) {
        setShowQr(false);
        setQrCode("");
        setQrAgentId("");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "WhatsApp indisponível.";
      setAgentConnections((current) => ({ ...current, [agentId]: message.includes("não foi configurada") ? "unconfigured" : "closed" }));
    }
  }, [qrAgentId]);

  const loadChats = useCallback(async () => {
    try {
      const scope = agentFilter === "all" ? "" : `&agentId=${encodeURIComponent(agentFilter)}`;
      const payload = await api<{ data: Conversation[] }>(`/api/whatsapp?op=chats${scope}`);
      setConversations(payload.data);
      setSelectedId((current) => current || (payload.data[0] ? `${payload.data[0].instanceName}::${payload.data[0].id}` : ""));
    } catch {
      // O estado de conexão já apresenta a orientação adequada.
    }
  }, [agentFilter]);

  const loadMessages = useCallback(async (
    conversation: Pick<Conversation, "id" | "instanceName" | "agentId">,
    quiet = false,
  ) => {
    if (!conversation.id) return;
    if (!quiet) setLoadingMessages(true);
    try {
      const payload = await api<{ data: ChatMessage[] }>(
        `/api/whatsapp?op=messages&remoteJid=${encodeURIComponent(conversation.id)}&instance=${encodeURIComponent(conversation.instanceName)}${conversation.agentId ? `&agentId=${encodeURIComponent(conversation.agentId)}` : ""}`,
        { signal: AbortSignal.timeout(15_000) },
      );
      setMessages(payload.data);
      const latestIncoming = [...payload.data].reverse().find((message) => !message.fromMe);
      if (latestIncoming && lastReadMessage.current !== latestIncoming.id) {
        lastReadMessage.current = latestIncoming.id;
        void api("/api/whatsapp", {
          method: "POST",
          body: JSON.stringify({
            action: "mark-read",
            remoteJid: conversation.id,
            agentId: conversation.agentId,
            instance: conversation.instanceName,
            messageId: latestIncoming.id,
            fromMe: false,
          }),
        }).then(() => {
          setConversations((current) => current.map((chat) => chat.id === conversation.id && chat.instanceName === conversation.instanceName ? { ...chat, unread: 0 } : chat));
        }).catch(() => undefined);
      }
    } catch (error) {
      if (!quiet) notify(error instanceof DOMException && ["AbortError", "TimeoutError"].includes(error.name)
        ? "O histórico demorou para responder. Tente atualizar novamente."
        : error instanceof Error ? error.message : "Erro ao carregar mensagens.");
    } finally {
      setLoadingMessages(false);
    }
  }, [notify]);

  const loadAgents = useCallback(async () => {
    try {
      const payload = await api<{ data: Agent[] }>("/api/agents");
      setAgents(payload.data);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Erro ao carregar agentes.");
    }
  }, [notify]);

  const loadProviderSettings = useCallback(async () => {
    try {
      const payload = await api<{ data: ProviderStatus[] }>("/api/settings/providers");
      setProviderStatuses(payload.data);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Erro ao carregar as chaves de IA.");
    }
  }, [notify]);

  useEffect(() => {
    const kickoff = window.setTimeout(loadAgents, 0);
    return () => window.clearTimeout(kickoff);
  }, [loadAgents]);

  useEffect(() => {
    if (!agents.length) return;
    const refresh = () => agents.forEach((agent) => void loadStatus(agent.id));
    const kickoff = window.setTimeout(refresh, 0);
    const timer = window.setInterval(refresh, 12000);
    return () => { window.clearTimeout(kickoff); window.clearInterval(timer); };
  }, [agents, loadStatus]);

  useEffect(() => {
    if (!showQr) return;
    if (!qrAgentId) return;
    const timer = window.setInterval(() => loadStatus(qrAgentId), 2500);
    return () => window.clearInterval(timer);
  }, [showQr, qrAgentId, loadStatus]);

  useEffect(() => {
    const kickoff = window.setTimeout(loadChats, 0);
    const timer = window.setInterval(loadChats, 8000);
    return () => { window.clearTimeout(kickoff); window.clearInterval(timer); };
  }, [loadChats]);

  useEffect(() => {
    if (!selectedRemoteJid || !selectedInstanceName) return;
    lastReadMessage.current = "";
    stickMessagesToBottom.current = true;
    lastRenderedMessageId.current = "";
    const conversation = {
      id: selectedRemoteJid,
      instanceName: selectedInstanceName,
      agentId: selectedAgentId,
    };
    const kickoff = window.setTimeout(() => loadMessages(conversation), 0);
    const timer = window.setInterval(() => loadMessages(conversation, true), 4500);
    return () => { window.clearTimeout(kickoff); window.clearInterval(timer); };
  }, [selectedAgentId, selectedInstanceName, selectedRemoteJid, loadMessages]);

  useEffect(() => {
    const latestMessageId = messages.at(-1)?.id || "";
    if (!latestMessageId || latestMessageId === lastRenderedMessageId.current) return;
    const hadMessages = Boolean(lastRenderedMessageId.current);
    lastRenderedMessageId.current = latestMessageId;
    if (!stickMessagesToBottom.current) return;

    const frame = window.requestAnimationFrame(() => {
      messageEnd.current?.scrollIntoView({
        behavior: hadMessages ? "smooth" : "auto",
        block: "end",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages]);

  useEffect(() => () => {
    if (recordingTimer.current) window.clearInterval(recordingTimer.current);
    if (presenceTimer.current) window.clearTimeout(presenceTimer.current);
    if (mediaRecorder.current?.state === "recording") mediaRecorder.current.stop();
  }, []);

  useEffect(() => () => {
    if (voicePreviewUrl) URL.revokeObjectURL(voicePreviewUrl);
  }, [voicePreviewUrl]);

  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    return conversations.filter((chat) => {
      if (filter === "unread" && !chat.unread) return false;
      if (filter === "groups" && !chat.isGroup) return false;
      return !term || `${chat.name} ${chat.phone} ${chat.lastMessage}`.toLocaleLowerCase("pt-BR").includes(term);
    });
  }, [conversations, filter, search]);

  async function connectWhatsapp(agent: Agent) {
    setConnecting(true);
    setShowQr(true);
    setQrCode("");
    setQrAgentId(agent.id);
    setAgentConnections((current) => ({ ...current, [agent.id]: "loading" }));
    try {
      try {
        await api("/api/whatsapp", {
          method: "POST",
          body: JSON.stringify({ action: "create-instance", agentId: agent.id }),
        });
      } catch {
        // Instância já existente; segue para gerar o QR.
      }
      const payload = await api<{ data: Record<string, unknown> }>(`/api/whatsapp?op=connect&agentId=${encodeURIComponent(agent.id)}`);
      const qr = whatsappQrCode(payload.data);
      setQrCode(qr);
      if (!qr) notify("A instância já pode estar conectada. Atualizando o status...");
      window.setTimeout(() => loadStatus(agent.id), 2500);
    } catch (error) {
      setAgentConnections((current) => ({ ...current, [agent.id]: "closed" }));
      notify(error instanceof Error ? error.message : "Não foi possível gerar o QR Code.");
    } finally {
      setConnecting(false);
    }
  }

  async function refreshWhatsappQr(agent: Agent) {
    setConnecting(true);
    setQrCode("");
    try {
      const payload = await api<{ data: Record<string, unknown> }>(`/api/whatsapp?op=qr&agentId=${encodeURIComponent(agent.id)}`);
      const qr = whatsappQrCode(payload.data);
      setQrCode(qr);
      if (!qr) notify("A Evolution ainda não disponibilizou um novo QR Code. Tente novamente em alguns segundos.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Não foi possível atualizar o QR Code.");
    } finally {
      setConnecting(false);
    }
  }

  async function disconnectWhatsapp(agent: Agent) {
    if (!window.confirm("Desconectar o WhatsApp deste agente? Para conectar novamente, será necessário escanear um novo QR Code.")) return;
    setDisconnectingAgentId(agent.id);
    try {
      await api("/api/whatsapp", {
        method: "POST",
        body: JSON.stringify({ action: "disconnect", agentId: agent.id }),
      });
      if (qrAgentId === agent.id) {
        setShowQr(false);
        setQrCode("");
        setQrAgentId("");
      }
      setAgentConnections((current) => ({ ...current, [agent.id]: "closed" }));
      notify("WhatsApp desconectado. Agora você pode gerar um novo QR Code.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Não foi possível desconectar o WhatsApp.");
      await loadStatus(agent.id);
    } finally {
      setDisconnectingAgentId("");
    }
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim() || !selected || sending) return;
    setSending(true);
    try {
      await api("/api/whatsapp", {
        method: "POST",
        body: JSON.stringify({
          action: "send-text",
          remoteJid: selected.id,
          ...conversationScope(selected),
          text: draft.trim(),
          quotedId: replyingTo?.id,
        }),
      });
      setDraft("");
      setReplyingTo(null);
      stickMessagesToBottom.current = true;
      await loadMessages(selected, true);
      loadChats();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Mensagem não enviada.");
    } finally {
      setSending(false);
    }
  }

  async function sendMediaFile(file: File, caption = draft.trim()) {
    if (!selected) return;
    if (file.size > 15 * 1024 * 1024) {
      notify("O arquivo deve ter no máximo 15 MB.");
      return;
    }
    const mediaType = file.type.startsWith("image/")
      ? "image"
      : file.type.startsWith("video/")
        ? "video"
        : file.type.startsWith("audio/")
          ? "audio"
          : "document";
    const encoded = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("Não foi possível ler o arquivo."));
      reader.readAsDataURL(file);
    });
    setSending(true);
    try {
      await api("/api/whatsapp", {
        method: "POST",
        body: JSON.stringify({
          action: "send-media",
          remoteJid: selected.id,
          ...conversationScope(selected),
          media: encoded,
          mediaType,
          mimeType: file.type || "application/octet-stream",
          fileName: file.name,
          caption: caption || undefined,
        }),
      });
      setDraft("");
      setReplyingTo(null);
      stickMessagesToBottom.current = true;
      await loadMessages(selected, true);
      loadChats();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Arquivo não enviado.");
    } finally {
      setSending(false);
    }
  }

  async function sendFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) await sendMediaFile(file);
    event.target.value = "";
  }

  async function toggleRecording() {
    if (recording) {
      mediaRecorder.current?.stop();
      return;
    }
    if (!selected) return;
    if (!window.isSecureContext) {
      notify("O microfone exige uma conexão HTTPS segura. Abra a versão https deste CRM.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      notify("A gravação de áudio não é suportada neste navegador.");
      return;
    }
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferred = [
        "audio/webm;codecs=opus",
        "audio/mp4",
        "audio/ogg;codecs=opus",
        "audio/webm",
      ].find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = preferred
        ? new MediaRecorder(stream, { mimeType: preferred })
        : new MediaRecorder(stream);
      const mimeType = recorder.mimeType || preferred || "audio/webm";
      audioChunks.current = [];
      recorder.ondataavailable = (event) => { if (event.data.size) audioChunks.current.push(event.data); };
      recorder.onstop = async () => {
        stream?.getTracks().forEach((track) => track.stop());
        if (recordingTimer.current) window.clearInterval(recordingTimer.current);
        recordingTimer.current = null;
        setRecording(false);
        setRecordingSeconds(0);
        void api("/api/whatsapp", { method: "POST", body: JSON.stringify({ action: "presence", remoteJid: selected.id, presence: "paused", ...conversationScope(selected) }) }).catch(() => undefined);
        const blob = new Blob(audioChunks.current, { type: mimeType });
        const extension = mimeType.includes("mp4") ? "m4a" : mimeType.includes("ogg") ? "ogg" : "webm";
        if (blob.size) await sendMediaFile(new File([blob], `audio-${Date.now()}.${extension}`, { type: mimeType }), "");
      };
      mediaRecorder.current = recorder;
      recorder.start(250);
      setRecording(true);
      setRecordingSeconds(0);
      recordingTimer.current = window.setInterval(() => setRecordingSeconds((seconds) => seconds + 1), 1000);
      void api("/api/whatsapp", { method: "POST", body: JSON.stringify({ action: "presence", remoteJid: selected.id, presence: "recording", ...conversationScope(selected) }) }).catch(() => undefined);
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      const name = error instanceof DOMException ? error.name : "";
      notify(name === "NotFoundError"
        ? "Nenhum microfone foi encontrado neste dispositivo."
        : "Permita o acesso ao microfone para gravar áudio.");
    }
  }

  function changeDraft(value: string) {
    setDraft(value);
    if (!selected) return;
    if (presenceTimer.current) window.clearTimeout(presenceTimer.current);
    if (value) void api("/api/whatsapp", { method: "POST", body: JSON.stringify({ action: "presence", remoteJid: selected.id, presence: "composing", ...conversationScope(selected) }) }).catch(() => undefined);
    presenceTimer.current = window.setTimeout(() => {
      void api("/api/whatsapp", { method: "POST", body: JSON.stringify({ action: "presence", remoteJid: selected.id, presence: "paused", ...conversationScope(selected) }) }).catch(() => undefined);
    }, 1400);
  }

  async function reactToMessage(message: ChatMessage, reaction: string) {
    if (!selected) return;
    try {
      await api("/api/whatsapp", { method: "POST", body: JSON.stringify({ action: "reaction", remoteJid: selected.id, messageId: message.id, fromMe: message.fromMe, reaction, ...conversationScope(selected) }) });
      setReactionMessageId("");
      notify("Reação enviada.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Reação não enviada.");
    }
  }

  async function deleteMessage(message: ChatMessage) {
    if (!selected || !window.confirm("Apagar esta mensagem para todos?")) return;
    try {
      await api("/api/whatsapp", { method: "POST", body: JSON.stringify({ action: "delete-message", remoteJid: selected.id, messageId: message.id, fromMe: message.fromMe, ...conversationScope(selected) }) });
      setMessages((current) => current.filter((item) => item.id !== message.id));
      notify("Mensagem apagada.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Mensagem não apagada.");
    }
  }

  async function archiveConversation() {
    if (!selected) return;
    const messageId = messages.at(-1)?.id;
    if (!messageId) return;
    try {
      await api("/api/whatsapp", { method: "POST", body: JSON.stringify({ action: "archive", remoteJid: selected.id, messageId, archive: true, ...conversationScope(selected) }) });
      setConversations((current) => current.filter((chat) => chat.id !== selected.id || chat.instanceName !== selected.instanceName));
      setSelectedId("");
      notify("Conversa arquivada.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Conversa não arquivada.");
    }
  }

  async function toggleConversationAgent() {
    if (!selected) return;
    const key = `${selected.instanceName}::${selected.id}`;
    const agentPaused = !selected.agentPaused;
    setTogglingConversationAgent(key);
    setConversations((current) => current.map((conversation) =>
      conversation.id === selected.id && conversation.instanceName === selected.instanceName
        ? { ...conversation, agentPaused }
        : conversation
    ));
    try {
      await api("/api/whatsapp", {
        method: "POST",
        body: JSON.stringify({
          action: "set-agent-paused",
          paused: agentPaused,
          remoteJid: selected.id,
          ...conversationScope(selected),
        }),
      });
      notify(agentPaused ? "Agente pausado nesta conversa." : "Agente reativado nesta conversa.");
    } catch (error) {
      setConversations((current) => current.map((conversation) =>
        conversation.id === selected.id && conversation.instanceName === selected.instanceName
          ? { ...conversation, agentPaused: !agentPaused }
          : conversation
      ));
      notify(error instanceof Error ? error.message : "Não foi possível alterar o agente desta conversa.");
    } finally {
      setTogglingConversationAgent("");
    }
  }

  async function startConversation(event: FormEvent) {
    event.preventDefault();
    if (!selectedAgent) {
      notify("Selecione o agente que enviará a nova mensagem.");
      return;
    }
    let digits = newPhone.replace(/\D/g, "");
    if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
    if (digits.length < 10 || !newMessage.trim()) {
      notify("Informe o número com DDD e a primeira mensagem.");
      return;
    }
    const remoteJid = `${digits}@s.whatsapp.net`;
    setSending(true);
    try {
      await api("/api/whatsapp", { method: "POST", body: JSON.stringify({ action: "send-text", agentId: selectedAgent.id, remoteJid, text: newMessage.trim() }) });
      const conversation: Conversation = { id: remoteJid, instanceName: selectedAgent.instanceName || "", agentId: selectedAgent.id, agentName: selectedAgent.name, name: digits, phone: digits, lastMessage: newMessage.trim(), lastMessageAt: Math.floor(Date.now() / 1000), unread: 0, archived: false, pinned: false, isGroup: false, agentPaused: false };
      setConversations((current) => [conversation, ...current.filter((chat) => chat.id !== remoteJid || chat.instanceName !== conversation.instanceName)]);
      setSelectedId(`${conversation.instanceName}::${remoteJid}`);
      setShowNewChat(false);
      setNewPhone("");
      setNewMessage("");
      window.setTimeout(() => loadMessages(conversation, true), 700);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Não foi possível iniciar a conversa.");
    } finally {
      setSending(false);
    }
  }

  async function saveAgent(event: FormEvent) {
    event.preventDefault();
    setSavingAgent(true);
    try {
      const payload = await api<{ data: Agent }>("/api/agents", {
        method: "POST",
        body: JSON.stringify({ ...agentForm, id: editingAgent?.id }),
      });
      notify(editingAgent ? "Agente atualizado." : "Agente criado. Agora conecte o WhatsApp deste agente.");
      setEditingAgent(payload.data);
      setAgentForm({
        name: payload.data.name,
        description: payload.data.description,
        provider: payload.data.provider,
        model: payload.data.model,
        systemPrompt: payload.data.systemPrompt,
        temperature: payload.data.temperature,
        enabled: payload.data.enabled,
        responseDelaySeconds: payload.data.responseDelaySeconds ?? defaultResponseDelaySeconds,
        contextMessageCount: payload.data.contextMessageCount ?? defaultContextMessageCount,
        audioReplyMode: payload.data.audioReplyMode || defaultAudioReplyMode,
        ttsVoice: payload.data.ttsVoice || defaultGeminiTtsVoice,
        ttsPace: payload.data.ttsPace || defaultGeminiTtsPace,
        ttsStyle: payload.data.ttsStyle || defaultGeminiTtsStyle,
        ttsExpressiveness: payload.data.ttsExpressiveness || defaultGeminiTtsExpressiveness,
        ttsInstructions: payload.data.ttsInstructions || "",
        instanceName: payload.data.instanceName,
      });
      await loadAgents();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Não foi possível salvar o agente.");
    } finally {
      setSavingAgent(false);
    }
  }

  async function previewAgentVoice() {
    if (agentForm.audioReplyMode === "never" || previewingVoice) return;
    setPreviewingVoice(true);
    try {
      const response = await fetch("/api/agents/voice-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ttsVoice: agentForm.ttsVoice,
          ttsPace: agentForm.ttsPace,
          ttsStyle: agentForm.ttsStyle,
          ttsExpressiveness: agentForm.ttsExpressiveness,
          ttsInstructions: agentForm.ttsInstructions,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Não foi possível gerar a prévia da voz.");
      }
      setVoicePreviewUrl(URL.createObjectURL(await response.blob()));
    } catch (error) {
      notify(error instanceof Error ? error.message : "Não foi possível gerar a prévia da voz.");
    } finally {
      setPreviewingVoice(false);
    }
  }

  function editAgent(agent: Agent) {
    setVoicePreviewUrl("");
    setEditingAgent(agent);
    setAgentForm({
      name: agent.name,
      description: agent.description,
      provider: agent.provider,
      model: agent.model,
      systemPrompt: agent.systemPrompt,
      temperature: agent.temperature,
      enabled: agent.enabled,
      responseDelaySeconds: agent.responseDelaySeconds ?? defaultResponseDelaySeconds,
      contextMessageCount: agent.contextMessageCount ?? defaultContextMessageCount,
      audioReplyMode: agent.audioReplyMode || defaultAudioReplyMode,
      ttsVoice: agent.ttsVoice || defaultGeminiTtsVoice,
      ttsPace: agent.ttsPace || defaultGeminiTtsPace,
      ttsStyle: agent.ttsStyle || defaultGeminiTtsStyle,
      ttsExpressiveness: agent.ttsExpressiveness || defaultGeminiTtsExpressiveness,
      ttsInstructions: agent.ttsInstructions || "",
      instanceName: agent.instanceName,
    });
    void loadStatus(agent.id);
  }

  async function deleteAgent(id: string) {
    if (!window.confirm("Remover este agente?")) return;
    try {
      await api(`/api/agents?id=${id}`, { method: "DELETE" });
      notify("Agente removido.");
      loadAgents();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Não foi possível remover o agente.");
    }
  }

  async function saveProviderCredential(event: FormEvent, provider: ProviderId) {
    event.preventDefault();
    const apiKey = providerKeys[provider]?.trim();
    if (!apiKey) {
      notify("Informe a chave antes de salvar.");
      return;
    }
    setSavingProvider(provider);
    try {
      const payload = await api<{ data: ProviderStatus[] }>("/api/settings/providers", {
        method: "POST",
        body: JSON.stringify({ provider, apiKey }),
      });
      setProviderStatuses(payload.data);
      setProviderKeys((current) => ({ ...current, [provider]: "" }));
      notify("Chave salva e protegida.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Não foi possível salvar a chave.");
    } finally {
      setSavingProvider(null);
    }
  }

  async function removeProviderCredential(provider: ProviderId) {
    if (!window.confirm("Remover a chave salva neste CRM?")) return;
    setSavingProvider(provider);
    try {
      const payload = await api<{ data: ProviderStatus[] }>(
        `/api/settings/providers?provider=${encodeURIComponent(provider)}`,
        { method: "DELETE" },
      );
      setProviderStatuses(payload.data);
      notify("Chave removida.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Não foi possível remover a chave.");
    } finally {
      setSavingProvider(null);
    }
  }

  return (
    <main className="app-shell">
      <aside className="primary-nav" aria-label="Navegação principal">
        <div className="brand-mark" title="Inovalot Panel">
          <Image src="/logo-inovalot-icon.png" alt="Inovalot Panel" width={32} height={31} priority />
        </div>
        <nav>
          <button className={view === "inbox" ? "active" : ""} onClick={() => setView("inbox")} title="Atendimento">
            <MessageCircleMore size={21} /><span>Atendimento</span>
          </button>
          <button className={view === "agents" ? "active" : ""} onClick={() => { setView("agents"); loadAgents(); }} title="Agentes">
            <Bot size={21} /><span>Agentes</span>
          </button>
          <button className={view === "settings" ? "active" : ""} onClick={() => { setView("settings"); loadProviderSettings(); }} title="Ajustes">
            <Settings size={21} /><span>Ajustes</span>
          </button>
          <button disabled title="Contatos — próxima etapa"><Users size={21} /><span>Contatos</span></button>
        </nav>
        <div className="nav-bottom">
          <div className="user-avatar">TA</div>
        </div>
      </aside>

      {view === "inbox" ? (
        <section className="workspace">
          <aside className="conversation-panel">
            <header className="panel-header">
              <div>
                <p className="eyebrow">Central de mensagens</p>
                <h1>Atendimento</h1>
              </div>
              <button className="icon-button" title="Nova conversa" onClick={() => selectedAgent ? setShowNewChat(true) : notify("Selecione um agente antes de iniciar uma conversa.")}><Plus size={20} /></button>
            </header>
            <div className="inbox-agent-filter">
              <label htmlFor="inbox-agent">Caixa de entrada</label>
              <div>
                <Bot size={17} />
                <select id="inbox-agent" value={agentFilter} onChange={(event) => { setAgentFilter(event.target.value); setSelectedId(""); }}>
                  <option value="all">Todos os agentes</option>
                  {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
                </select>
                <ChevronDown size={16} />
              </div>
              <button className="tiny-button" onClick={() => loadChats()} title="Atualizar"><RefreshCw size={14} /></button>
            </div>
            <div className="search-box"><Search size={17} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar conversa ou contato" /></div>
            <div className="filter-tabs" role="tablist">
              <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>Todas</button>
              <button className={filter === "unread" ? "active" : ""} onClick={() => setFilter("unread")}>Não lidas</button>
              <button className={filter === "groups" ? "active" : ""} onClick={() => setFilter("groups")}>Grupos</button>
            </div>
            <div className="conversation-list">
              {filtered.map((chat) => (
                <button key={`${chat.instanceName}::${chat.id}`} className={`conversation-item ${`${chat.instanceName}::${chat.id}` === selectedId ? "selected" : ""}`} onClick={() => { setSelectedId(`${chat.instanceName}::${chat.id}`); setReplyingTo(null); setReactionMessageId(""); }}>
                  <Avatar name={chat.name} src={chat.avatar} />
                  <span className="conversation-copy">
                    <span className="conversation-top"><strong>{chat.name}</strong><time>{formatTime(chat.lastMessageAt, true)}</time></span>
                    {agentFilter === "all" && <small className="conversation-agent"><Bot size={10} /> {chat.agentName}</small>}
                    <span className="conversation-bottom"><span>{chat.lastMessageType?.toLowerCase() === "audio" && audioTranscript(chat.lastMessage) ? <em>“{audioTranscript(chat.lastMessage)}”</em> : chat.lastMessage}</span>{chat.unread > 0 && <b>{chat.unread > 99 ? "99+" : chat.unread}</b>}</span>
                  </span>
                </button>
              ))}
              {!filtered.length && (
                <div className="list-empty">
                  <MessageCircleMore size={28} />
                  <strong>Nenhuma conversa</strong>
                  <p>{agents.length ? "As conversas desta caixa aparecerão aqui." : "Crie um agente e conecte o WhatsApp na configuração dele."}</p>
                </div>
              )}
            </div>
          </aside>

          <section className="chat-panel">
            {selected ? (
              <>
                <header className="chat-header">
                  <button className="mobile-back" onClick={() => setSelectedId("")}><Menu size={20} /></button>
                  <Avatar name={selected.name} src={selected.avatar} />
                  <div className="chat-contact"><strong>{selected.name}</strong><span>{formatPhone(selected.phone)} · {selected.agentName}{selected.agentPaused ? " · Agente pausado" : ""}</span></div>
                  <div className="chat-actions">
                    <button title="Chamadas não são disponibilizadas pela integração" disabled><Video size={19} /></button>
                    <button title="Chamadas não são disponibilizadas pela integração" disabled><Phone size={19} /></button>
                    <button
                      className={`agent-conversation-toggle ${selected.agentPaused ? "paused" : ""}`}
                      title={selected.agentPaused ? "Ativar agente nesta conversa" : "Pausar agente nesta conversa"}
                      aria-label={selected.agentPaused ? "Ativar agente nesta conversa" : "Pausar agente nesta conversa"}
                      aria-pressed={selected.agentPaused}
                      onClick={toggleConversationAgent}
                      disabled={togglingConversationAgent === `${selected.instanceName}::${selected.id}`}
                    >
                      {togglingConversationAgent === `${selected.instanceName}::${selected.id}` ? <LoaderCircle className="spin" size={19} /> : selected.agentPaused ? <BotOff size={19} /> : <Bot size={19} />}
                    </button>
                    <button title={showDetails ? "Fechar detalhes" : "Abrir detalhes"} onClick={() => setShowDetails(!showDetails)}>{showDetails ? <PanelRightClose size={19} /> : <PanelRightOpen size={19} />}</button>
                    <button title="Mais opções"><MoreVertical size={19} /></button>
                  </div>
                </header>
                <div
                  className="message-area"
                  ref={messageArea}
                  onScroll={() => {
                    const area = messageArea.current;
                    if (!area) return;
                    stickMessagesToBottom.current = area.scrollHeight - area.scrollTop - area.clientHeight < 96;
                  }}
                >
                  <div className="encryption-note"><Info size={13} /> Mensagens protegidas pela conexão do WhatsApp</div>
                  {loadingMessages && !messages.length ? (
                    <div className="messages-loading"><LoaderCircle className="spin" size={24} /> Carregando histórico...</div>
                  ) : messages.map((message) => {
                    const quoted = message.quotedId ? messages.find((item) => item.id === message.quotedId) : undefined;
                    const type = message.type.toLowerCase();
                    const transcription = type === "audio" ? audioTranscript(message.text) : "";
                    return (
                      <article key={message.id} className={`message-bubble ${message.fromMe ? "outgoing" : "incoming"}`}>
                        <div className="message-actions">
                          <button type="button" title="Responder" onClick={() => setReplyingTo(message)}><Reply size={14} /></button>
                          <button type="button" title="Reagir" onClick={() => setReactionMessageId((current) => current === message.id ? "" : message.id)}><Smile size={14} /></button>
                          {message.fromMe && <button type="button" title="Apagar para todos" onClick={() => deleteMessage(message)}><Trash2 size={14} /></button>}
                        </div>
                        {reactionMessageId === message.id && <div className="reaction-picker">{["👍", "❤️", "😂", "😮", "😢", "🙏"].map((emoji) => <button type="button" key={emoji} onClick={() => reactToMessage(message, emoji)}>{emoji}</button>)}</div>}
                        {quoted && <button type="button" className="quoted-message" onClick={() => document.getElementById(`message-${quoted.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })}><strong>{quoted.fromMe ? "Você" : selected.name}</strong><span>{quoted.text}</span></button>}
                        <div id={`message-${message.id}`}>
                          {!(["text", "extendedtext"].includes(type)) && <MessageMedia message={message} />}
                          {type === "audio"
                            ? transcription && <p><em>“{transcription}”</em></p>
                            : message.text && !(["image", "video", "document"].includes(type) && message.text === message.fileName) && <p>{message.text}</p>}
                        </div>
                        <footer><time>{formatTime(message.timestamp)}</time>{message.fromMe && (String(message.status).toUpperCase() === "READ" ? <CheckCheck size={15} /> : <Check size={15} />)}</footer>
                      </article>
                    );
                  })}
                  {!loadingMessages && !messages.length && <div className="messages-loading">O histórico desta conversa está vazio.</div>}
                  <div ref={messageEnd} />
                </div>
                {replyingTo && <div className="reply-preview"><Reply size={17} /><span><strong>Respondendo {replyingTo.fromMe ? "a você" : `a ${selected.name}`}</strong><small>{replyingTo.text}</small></span><button type="button" onClick={() => setReplyingTo(null)}><X size={16} /></button></div>}
                <form className={`composer ${recording ? "is-recording" : ""}`} onSubmit={sendMessage}>
                  <button type="button" title="Emoji" onClick={() => setShowEmojiPicker((value) => !value)}><Smile size={21} /></button>
                  {showEmojiPicker && <div className="emoji-picker">{["😀", "😊", "👍", "🙏", "❤️", "✅", "📎", "⚖️", "📅", "👋"].map((emoji) => <button type="button" key={emoji} onClick={() => { setDraft((value) => `${value}${emoji}`); setShowEmojiPicker(false); }}>{emoji}</button>)}</div>}
                  <button type="button" title="Anexar arquivo" onClick={() => fileInput.current?.click()}><Paperclip size={21} /></button>
                  <input ref={fileInput} type="file" hidden onChange={sendFile} />
                  {recording ? <div className="recording-status"><i /> Gravando áudio <time>{Math.floor(recordingSeconds / 60).toString().padStart(2, "0")}:{(recordingSeconds % 60).toString().padStart(2, "0")}</time></div> : <textarea rows={1} value={draft} onChange={(e) => changeDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} placeholder="Digite uma mensagem" aria-label="Mensagem" />}
                  <button type={draft.trim() && !recording ? "submit" : "button"} onClick={!draft.trim() || recording ? toggleRecording : undefined} className={`send-button ${recording ? "recording-button" : ""}`} disabled={sending} aria-label={recording ? "Parar e enviar gravação" : draft.trim() ? "Enviar mensagem" : "Gravar áudio"}>{sending ? <LoaderCircle className="spin" size={20} /> : recording ? <Square size={17} fill="currentColor" /> : draft.trim() ? <SendHorizontal size={20} /> : <Mic size={20} />}</button>
                </form>
              </>
            ) : (
              <div className="chat-empty"><div className="empty-illustration"><Scale size={38} /></div><h2>Atendimento jurídico, em um só lugar</h2><p>Selecione uma conversa para visualizar o histórico e responder pelo WhatsApp.</p><span><Sparkles size={15} /> Agentes podem assumir a triagem quando você ativá-los</span></div>
            )}
          </section>

          {selected && showDetails && (
            <aside className="details-panel">
              <header><h2>Detalhes</h2><button className="icon-button" onClick={() => setShowDetails(false)}><X size={18} /></button></header>
              <div className="contact-card"><Avatar name={selected.name} src={selected.avatar} size="lg" /><h3>{selected.name}</h3><p>{formatPhone(selected.phone)}</p><span className="status-badge"><i /> WhatsApp</span></div>
              <div className="detail-section"><label>Responsável</label><button className="select-row"><span className="mini-agent"><CircleUserRound size={18} /> Não atribuído</span><ChevronDown size={16} /></button></div>
              <div className="detail-section"><label>Agente e canal</label><button className="select-row" onClick={() => { const linked = agents.find((agent) => agent.id === selected.agentId); if (linked) editAgent(linked); setView("agents"); }}><span className="mini-agent"><Bot size={18} /> {selected.agentName}</span><ChevronDown size={16} /></button></div>
              <div className="detail-section"><label>Etiquetas</label><button className="outline-dashed"><Plus size={15} /> Adicionar etiqueta</button></div>
              <div className="detail-section"><label>Notas internas</label><textarea placeholder="Adicione uma observação sobre este atendimento..." rows={4} /></div>
              <div className="detail-actions"><button onClick={archiveConversation}><Archive size={16} /> Arquivar conversa</button></div>
            </aside>
          )}
        </section>
      ) : view === "agents" ? (
        <section className="agents-workspace">
          <header className="agents-title"><div><p className="eyebrow">Automação de atendimento</p><h1>Agentes de IA</h1><p>Configure o comportamento, o modelo e a instância de WhatsApp de cada agente.</p></div><button className="secondary-button" onClick={() => { setEditingAgent(null); setAgentForm(defaultAgent); setVoicePreviewUrl(""); }}><Plus size={17} /> Novo agente</button></header>
          <div className="agents-grid">
            <div className="agent-list-card">
              <div className="card-heading"><h2>Seus agentes</h2><span>{agents.length}</span></div>
              {agents.length ? agents.map((agent) => (
                <button key={agent.id} className={`agent-row ${editingAgent?.id === agent.id ? "selected" : ""}`} onClick={() => editAgent(agent)}>
                  <span className="agent-icon"><Bot size={20} /></span>
                  <span><strong>{agent.name}</strong><small>{agentConnections[agent.id] === "open" ? "WhatsApp conectado" : "WhatsApp pendente"} · {agent.provider}</small></span>
                  <i className={agent.enabled ? "enabled" : ""}>{agent.enabled ? "Automação ativa" : "Automação pausada"}</i>
                </button>
              )) : <div className="agent-empty"><Bot size={30} /><strong>Nenhum agente criado</strong><p>Preencha o formulário para criar o primeiro agente de triagem.</p></div>}
            </div>
            <form className="agent-form-card" onSubmit={saveAgent}>
              <div className="card-heading"><div><h2>{editingAgent ? "Editar agente" : "Novo agente"}</h2><p>As alterações entram em vigor no próximo atendimento.</p></div>{editingAgent && <button type="button" className="delete-icon" onClick={() => deleteAgent(editingAgent.id)}><Trash2 size={18} /></button>}</div>
              <div className="form-grid">
                <label className="span-2">Nome<input required value={agentForm.name} onChange={(e) => setAgentForm({ ...agentForm, name: e.target.value })} /></label>
                <label className="span-2">Descrição<input value={agentForm.description} onChange={(e) => setAgentForm({ ...agentForm, description: e.target.value })} /></label>
                <label>Provedor<select value={agentForm.provider} onChange={(e) => setAgentForm({ ...agentForm, provider: e.target.value as Agent["provider"] })}><option value="openai">OpenAI</option><option value="xai">xAI (Grok)</option><option value="openrouter">OpenRouter</option><option value="anthropic">Anthropic</option><option value="google">Google</option></select></label>
                <label>Modelo<input required value={agentForm.model} onChange={(e) => setAgentForm({ ...agentForm, model: e.target.value })} placeholder="gpt-4.1-mini" /></label>
                <label className="span-2">Temperatura<div className="range-row"><input type="range" min="0" max="2" step="0.05" value={agentForm.temperature} onChange={(e) => setAgentForm({ ...agentForm, temperature: Number(e.target.value) })} /><output>{agentForm.temperature.toFixed(2)}</output></div></label>
                <label>Tempo de resposta (segundos)<input type="number" min={minResponseDelaySeconds} max={maxResponseDelaySeconds} step="1" value={agentForm.responseDelaySeconds} onChange={(e) => setAgentForm({ ...agentForm, responseDelaySeconds: Number(e.target.value) })} /><small>A janela reinicia quando chega uma nova mensagem.</small></label>
                <label>Mensagens no contexto<input type="number" min={minContextMessageCount} max={maxContextMessageCount} step="1" value={agentForm.contextMessageCount} onChange={(e) => setAgentForm({ ...agentForm, contextMessageCount: Number(e.target.value) })} /><small>Quantidade máxima de mensagens anteriores enviadas à IA.</small></label>
                <label>Respostas em áudio<select value={agentForm.audioReplyMode} onChange={(e) => { setAgentForm({ ...agentForm, audioReplyMode: e.target.value as AudioReplyMode }); setVoicePreviewUrl(""); }}><option value="mirror">Responder em áudio quando receber áudio</option><option value="always">Responder sempre em áudio</option><option value="never">Responder sempre em texto</option></select></label>
                <div className={`voice-settings-card span-2 ${agentForm.audioReplyMode === "never" ? "disabled" : ""}`}>
                  <header>
                    <span><Volume2 size={20} /></span>
                    <div><strong>Personalidade da voz</strong><small>A prévia usa exatamente as configurações aplicadas nas respostas do WhatsApp.</small></div>
                    <button type="button" className="secondary-button" onClick={previewAgentVoice} disabled={agentForm.audioReplyMode === "never" || previewingVoice}>
                      {previewingVoice ? <LoaderCircle className="spin" size={16} /> : <Volume2 size={16} />}
                      {previewingVoice ? "Gerando..." : "Ouvir prévia"}
                    </button>
                  </header>
                  <div className="voice-settings-grid">
                    <label>Voz do agente<select value={agentForm.ttsVoice} disabled={agentForm.audioReplyMode === "never"} onChange={(e) => { setAgentForm({ ...agentForm, ttsVoice: e.target.value as GeminiTtsVoice }); setVoicePreviewUrl(""); }}>{geminiTtsVoices.map((voice) => <option key={voice} value={voice}>{geminiTtsVoiceLabels[voice]}</option>)}</select></label>
                    <label>Velocidade<select value={agentForm.ttsPace} disabled={agentForm.audioReplyMode === "never"} onChange={(e) => { setAgentForm({ ...agentForm, ttsPace: e.target.value as GeminiTtsPace }); setVoicePreviewUrl(""); }}>{geminiTtsPaces.map((pace) => <option key={pace} value={pace}>{geminiTtsPaceLabels[pace]}</option>)}</select></label>
                    <label>Estilo e tom<select value={agentForm.ttsStyle} disabled={agentForm.audioReplyMode === "never"} onChange={(e) => { setAgentForm({ ...agentForm, ttsStyle: e.target.value as GeminiTtsStyle }); setVoicePreviewUrl(""); }}>{geminiTtsStyles.map((style) => <option key={style} value={style}>{geminiTtsStyleLabels[style]}</option>)}</select></label>
                    <label>Expressividade<select value={agentForm.ttsExpressiveness} disabled={agentForm.audioReplyMode === "never"} onChange={(e) => { setAgentForm({ ...agentForm, ttsExpressiveness: e.target.value as GeminiTtsExpressiveness }); setVoicePreviewUrl(""); }}>{geminiTtsExpressivenessLevels.map((level) => <option key={level} value={level}>{geminiTtsExpressivenessLabels[level]}</option>)}</select></label>
                    <label className="voice-instructions">Instruções adicionais<textarea rows={3} maxLength={600} value={agentForm.ttsInstructions} disabled={agentForm.audioReplyMode === "never"} onChange={(e) => { setAgentForm({ ...agentForm, ttsInstructions: e.target.value }); setVoicePreviewUrl(""); }} placeholder="Ex.: sotaque baiano suave, sorrindo na saudação e com pausas curtas antes das perguntas." /><small>{agentForm.ttsInstructions.length}/600 · Use este campo para sotaque, pausas ou outras nuances.</small></label>
                  </div>
                  {voicePreviewUrl && <div className="voice-preview-player"><audio controls autoPlay src={voicePreviewUrl} /><small>Prévia gerada com a configuração atual.</small></div>}
                </div>
                <div className="agent-channel-card span-2">
                  <span className="agent-channel-icon"><MessageCircleMore size={21} /></span>
                  <span>
                    <strong>Canal WhatsApp deste agente</strong>
                    <small>{editingAgent ? editingAgent.instanceName : "Salve o agente para criar uma conexão exclusiva."}</small>
                  </span>
                  {editingAgent ? (
                    <button
                      type="button"
                      className={agentConnections[editingAgent.id] === "open" ? "channel-disconnect" : "secondary-button"}
                      onClick={() => agentConnections[editingAgent.id] === "open" ? disconnectWhatsapp(editingAgent) : connectWhatsapp(editingAgent)}
                      disabled={(connecting && qrAgentId === editingAgent.id) || disconnectingAgentId === editingAgent.id}
                    >
                      {disconnectingAgentId === editingAgent.id || agentConnections[editingAgent.id] === "loading" ? <LoaderCircle className="spin" size={16} /> : agentConnections[editingAgent.id] === "open" ? <LogOut size={16} /> : <MessageCircleMore size={16} />}
                      {disconnectingAgentId === editingAgent.id ? "Desconectando..." : agentConnections[editingAgent.id] === "open" ? "Desconectar" : "Conectar WhatsApp"}
                    </button>
                  ) : <i>Conexão individual</i>}
                </div>
                <label className="span-2">Prompt do sistema<textarea required rows={10} value={agentForm.systemPrompt} onChange={(e) => setAgentForm({ ...agentForm, systemPrompt: e.target.value })} /></label>
                <label className="toggle-row span-2"><span><strong>Atendimento automático</strong><small>Quando ativo, o agente responde novas mensagens dessa instância.</small></span><input type="checkbox" checked={agentForm.enabled} onChange={(e) => setAgentForm({ ...agentForm, enabled: e.target.checked })} /></label>
              </div>
              <footer><button type="button" className="ghost-button" onClick={() => { setEditingAgent(null); setAgentForm(defaultAgent); setVoicePreviewUrl(""); }}>Limpar</button><button className="primary-button" disabled={savingAgent}>{savingAgent ? <LoaderCircle className="spin" size={18} /> : <Check size={18} />} Salvar agente</button></footer>
            </form>
          </div>
        </section>
      ) : (
        <section className="settings-workspace">
          <header className="settings-title">
            <div>
              <p className="eyebrow">Configurações</p>
              <h1>Chaves de inteligência artificial</h1>
              <p>Cadastre as credenciais usadas pelos agentes. As chaves são criptografadas antes de serem gravadas e nunca são exibidas novamente.</p>
            </div>
            <div className="settings-status">
              <span className="security-note"><ShieldCheck size={17} /> Protegidas no servidor</span>
              <strong>{configuredProviders.length} {configuredProviders.length === 1 ? "chave registrada" : "chaves registradas"}</strong>
              <small>{configuredProviders.length ? configuredProviders.map((provider) => provider.name).join(" · ") : "Nenhum provedor configurado"}</small>
            </div>
          </header>
          {providerStatuses.length ? (
            <div className="provider-grid">
              {providerStatuses.map((provider) => (
                <form className="provider-card" key={provider.id} onSubmit={(event) => saveProviderCredential(event, provider.id)}>
                  <header>
                    <span className="provider-icon"><KeyRound size={20} /></span>
                    <span><strong>{provider.name}</strong><small>{providerDescriptions[provider.id]}</small></span>
                    <i className={provider.configured ? "configured" : ""}>{provider.configured ? "1 chave registrada" : "Nenhuma chave"}</i>
                  </header>
                  <label>
                    Chave de API
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={providerKeys[provider.id] || ""}
                      onChange={(event) => setProviderKeys((current) => ({ ...current, [provider.id]: event.target.value }))}
                      placeholder={provider.configured ? "Digite uma nova chave para substituir" : "Cole a chave do provedor"}
                    />
                  </label>
                  <footer>
                    <small>{provider.source === "environment" ? "Configurada pelo ambiente do Coolify" : provider.source === "database" ? "Salva neste CRM" : "Nenhuma chave cadastrada"}</small>
                    {provider.source === "database" && <button type="button" className="ghost-button danger-text" onClick={() => removeProviderCredential(provider.id)} disabled={savingProvider === provider.id}>Remover</button>}
                    <button className="primary-button" disabled={savingProvider === provider.id || !providerKeys[provider.id]?.trim()}>
                      {savingProvider === provider.id ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />} Salvar
                    </button>
                  </footer>
                </form>
              ))}
            </div>
          ) : (
            <div className="settings-loading"><LoaderCircle className="spin" size={25} /> Carregando provedores...</div>
          )}
        </section>
      )}

      {showNewChat && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Nova conversa">
          <form className="new-chat-modal" onSubmit={startConversation}>
            <button type="button" className="modal-close" onClick={() => setShowNewChat(false)}><X size={19} /></button>
            <div className="qr-icon"><MessageCircleMore size={25} /></div>
            <h2>Nova conversa</h2>
            <p>Informe o WhatsApp com DDD. Para números brasileiros, o código 55 é adicionado automaticamente.</p>
            <label>Número do WhatsApp<input required inputMode="tel" value={newPhone} onChange={(event) => setNewPhone(event.target.value)} placeholder="(71) 99999-9999" /></label>
            <label>Primeira mensagem<textarea required rows={4} value={newMessage} onChange={(event) => setNewMessage(event.target.value)} placeholder="Olá! Como podemos ajudar?" /></label>
            <button className="primary-button" disabled={sending}>{sending ? <LoaderCircle className="spin" size={17} /> : <SendHorizontal size={17} />} Iniciar atendimento</button>
          </form>
        </div>
      )}

      {showQr && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Conectar WhatsApp">
          <div className="qr-modal"><button className="modal-close" onClick={() => { setShowQr(false); setQrAgentId(""); }}><X size={19} /></button><div className="qr-icon"><MessageCircleMore size={25} /></div><h2>Conectar WhatsApp</h2><p>No celular, abra <strong>Aparelhos conectados</strong> e escaneie o código de <strong>{agents.find((agent) => agent.id === qrAgentId)?.name || "este agente"}</strong>.</p><div className="qr-frame">{connecting ? <LoaderCircle className="spin" size={32} /> : qrCode ? <Image src={qrCode} alt="QR Code para conectar o WhatsApp" width={208} height={208} unoptimized /> : <div><RefreshCw size={26} /><span>Aguardando QR Code</span></div>}</div><button className="secondary-button full" onClick={() => { const agent = agents.find((item) => item.id === qrAgentId); if (agent) refreshWhatsappQr(agent); }} disabled={connecting}><RefreshCw size={16} /> Atualizar código</button><small>Ao conectar, esta janela será fechada automaticamente.</small></div>
        </div>
      )}
      {toast && <div className="toast"><Check size={17} /> {toast}</div>}
    </main>
  );
}
