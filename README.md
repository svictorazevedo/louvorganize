# LouvOrganize

Escalas do ministério de louvor: integrantes, funções, equipes, escalas, setlist e **confirmação/recusa individual**.
Funciona no navegador e pode ser **instalado no celular** (Android e iOS) como app, sem loja.

**Custo: R$ 0.** Site estático no GitHub Pages + banco/login no Supabase (plano gratuito). **Não envia notificações** nesta versão
(ao publicar uma escala o app gera uma mensagem pronta para colar no WhatsApp).

```
Navegador / app instalado ──► GitHub Pages (HTML + JS, estático)
            │
            └──────────────► Supabase (PostgreSQL + login + regras de segurança RLS)
```

Sem build, sem Node para rodar: são arquivos HTML/CSS/JS puros.

## 1. Criar o banco (Supabase) — uns 10 minutos

1. Crie uma conta em <https://supabase.com> e um **New project** (região mais próxima, ex.: São Paulo). Guarde a senha do banco.
2. Abra **SQL Editor › New query**, cole **todo** o conteúdo de [`supabase/schema.sql`](supabase/schema.sql) e clique em **Run**.
   Deve terminar com “Success”. (Se rodar duas vezes dá erro de “já existe”: é normal, o esquema só vale para banco vazio.)
3. Em **Project Settings › API**, copie a **Project URL** e a chave **anon public**.
4. Cole os dois valores em [`js/config.js`](js/config.js). A chave *anon* é pública por natureza; quem protege os dados é o RLS do banco.
   **Nunca** use a chave `service_role` aqui.
5. **Authentication › URL Configuration**: em *Site URL* coloque o endereço do seu site (passo 2) e adicione o mesmo endereço em *Redirect URLs*.
   Sem isso, os links de confirmação de e-mail e de recuperação de senha não voltam para o site.
6. **Authentication › Providers › Email**: decida sobre “Confirm email” (veja *Limites do plano grátis*).

## 2. Publicar o site (GitHub Pages)

1. Suba esta pasta para um repositório no GitHub (público, para o Pages ser grátis).
2. **Settings › Pages › Build and deployment**: *Deploy from a branch* → `main` → `/ (root)` → Save.
3. Em ~1 minuto o site fica em `https://SEU-USUARIO.github.io/NOME-DO-REPO/`.
   Cada `git push` atualiza o site.

## 3. Primeiro acesso

1. Abra o site › **Cadastre-se** › crie sua conta › **Criar uma igreja** (você vira o proprietário).
2. **Integrantes**: cadastre o pessoal (ou importe um CSV). **Equipes**, depois **Escalas**.
3. Para o integrante usar o app: em **Integrantes › Convidar** gere o link e mande pelo WhatsApp. Ele cria a conta e fica ligado ao cadastro dele.
4. **Publicar** uma escala libera para os escalados confirmarem ou recusarem em **Minhas escalas**.

### Instalar no celular
- **Android (Chrome):** menu ⋮ › *Instalar app*.
- **iPhone (Safari):** botão Compartilhar › *Adicionar à Tela de Início*. (Precisa ser pelo **Safari**.)

## Limites do plano grátis (leia)

| Assunto | O que acontece | O que fazer |
|---|---|---|
| **Pausa por inatividade** | O Supabase gratuito **pausa o projeto após ~1 semana sem uso**. | Abra o painel e clique em *Restore*, ou use o app toda semana (o próprio uso mantém ativo). |
| **E-mails de login** | O envio padrão do Supabase é limitado a **poucos e-mails por hora**. Cadastro com confirmação e “esqueci a senha” dependem dele. | Para poucas pessoas: desative *Confirm email* (Authentication › Providers › Email). Para mais gente: configure um SMTP próprio (ex.: conta gratuita do Resend/Brevo). |
| **Backup** | O plano grátis **não tem backup automático**. | Em *Database › Backups* só há backup nos planos pagos. Exporte periodicamente (`pg_dump`) ou os CSVs do app. |
| **Tamanho** | 500 MB de banco, 50 mil usuários ativos/mês. | Sobra para centenas de igrejas pequenas. |

## O que NÃO está nesta versão
Notificações (push, e-mail, WhatsApp), assinatura `.ics` ao vivo (há exportação de arquivo), upload de foto, planos/cobrança, aplicativo nas lojas,
cache offline dos dados (só a “casca” do app abre sem internet). Veja [`DECISIONS.md`](DECISIONS.md) para o que mudou em relação à especificação e por quê.

## Testes

```bash
# 1) Regras do banco + isolamento entre igrejas (precisa de Docker)
docker run -d --name lo-pg -e POSTGRES_PASSWORD=x postgres:16-alpine
sh tests/run-tests.sh                      # → "TODOS OS TESTES PASSARAM"

# 2) Funções puras do front-end (Node 20+)
npm test

# 3) Fumaça: monta todas as telas com dados falsos (Node 20+)
npm i --no-save jsdom@24 && npm run smoke
```

O teste do banco é o que prova o isolamento (RNF-01): autenticado como a Igreja B, tenta ler 15 tabelas da Igreja A e precisa receber zero linhas.
**Rode-o a cada mudança no `schema.sql`.**

## Estrutura

```
index.html · sw.js · manifest.webmanifest   casca do app (PWA)
css/app.css                                 estilos (claro/escuro, 360 px, impressão)
js/main.js                                  roteador por hash e moldura
js/lib/      api.js (Supabase) · ui.js (html seguro, diálogos) · time.js (fuso) · shared.js · csv.js · ics.js
js/pages/    uma tela por arquivo
supabase/schema.sql                         tabelas, RLS, triggers e funções (a fonte de verdade das regras)
tests/                                      SQL, unitários e de fumaça
louvorganize-spec.md                        especificação completa do produto (fica só no seu computador, não vai ao GitHub)
```

## Segurança em uma frase
O navegador só enxerga o que o banco deixa (RLS). Toda regra importante (equipe de 1–14, justificativa ≥ 10 caracteres, escala publicada não volta a rascunho,
último proprietário protegido, contatos visíveis só a líderes) está no PostgreSQL, não na tela. Todo texto digitado pelo usuário é escapado antes de ir para a página.
