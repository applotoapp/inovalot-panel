# Inovalot Panel

Central de atendimento jurídico pelo WhatsApp, com uma instalação exclusiva do Evolution Go e configuração de agentes de IA.

## Entrega atual

- caixa de entrada em tempo quase real, busca e filtros;
- histórico por conversa, nova conversa e envio de texto, imagem, vídeo, documento e áudio gravado;
- conexão da conta por QR Code;
- respostas citadas, emojis, reações, leitura, exclusão de mensagem e arquivamento na interface;
- cadastro de agentes com prompt, provedor, modelo, temperatura e uma conexão WhatsApp exclusiva;
- caixa de entrada consolidada ou filtrada por agente/canal;
- respostas automáticas para agentes OpenAI, OpenRouter, Anthropic ou Google ativos;
- transcrição automática de áudios recebidos com Groq/Whisper antes da resposta do agente;
- cadastro protegido de chaves para OpenAI, xAI/Grok, OpenRouter, Anthropic e Google Gemini;
- autenticação HTTP Basic na aplicação;
- PostgreSQL isolado para o CRM e para o Evolution Go;
- Docker Compose pronto para Coolify, sem compartilhar instâncias ou volumes com o DeliveryOS.

## Executar localmente

1. Copie `.env.example` para `.env` e substitua todos os segredos.
2. Execute `docker compose up --build`.
3. Abra `http://localhost:3000`.
4. Ative a licença do Evolution Go em `http://localhost:8080/manager` quando solicitado.
5. No CRM, crie ou abra um agente, clique em **Conectar WhatsApp** e leia o QR Code daquele agente.

Cada agente recebe uma instância e um token próprios da Evolution Go. O token é criptografado no banco e nunca é enviado ao navegador. No Chat, use o seletor **Caixa de entrada** para alternar entre todos os agentes ou apenas uma conexão.

Para desenvolver apenas a interface, use `npm install` e `npm run dev`. Sem PostgreSQL e Evolution Go, a tela abre normalmente e apresenta o estado de integração pendente.

## Variáveis obrigatórias em produção

`POSTGRES_PASSWORD`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE_TOKEN`, `WEBHOOK_SECRET`, `ADMIN_USERNAME` e `ADMIN_PASSWORD` devem ser segredos longos e distintos. As chaves de IA são opcionais até que um agente automático seja ativado. A chave Groq é usada exclusivamente para transcrever os áudios recebidos.

## Endpoints de operação

- `GET /api/health` — saúde do serviço;
- `GET|POST /api/whatsapp` — proxy seguro para o Evolution Go;
- `GET|POST|DELETE /api/agents` — configuração dos agentes;
- `GET|POST|DELETE /api/settings/providers` — configuração protegida das chaves de IA;
- `POST /api/webhooks/evolution` — ingestão de eventos do WhatsApp.
