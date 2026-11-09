# Decisões e desvios em relação à especificação

Pedido do usuário para esta entrega: **site, sem notificações, 100% gratuito** (GitHub Pages + Supabase grátis).
Isso exclui o monorepo Next.js/Expo, Resend, Expo Push e o app nativo previstos na §10. Tudo abaixo é consequência disso ou uma escolha conservadora (§15).

## Stack
| Spec | Aqui | Motivo |
|---|---|---|
| Next.js + Vercel (§10.1) | HTML/JS puro (módulos ES) no **GitHub Pages**, roteador por hash | Grátis, sem build, sem Node no computador do usuário. Next.js exigiria servidor (Vercel) ou build. |
| Expo/React Native (Android/iOS) | **PWA** instalável | Sem taxa de loja (US$ 99/ano na Apple). |
| Supabase (banco + Auth + RLS) | igual | Era a recomendação da spec e tem plano grátis. |
| API REST `/v1` própria (§9) | PostgREST do Supabase + **funções SQL (RPC)** | Sem servidor para manter. As regras de negócio compostas viraram funções (`respond_assignment`, `replace_assignment`, `publish_event`…). |
| Tabela `users` (§8) | `auth.users` do Supabase | Evita duplicar. |

## Fora de escopo por pedido (sem notificações)
- Cadência D-7/D-3/D-1/D-0, e-mail, push, WhatsApp, `notification_log`, `devices`, horário de silêncio, preferências de canal (RF-801 parte de notificação, RF-807..810).
- **Substituto na prática:** ao publicar (e no botão “Mensagem p/ WhatsApp”) o app monta uma mensagem pronta com `wa.me`; o líder só envia.
- **RF-802 “um toque a partir da notificação”:** sem notificação, o equivalente é o botão *Confirmar* na tela inicial, a um toque.

## Mudanças de comportamento conscientes
| Req. | Spec | Aqui | Por quê |
|---|---|---|---|
| RF-805 | Pendente vira `expirada` em D-3 automaticamente | Calculado **ao abrir o app** (`refresh_states`) | Sem cron no plano grátis do GitHub Pages; é idempotente, então o resultado é o mesmo na tela. (pg_cron do Supabase poderia fazer isso, mas fica para depois.) |
| RF-1006 | Página pública funciona sem JavaScript | **Exige JS** | Site estático com roteador no navegador. Aceitável: indexação e SEO não são prioridade. |
| RF-706 | Assinatura `.ics` (webcal) | **Exportação de arquivo** `.ics` (calendário e Minhas escalas) | Assinatura precisa de um endpoint servidor com token. |
| RF-204 | Foto e papel no cadastro | **Sem foto.** Papel (admin/integrante) é definido no convite ou na grade | Foto exigiria Supabase Storage + política de privacidade da imagem. Papel só existe quando há conta. |
| RF-703 | Hover mostra o elenco | Hover/foco mostra o elenco; clique abre o detalhe | Igual à spec; foco por teclado incluído. |
| RF-210 | CSV com pré-visualização | Igual; funções separadas por `\|` | `,` e `;` já são delimitadores do CSV. |
| RF-206 | Convite com link **e QR code** | Só **link** (copiar/WhatsApp) | QR exigiria biblioteca extra; o link resolve. |
| RN-004 | Unicidade insensível a acento | Insensível a **maiúsculas/espaços**, não a acento | Acento exigiria a extensão `unaccent`. |
| RF-107 | Limitar 5 tentativas/15 min | Limite padrão do **Supabase Auth** | Não há servidor próprio. Ajuste em *Authentication › Rate Limits*. |
| RF-101 | E-mail verificado antes do acesso | Depende da opção “Confirm email” do Supabase | Veja o README (limite de e-mails do plano grátis). |
| RF-104 | Login Google/Apple | Não incluído | Opcional na spec. |
| RNF-06 | Offline com fila de respostas | Só a **casca** do app abre offline | Cache de dados e fila de sincronização ficam para a próxima fase. |
| RNF-03 | Exportar/excluir dados do titular em 15 dias | **Manual** (painel do Supabase) | Sem tela própria ainda. |
| RNF-10 | Backup diário 30 dias | **Não existe no plano grátis** | Documentado no README. |

## Decisões de modelagem (ambiguidades resolvidas pelo lado conservador)
- **Contatos separados** (`member_contacts`): telefone, e-mail e observações só são lidos por líderes/admins e pelo próprio integrante. A spec manda esconder do público (RF-1003) mas não dizia nada entre colegas; por LGPD (RNF-03) escolhi esconder também.
- **Integridade entre igrejas no próprio banco:** chaves estrangeiras compostas `(id, church_id)`; mesmo um cliente malicioso não consegue ligar uma escalação da Igreja B a um integrante da Igreja A.
- **Papel `leader` derivado (RN-203):** vale por equipe (`teams.leader_id`), não pela tabela de acessos. O líder gerencia as escalas, escalações e setlists **das equipes que lidera**; cadastros gerais continuam só com o admin.
- **Escala encerrada:** vira `closed` 4 h depois do início (também calculado ao abrir o app). Escalações não respondidas viram `closed` com presença em branco para o líder preencher.
- **Escalação “removida” em escala publicada** vira `cancelled` (histórico mantido); em rascunho é apagada.
- **Conflito de horário (RF-903):** considera escalas com início a ±3 h. Um líder (não admin) só enxerga conflitos nas equipes dele, porque o RLS limita o que ele lê.
- **Exclusão de escala:** só rascunho/cancelada (soft delete); publicada precisa ser cancelada (trigger no banco).
- **Convite** guarda apenas o hash (SHA-256); o código aparece uma única vez para quem gerou.
- **Fuso horário:** `timestamptz` em UTC; exibição no fuso da igreja (`America/Cuiaba` por padrão), com conversão testada ida e volta.

## Para a próxima fase (se valer a pena)
1. `pg_cron` + Edge Function para os lembretes (e-mail via SMTP gratuito) — reaproveita `refresh_states`.
2. Cache offline dos dados + fila de respostas (RNF-06).
3. QR code de convite, foto (Storage), exportar/excluir dados do titular.
4. Se um dia quiserem as lojas: empacotar este mesmo site com Capacitor.
