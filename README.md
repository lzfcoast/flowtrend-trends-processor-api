# FlowTrend — Trends Processor API

Pacote portátil contendo exclusivamente a API Headless do FlowTrend, o worker de coleta do Google Trends Brasil, o resolvedor editorial de imagens, a persistência local em JSON e o processador Python para higienização e geração de conteúdo editorial.

O pacote não inclui frontend, tema Blogger, credenciais, tokens, banco de dados pessoal ou arquivos de sessão.

## Requisitos

- Node.js 20 ou superior;
- pnpm 10 ou npm equivalente;
- Python 3.10 ou superior;
- acesso de saída HTTPS para Google Trends RSS e Wikimedia Commons.

## Instalação local

Linux/macOS:

```bash
cp .env.example .env
corepack enable
pnpm install --frozen-lockfile
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
pnpm dev
```

Windows PowerShell:

```powershell
Copy-Item .env.example .env
corepack enable
pnpm install --frozen-lockfile
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
pnpm dev
```

Para produção:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

O serviço escuta em `0.0.0.0:$PORT`, com `PORT=3000` como padrão.

## Persistência

O banco padrão fica em `server/database.json`. O arquivo é criado automaticamente quando não existe. As escritas são atômicas, há deduplicação por termo/título/URL e a retenção remove artigos antigos conforme `ARTICLE_RETENTION_DAYS` e `ARTICLE_RETENTION_MAX`.

Para usar outro caminho:

```env
LOCAL_DATABASE_PATH=/var/lib/flowtrend/database.json
```

Em Windows, use um caminho absoluto como `C:\\data\\flowtrend\\database.json`.

## Worker de tendências

Ao iniciar o servidor, o worker consulta `https://trends.google.com.br/trending/rss?geo=BR` imediatamente e depois executa a cada `TRENDS_INTERVAL_MINUTES` minutos. O padrão é 5 minutos.

A resolução segue esta ordem:

1. imagem oficial encontrada no RSS do Google Trends;
2. busca semântica no Wikimedia Commons, combinando termo, título e categoria;
3. geração de imagem opcional quando `MANUS_API_URL` e `MANUS_API_KEY` estão configurados.

A operação básica não exige chave de IA se a imagem oficial ou o Wikimedia Commons retornarem uma imagem HTTPS válida.

## Endpoints públicos

Todos os endpoints têm CORS aberto (`Access-Control-Allow-Origin: *`).

```text
GET  /api/health
GET  /api/trends?limit=20&category=Tecnologia&sort=recentes
GET  /api/trends/:id
GET  /api/rest/trends
GET  /api/categories
GET  /api/site-config
GET  /exports/flowtrend-blogger-export.xml
```

Filtros aceitos em `/api/trends`: `query`/`q`, `category`, `period` (`24h`, `7d`, `30d`), `status` (`em-alta`, `estavel`) e `sort` (`recentes`, `relevantes`).

## Processamento editorial

O processador Python recebe JSON ou RSS/XML pela entrada padrão. Ele remove scripts, iframes, estilos inline e elementos inseguros; cria título editorial, introdução, conclusão e descrição de até 150 caracteres; e gera um feed Atom compatível com importação no Blogger.

Exemplo JSON:

```bash
printf '{"articles":[{"title":"Exemplo","content":"Texto original","url":"https://example.com/noticia","source":"Fonte"}]}' \
  | python3 automation/processor.py --format json
```

A API também oferece rotas protegidas por token:

```text
POST /api/editorial/process
POST /api/editorial/export.xml
GET  /api/editorial/export.xml
```

Envie `Authorization: Bearer SEU_TOKEN` ou `X-FlowTrend-Token: SEU_TOKEN`. O endpoint de processamento grava automaticamente o XML em `public/exports/flowtrend-blogger-export.xml`.

## Implantação no Render, Railway, VPS ou AWS

Use o repositório ou o conteúdo deste ZIP como diretório da aplicação. Configure o comando de build como `pnpm install --frozen-lockfile && pnpm build` e o comando de inicialização como `pnpm start`. O health check deve consultar `/api/health`.

Configure as variáveis de `.env.example` no painel do provedor. Para armazenamento persistente, monte um volume em `/var/lib/flowtrend` e defina `LOCAL_DATABASE_PATH=/var/lib/flowtrend/database.json`. Sem volume persistente, o banco JSON pode ser perdido em reinícios ou novos deploys.

Em VPS Linux, use systemd, PM2 ou Docker e permita a porta configurada no firewall. Em provedores com proxy reverso, encaminhe HTTPS para a porta interna da aplicação; a aplicação já escuta em `0.0.0.0`.

## Docker

Exemplo de execução usando Node instalado no host:

```bash
pnpm install --frozen-lockfile
pnpm build
PORT=3000 pnpm start
```

O banco e o XML devem ser persistidos fora do container por volume. Não coloque `.env` ou tokens no ZIP nem no controle de versão.

## Segurança operacional

Defina um `FLOWTREND_AUTOMATION_TOKEN` longo e aleatório antes de habilitar os endpoints editoriais. Não exponha `MANUS_API_KEY`, tokens OAuth ou chaves de provedores no frontend. O CORS aberto é intencional para consumo por Blogger e sites estáticos; mantenha as rotas editoriais protegidas pelo token.
