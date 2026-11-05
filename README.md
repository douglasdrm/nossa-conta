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

## 2. Criar um projeto Supabase separado

Use um projeto dedicado para estas finanças. Não aplique esta migração ao banco de outro sistema, como o Juntô.

1. Crie o projeto no Supabase.
2. Abra **SQL Editor** e execute, uma única vez em um banco novo, o arquivo `supabase/migrations/20261105120528_initial_finances.sql`.
3. Em **Project Settings > API**, copie a URL e a chave pública **publishable** para `.env.local`:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://SEU-PROJETO.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_SUBSTITUA_AQUI
```

As duas variáveis são públicas por definição. A segurança dos registros está nas políticas RLS e nas verificações de usuário/membro do banco. **Nunca substitua a chave pública por `service_role` ou uma chave secret.**

### Login e e-mails

Em **Authentication**:

- Habilite o provedor **Email** com senha; mantenha a confirmação de e-mail ligada.
- Em **URL Configuration**, configure o **Site URL** com o endereço final na Vercel.
- Adicione aos **Redirect URLs** `http://localhost:3000/auth/callback**` para desenvolvimento e `https://SEU-PROJETO.vercel.app/auth/callback**` para produção. Ao usar um domínio próprio, adicione também seu callback exato. Só adicione previews da Vercel que você realmente usar.
- Configure **SMTP próprio** para enviar confirmação e recuperação para os e-mails de vocês. O envio padrão do Supabase possui restrições de destinatários e limites, portanto não deve ser presumido como entrega de produção.
- Use os templates padrão com o link `{{ .ConfirmationURL }}`. A aplicação troca o código PKCE na rota `/auth/callback`. Abra o link de confirmação/recuperação no mesmo navegador em que iniciou o fluxo.

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
- Os totais somam todos os lançamentos registrados. Ainda não há distinção entre conta prevista, pendente e paga, nem saldo bancário conciliado.

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

Não há migração automática dos dados ou usuários da prévia anterior. O projeto parte de um banco dedicado novo. O arquivo de código não contém credenciais ou registros financeiros reais.

Referências: [Next.js na Vercel](https://vercel.com/docs/frameworks/full-stack/nextjs), [Supabase SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client?framework=nextjs), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [SMTP](https://supabase.com/docs/guides/auth/auth-smtp).
