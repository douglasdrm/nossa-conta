# Nossa Conta

Finanças da casa em conjunto. Projeto independente para **GitHub + Vercel**, com **Next.js 16, React, TypeScript e Supabase (Postgres + Auth)**.

## O que já funciona no código

- Cadastro e login por e-mail e senha, confirmação de e-mail, recuperação de senha e logout.
- Um espaço financeiro privado por família, com contas individuais para cada participante.
- Convites vinculados ao e-mail, com validade de 7 dias e opção de revogar convites pendentes.
- Entradas e despesas por pessoa, categoria e mês, resumo de saldo e exportação CSV do mês.
- Despesas recorrentes mensais, com edição de cada ocorrência e valor padrão versionado a partir do mês seguinte.
- Encerramento de recorrência e exclusão de uma ocorrência sem fazê-la reaparecer.
- Layout adaptado para celular.

**Não depende de login do ChatGPT, Cloudflare Workers, D1 ou da hospedagem da prévia anterior.** Não exige uma chave `service_role` nem conexão direta ao Postgres no servidor da Vercel.

## 1. Executar localmente

Use **Node.js 22** e npm.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Abra http://localhost:3000. Sem as variáveis, o aplicativo mostra uma tela de configuração; isso permite verificar o build antes de conectar o Supabase.

## 2. Banco compartilhado com o Juntô

Nesta instalação, o Nossa Conta usa o projeto Supabase do Juntô. A migração cria somente tabelas e funções públicas com prefixo `nc_` e o schema interno `nossa_conta_private`. Não cria funções genéricas nem altera tabelas, políticas, dados ou triggers do Juntô.

O banco e a base de contas do Supabase Auth são compartilhados. Cada família tem autorização própria no Nossa Conta; ter conta no Juntô não dá acesso a outra família. Contas anônimas ou sem e-mail confirmado não podem usar as finanças. Cookies do Nossa Conta têm nome próprio, e o logout é apenas da sessão atual. Alterações de senha e configurações globais de Auth continuam compartilhadas.

1. Selecione o projeto Supabase do Juntô, ou um projeto novo caso prefira uma instalação separada.
2. Abra **SQL Editor** e execute, uma única vez, depois de verificar que não existem objetos `nc_*` nem o schema `nossa_conta_private`, o arquivo os arquivos de `supabase/migrations/` em ordem de nome (a instalação principal e o bloqueio explícito de contas anônimas).
3. Em **Project Settings > API**, copie a URL e a chave pública **publishable** para `.env.local`:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://SEU-PROJETO.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_SUBSTITUA_AQUI
```

As duas variáveis são públicas por definição. A segurança dos registros está nas políticas RLS e nas verificações de usuário/membro do banco. **Nunca substitua a chave pública por `service_role` ou uma chave secret.**

### Login e e-mails

Em **Authentication**:

- Preserve os provedores existentes. O aplicativo suporta **Google** (já configurado no Juntô) e **Email** com senha; mantenha a confirmação de e-mail ligada.
- Em **URL Configuration**, preserve o **Site URL do Juntô** e acrescente os callbacks do Nossa Conta aos endereços permitidos. Não substitua as URLs existentes.
- Adicione aos **Redirect URLs** `http://localhost:3000/auth/callback**` para desenvolvimento e `https://SEU-PROJETO.vercel.app/auth/callback**` para produção. Ao usar um domínio próprio, adicione também seu callback exato. Só adicione previews da Vercel que você realmente usar.
- Configure **SMTP próprio** para enviar confirmação e recuperação para os e-mails de vocês. O envio padrão do Supabase possui restrições de destinatários e limites, portanto não deve ser presumido como entrega de produção.
- Não substitua os templates de e-mail do Juntô. Confira se eles respeitam o destino solicitado em `{{ .ConfirmationURL }}` / `{{ .RedirectTo }}`. A aplicação troca o código PKCE na rota `/auth/callback`. Abra o link de confirmação/recuperação no mesmo navegador em que iniciou o fluxo.

Se usar CLI para as próximas alterações, a migração inicial já está no formato do Supabase. Vincule explicitamente o projeto correto antes de executar qualquer comando remoto. Aplique alterações de esquema como novas migrações; não reexecute a migração inicial em um banco existente.

## 3. Enviar ao GitHub

Crie um repositório, preferencialmente privado, e envie **o conteúdo desta pasta** para a raiz dele. Não inclua `node_modules`, `.next` nem `.env.local`.

Pelo terminal, depois de criar o repositório vazio:

```bash
git init -b main
git add .
git commit -m "Estrutura inicial do Nossa Conta"
git remote add origin https://github.com/SEU-USUARIO/nossa-conta.git
git push -u origin main
```

Já existe um workflow em `.github/workflows/ci.yml` que executa TypeScript, testes, testes do banco e build em pushes/PRs.

## 4. Importar na Vercel

1. Conecte a conta do GitHub na Vercel e importe o repositório.
2. Use o framework **Next.js**, Node.js **22.x**, raiz do projeto `./`.
3. Cadastre as mesmas duas variáveis de ambiente no projeto Vercel, pelo painel. Se usar previews, configure-as também nesse ambiente; prefira um banco separado para testes.
4. Publique. `vercel.json` define `npm ci` e `npm run build`; não defina diretório de saída manualmente.
5. Atualize as URLs do Supabase com o domínio real e faça um novo deploy caso tenha alterado as variáveis.

Depois da vinculação, os próximos pushes na branch de produção serão publicados pela integração GitHub–Vercel. Nenhuma senha, token ou chave precisa entrar no repositório.

## 5. Usar em casal

1. Crie a primeira conta e confirme o e-mail. O primeiro acesso cria o espaço da casa.
2. Em **Compartilhar**, informe o e-mail da outra pessoa e gere o convite.
3. Copie o link e envie manualmente. O aplicativo não envia mensagens nem convites por e-mail automaticamente.
4. A pessoa abre o link, entra ou cria conta **com aquele e-mail** e aceita.
5. Ambos podem consultar, adicionar, editar e excluir lançamentos. Somente o criador do espaço gera e revoga convites pendentes.

Cada conta participa de um espaço por vez. Um espaço pessoal recém-criado e vazio pode ser substituído ao aceitar um convite; um espaço com registros, inclusive excluídos, é preservado e a troca é bloqueada. Revogar um **convite pendente** não remove um membro que já o aceitou. Remover membros aceitos ainda não tem interface nesta versão.

## Regras das recorrências

- Os valores são salvos em **centavos inteiros**. R$ 187,00 vira `18700` no banco.
- Ao abrir um mês, o aplicativo materializa as ocorrências de regras ativas naquele mês, sem duplicar registros. Não é necessário cron.
- A geração usa IDs estáveis e operações no banco; duas pessoas abrindo o mesmo mês não criam cópias.
- Vencimento no dia 31 é ajustado ao último dia de meses menores.
- Editar uma ocorrência altera somente aquele mês. A data deve permanecer dentro do mês original.
- Marcar **Usar este valor como padrão nos próximos meses** cria um novo valor padrão a partir do mês seguinte. Meses já materializados permanecem iguais; meses antigos nunca abertos usam a versão histórica correta.
- Encerrar recorrência impede a criação de novas ocorrências após o mês selecionado. Registros futuros que já existam são preservados e podem ser excluídos separadamente.
- Excluir uma ocorrência deixa uma marca de exclusão no banco para impedir que ela seja gerada novamente.
- Os totais distinguem pagamentos confirmados de despesas pendentes. O saldo calculado não é um saldo bancário conciliado.

## Verificação

```bash
npm run typecheck
npm test
npm run test:database
npm run build
```

Os testes de banco executam a migração real em PostgreSQL embarcado (PGlite), simulando apenas as tabelas/identidade do Supabase Auth. Verificam isolamento entre famílias, convites, centavos, edição mensal, mudança de padrão, exclusão e encerramento de recorrências. Não substituem a verificação do Supabase hospedado e da entrega real dos e-mails.

Após conectar as contas, valide em dois navegadores: cadastro/confirmação, logout/login, recuperação, convite, criação de gastos, atualização do outro participante ao voltar à aba, recorrência do mês seguinte e isolamento com uma terceira conta. Rode também o Security Advisor do Supabase no projeto hospedado. Essa etapa ainda depende da criação/conexão do projeto real.

## Estrutura

```text
app/                     Páginas e API do Next.js
components/              Configuração e compartilhamento
lib/supabase/            Clientes SSR e navegador
lib/validation.ts        Validação de lançamentos e redirecionamentos
proxy.ts                 Renovação de sessão por cookies
supabase/migrations/     Esquema, RLS e operações transacionais
tests/                   Validação e testes de integração do banco
.github/workflows/       Verificações automáticas
```

Não há migração automática dos dados ou usuários da prévia anterior. Nesta instalação, o projeto usa tabelas próprias no banco do Juntô. O arquivo de código não contém credenciais ou registros financeiros reais.

Referências: [Next.js na Vercel](https://vercel.com/docs/frameworks/full-stack/nextjs), [Supabase SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client?framework=nextjs), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [SMTP](https://supabase.com/docs/guides/auth/auth-smtp).

## Separar o banco futuramente

A separação para outro projeto exige: exportar/restaurar apenas tabelas `nc_*` (incluindo ocorrências excluídas e versões de recorrências), instalar as funções `nc_*` e o schema `nossa_conta_private`, e migrar ou remapear os IDs dos usuários referenciados em `auth.users`. Depois, configurar os provedores/callbacks de Auth e alterar as duas variáveis de ambiente do Nossa Conta na Vercel, com novo deploy. A migração das contas pode exigir novo login ou redefinição de senha. Não copie dados de viagens do Juntô.

Ao gerenciar migrações neste projeto compartilhado, aplique somente a migração revisada do Nossa Conta. Não rode reset, migração automática de todo o projeto nem altere o histórico de migrações do Juntô. A migração inicial genérica distribuída na primeira versão deste repositório foi substituída antes de sua primeira instalação: não use o ZIP antigo para instalar no banco compartilhado.

## Pagamentos, pagadores e avisos de vencimento

Informar renda é opcional. É possível usar somente despesas; sem receitas no mês, o saldo fica sem cálculo em vez de assumir renda zero. As despesas podem ser salvas como **Ainda vou pagar** ou **Já paguei**. A lista e o resumo separam **Pago** de **A pagar**. Responsável e pagador são campos distintos; quem adicionou a conta fica registrado em `created_by`, e `payer` identifica quem efetivamente pagou. Contas antigas mantêm o histórico e mostram pagador não informado até serem editadas.

Ao confirmar um pagamento, o formulário permite ajustar o valor e informar quem pagou. A confirmação é manual e usa o horário do servidor; chegar ao vencimento não confirma automaticamente. As próximas ocorrências mensais são criadas pendentes, sem copiar o pagador do mês anterior. Editar ou confirmar uma ocorrência não confirma outras.

O app destaca contas pendentes vencidas ou vencendo hoje, inclusive cadastradas em meses anteriores, usando a data de São Paulo. É possível ativar notificações genéricas neste navegador, mediante permissão. **Os avisos funcionam ao abrir/voltar ao app ou enquanto ele estiver aberto; esta versão não envia push com o app fechado, e-mail ou WhatsApp.** Recorrências são materializadas ao consultar o mês; não há agendador externo. A abertura do app também consulta o mês atual para preparar os avisos.

O campo de valores preenche centavos automaticamente: `12345` vira `123,45`, e o banco recebe `12345` centavos inteiros. A exportação CSV inclui a situação e o pagador.

### Instalação como app

O manifesto em `/manifest.webmanifest` permite instalar o Nossa Conta com ícone próprio e abertura em janela independente. O botão **Instalar app** abre a confirmação nativa quando o navegador a disponibiliza; caso contrário, mostra instruções para o dispositivo. No iPhone/iPad, use Safari → Compartilhar → Adicionar à Tela de Início. No app já aberto em modo independente, o botão fica oculto.

A instalação mantém o login e os dados online existentes. Consultas e alterações precisam de internet; nenhum dado financeiro é armazenado em cache por um service worker. Os ícones PNG derivam do símbolo de carteira em `public/favicon.svg`, com uma versão maskable para Android.

### Gastos parcelados e previsão do mês

Em **Adicionar gasto → Tipo de gasto → Gasto parcelado**, informe o total da compra ou o valor de cada parcela, a quantidade (2 a 120) e o vencimento da primeira. As parcelas mensais são gravadas de uma vez e identificadas por número; centavos indivisíveis ficam nas primeiras parcelas para preservar o total. O vencimento usa o dia original, limitado ao último dia de cada mês. Apenas a primeira parcela pode ser confirmada na criação; as demais começam pendentes. Editar ou excluir uma parcela afeta somente ela.

O **Saldo previsto do mês** considera entradas registradas menos todos os gastos do mês (pagos e pendentes, incluindo as parcelas que vencem naquele mês). Uma previsão negativa exibe quanto faltará sem novas entradas. A renda continua opcional; sem ela, a previsão explica que considera zero em entradas. Não há transporte automático de saldo entre meses.

Migração necessária: `supabase/migrations/20261106140204_installment_expenses.sql`. A função pública `nc_add_installments` é invoker; a implementação privada valida a conta confirmada e o espaço compartilhado, gera a compra em transação e usa o identificador da operação para impedir duplicatas em tentativas repetidas. Não modifica objetos do Juntô.

### Categorias personalizadas

Em um lançamento, clique em **Adicionar categoria**, informe o nome e confirme em **Criar categoria**. A nova opção é selecionada e fica salva para todos os membros do espaço, separada entre entradas e gastos. Nomes iguais sem distinguir maiúsculas/minúsculas são reutilizados. O gráfico também inclui categorias personalizadas. A tabela `nc_categories` usa RLS; a criação ocorre pelo RPC `nc_add_category`, com validação de conta confirmada e vínculo ao espaço.

### Meu perfil

A página `/profile`, acessível no menu e no cabeçalho, permite editar nome e nome de usuário, enviar/remover foto, solicitar troca de e-mail e alterar a senha. Nome de usuário é opcional, único e normalizado para letras minúsculas (3–30 letras ASCII, números ou `_`); não substitui o e-mail no login. Nome/foto/usuário são próprios do Nossa Conta e não alteram os dados históricos dos lançamentos nem a tabela de perfis do Juntô.

E-mail e senha usam `auth.updateUser` na sessão do próprio usuário; por compartilharem o Supabase Auth, essas alterações também afetam o acesso ao Juntô. A confirmação de e-mail usa o callback PKCE existente. A tela suporta a senha atual e o código de reautenticação exigidos pelas configurações do projeto. Não altera essas configurações, e nenhuma credencial é gravada nas tabelas da aplicação.

Migração `20261106145403_user_profiles.sql`: tabela `nc_user_profiles` com leitura própria e escrita por RPCs invoker/implementações privadas, e bucket privado `nc-avatars` com acesso apenas à pasta do próprio usuário confirmado. Fotos de até 3 MB são validadas e convertidas para WebP de 512×512 no servidor, sem EXIF. O perfil usa URLs temporárias assinadas. `sharp` é dependência explícita e fixada no lockfile.

### Entradas recorrentes

Em **Adicionar entrada**, escolha **Tipo de entrada → Recorrente todo mês**. A confirmação do primeiro recebimento é opcional; os próximos meses são gerados como **a receber**, sem aumentar o saldo recebido até a confirmação. O dia informado é mantido, limitado ao último dia nos meses mais curtos.

As entradas usam as mesmas opções das despesas recorrentes: ajustar apenas o lançamento, definir o valor padrão para os próximos meses e encerrar após o mês selecionado. Meses já registrados são preservados; excluir um lançamento não o recria na próxima atualização. Renomear uma categoria de entrada também atualiza suas regras futuras, sem alterar categorias de despesa.

**Publicação:** aplicar primeiro `supabase/migrations/20261109201131_recurring_income.sql` no projeto Supabase e depois publicar a aplicação. A migração adiciona o tipo às regras existentes (mantendo-as como despesas) e atualiza as operações privadas de criação, geração mensal e renomeação de categorias. Não altera as políticas de acesso nem o status dos lançamentos existentes.

## Planos, aquisição e administração (12/11/2026)

- Catálogo único em `lib/plans.ts`: Premium mensal R$ 14,90; trimestral R$ 41,70 (R$ 13,90/mês); anual R$ 154,80 (R$ 12,90/mês). Uma assinatura por espaço compartilhado.
- `/planos` compara os períodos e informa que a contratação está em preparação. `/assinatura` exige conta confirmada e registra interesse, sem checkout ou compromisso de pagamento. Nenhum limite foi aplicado aos recursos financeiros atuais.
- `/admin` usa autorização no servidor e no banco por `nc_system_admins`. Não existe autoatribuição de administrador, nem autorização por metadados editáveis do usuário. O cadastro inicial de administradores exige aprovação explícita do responsável pelo produto. A instalação não concede acesso a nenhum usuário automaticamente.
- Administração: visão geral, leads com busca e paginação de 25, etapas e anotações, usuários confirmados, espaços/participantes, cortesias com validade e histórico das últimas 20 ações. O painel não retorna descrições, valores, renda ou saldos dos clientes; utiliza apenas a existência de lançamentos como sinal agregado de uso.
- As cortesias são registros administrativos. Não simulam pagamento e não geram receita. Checkout, renovação, cancelamento de assinaturas pagas, cupons, alteração do catálogo pelo painel e métricas de receita dependem da integração de pagamentos, ainda não habilitada.
- O primeiro acesso guarda origem, mídia, campanha e caminho público no navegador (sem tokens ou consultas privadas). Ao abrir o app autenticado, o contato confirmado é vinculado a um lead; o primeiro contato preserva a atribuição. A escolha de período registra interesse. Isso não envia e-mails ou WhatsApp. O armazenamento bloqueado não impede o uso do app; a atribuição pode ficar como acesso direto.
- Contatos existentes não são importados automaticamente: essa importação depende de aprovação explícita. Usuários existentes que voltam a usar o aplicativo passam pelo mesmo registro individual de aquisição dos novos acessos.
- Não há Google Analytics ou Google Ads instalados. Atribuição pode ser incompleta entre dispositivos, navegadores e fluxos sem referenciador. Etapa comercial de assinante é manual e não equivale a pagamento validado.
- SEO público: `/`, `/planos`, `/financas-para-casal`, `/controle-financeiro-familiar` e quatro guias em `/guias/`. `/conheca` mantém a apresentação e aponta o canonical para `/`. Páginas públicas têm títulos, descrições, canonical e prévias sociais. Sitemap lista somente conteúdo público; áreas privadas herdam `noindex` e recebem `X-Robots-Tag`. O dashboard autenticado na raiz recebe `X-Robots-Tag: noindex, nofollow`.
- Search Console: verificar a propriedade do domínio e enviar `https://nossaconta.unodev.com.br/sitemap.xml`. A variável opcional **server-side** `GOOGLE_SITE_VERIFICATION` permite verificação HTML de propriedade por prefixo de URL. Não há garantia de indexação ou classificação.
- Validação: `npm test`, `npm run test:database`, `npm run typecheck`, `npm run build`. Os testes de banco incluem negação de autoatribuição de admin, isolamento de leads, registro individual de interesse, preservação da primeira origem, associação de lead manual por e-mail confirmado, cortesias e revogação do acesso administrativo.

### Entrada administrativa separada

A administração é acessada diretamente em `/admin` (com entrada própria em `/admin/login`) e não aparece no menu financeiro do cliente. A autenticação utiliza a mesma conta, mas a autorização administrativa exige cadastro explícito em `nc_system_admins`; Premium não concede esse acesso. Sair da conta administrativa também encerra a sessão do aplicativo neste navegador.
