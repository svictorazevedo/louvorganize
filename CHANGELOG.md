# Histórico de versões

O LouvOrganize segue o [versionamento semântico](https://semver.org/lang/pt-BR/). A versão em uso aparece no rodapé do menu, no menu "Mais" (celular) e na tela de entrada. Ela vem de `js/version.js`.

## 1.2.0 — 11/11/2026
- **Vestimenta**: nova tela para cadastrar padrões de cores (ex.: “Preto e Vinho”) e escalar um padrão por semana (domingo a sábado), com botão **Preencher em rodízio**. Já vem com 10 padrões cadastrados, que podem ser editados.
- Três bonequinhos mostram uma ideia de como combinar as peças (camisa/blusa/camiseta, calça, sapato/tênis e casaco) com as cores da semana: no Início, na página pública e no detalhe de cada escala. Se as cores do padrão forem alteradas, todas as semanas escaladas com ele passam a mostrar as cores novas.
- Administradores cadastram e editam os padrões; líderes e administradores escalam as semanas; todos veem.
- Correção: no celular, o seletor **Mês/Lista** do calendário aparecia cortado (o “Mês” sumia). Agora a visão de mês funciona no celular, em formato compacto.
- Banco: rodar `supabase/migracao-1.2.0-vestimentas.sql` em projetos já existentes.

## 1.1.1 — 10/11/2026
- Correção: depois de uma atualização, as telas passam a ser baixadas de novo (antes o navegador podia mostrar a versão antiga por até 10 minutos, mesmo com Ctrl+F5).

## 1.1.0 — 10/11/2026
- Ensaio: botão **Clonar equipe e setlist**, que copia os escalados e o repertório de um culto ou evento escolhido pela data.
- Versão do sistema exibida na interface.

## 1.0.0 — 09/11/2026
- Primeira versão: escalas, equipes, funções, integrantes, repertório e setlist, calendário, página pública, relatórios, PWA instalável e mensagem pronta para o WhatsApp.
