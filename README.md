# Middleware de Geolocalizacao no Edge com Cloudflare Workers

Middleware serverless escrito em TypeScript para Cloudflare Workers que intercepta requisicoes HTTP na borda da rede, extrai dados geograficos do cliente e aplica politicas de bloqueio por pais (geofencing), injecao de headers customizados e assinatura criptografica dos metadados.

---

## Objetivo

Criar uma camada de middleware que roda em datacenters da Cloudflare ao redor do mundo, processando requisicoes antes delas chegarem ao servidor de origem. O middleware le os dados de geolocalizacao que a propria Cloudflare ja injeta na requisicao (objeto `request.cf`) e toma decisoes com base neles: bloquear acessos de paises especificos, enriquecer a requisicao com headers de localizacao, e assinar esses dados com HMAC para garantir integridade.

---

## Requisitos

- Node.js 18 ou superior
- Conta na Cloudflare (para deploy)
- Wrangler CLI (gerenciamento do Worker)
- TypeScript 5.x

---

## Especificacoes

### Fluxo de processamento

```
Cliente
  |
  v
Cloudflare Edge (datacenter mais proximo)
  |
  v
Worker intercepta o evento fetch
  |
  v
1. Extrai dados do request.cf (pais, regiao, cidade, fuso, continente, lat, lon)
2. Anonimiza lat/lon (trunca para 1 decimal)
3. Verifica blocklist / allowlist configurada via env
4. Se bloqueado -> retorna 403 Forbidden na borda
5. Se permitido -> monta payload para assinatura
6. Gera HMAC-SHA256 do payload (se SIGNING_SECRET estiver configurada)
7. Injeta headers X-Edge-Geo-* na requisicao upstream
8. Replica os mesmos headers na resposta de volta ao cliente
```

### Diagrama da arquitetura

```
+----------------+     +-------------------------------------------+     +------------+
|                |     |           CLOUDFLARE WORKER                |     |            |
|   Cliente      |---->|  +----------+  +-----------+  +---------+ |---->|   Origem   |
|   (HTTP)       |     |  | extract  |  | geofence  |  | inject  | |     |  (Backend) |
|                |     |  | GeoData  |  | blocklist |  | Headers | |     |            |
+----------------+     |  +----------+  +-----------+  +---------+ |     +------------+
                       |       |              |                    |
                       |       v              v                    |
                       |  +----------+  +-----------+              |
                       |  | truncate |  | 403       |              |
                       |  | lat/lon  |  | Forbidden |              |
                       |  +----------+  +-----------+              |
                       +-------------------------------------------+
```

### Headers injetados

| Header | Descricao | Exemplo |
|---|---|---|
| `X-Edge-Geo-Country` | Codigo ISO do pais (2 letras) | `BR` |
| `X-Edge-Geo-Region` | Codigo da regiao/estado | `SP` |
| `X-Edge-Geo-City` | Nome da cidade | `Sao Paulo` |
| `X-Edge-Geo-Timezone` | Fuso horario IANA | `America/Sao_Paulo` |
| `X-Edge-Geo-Continent` | Codigo do continente | `SA` |
| `X-Edge-Geo-Latitude` | Latitude truncada (1 decimal) | `-23.5` |
| `X-Edge-Geo-Longitude` | Longitude truncada (1 decimal) | `-46.6` |
| `X-Edge-Geo-Signature` | HMAC-SHA256 hex do payload | `a1b2c3...` ou `unsigned` |

### Tratamento de erros

- Se `request.cf` for `null` ou `undefined`: fallback para pais `XX` e campos `unknown`, sem quebrar o pipeline
- Se qualquer excecao ocorrer durante o processamento: retorna HTTP 500 com `{ error: "mensagem", code: "INTERNAL_ERROR" }`
- Se o pais estiver na blocklist ou fora da allowlist: retorna HTTP 403 com `{ error: "mensagem", code: "GEO_BLOCKED" }`

---

## Stacks e Tecnologias

| Componente | Tecnologia |
|---|---|
| Runtime | Cloudflare Workers (V8 Isolates) |
| Linguagem | TypeScript 5.7 |
| Empacotador | Wrangler 4 (esbuild) |
| Testes | Vitest 3 |
| Criptografia | Web Crypto API (HMAC-SHA256) |

### Dependencias (devDependencies)

```json
{
  "@cloudflare/workers-types": "^4.20250401.0",
  "typescript": "^5.7.0",
  "vitest": "^3.1.0",
  "wrangler": "^4.10.0"
}
```

---

## Instalacao

```bash
# Clone o repositorio
git clone https://github.com/anomalyco/Middleware-de-Geocalizacao-no-Edge-Cloudflare-Workers-TS.git
cd Middleware-de-Geocalizacao-no-Edge-Cloudflare-Workers-TS

# Instale as dependencias
npm install
```

---

## Manual do Usuario

### Desenvolvimento local

```bash
# Inicia servidor local na porta 8787
npx wrangler dev
```

### Simulando requisicoes com curl

```bash
# Pais permitido (BR)
curl -s -H "cf-country: BR" http://localhost:8787/ | head -20

# Pais bloqueado (KP -> Coreia do Norte)
curl -s -H "cf-country: KP" http://localhost:8787/
# Resposta: {"error":"Acesso bloqueado pela politica de geolocalizacao da borda.","code":"GEO_BLOCKED"}

# Pais permitido com lat/lon
curl -s -H "cf-country: US" -H "cf-region: CA" -H "cf-city: San Francisco" http://localhost:8787/ -v 2>&1 | grep -i x-edge
```

### Configuracao de variaveis

Edite o arquivo `wrangler.toml` ou use secrets para producao:

```toml
[vars]
ALLOWED_COUNTRIES = "BR,US,FR,DE"    # Se vazio, permite todos exceto blocklist
BLOCKED_COUNTRIES = "CU,IR,KP,SY"    # Prioridade maior que allowlist
```

Para dados sensiveis em producao:

```bash
npx wrangler secret put SIGNING_SECRET
npx wrangler secret put ALLOWED_COUNTRIES
npx wrangler secret put BLOCKED_COUNTRIES
```

### Deploy

```bash
npx wrangler deploy
```

O Worker e distribuido automaticamente para toda a rede da Cloudflare.

---

## Testes

```bash
# Executa todos os testes
npm test

# Modo watch (desenvolvimento)
npm run test:watch

# Verificacao de tipos
npm run typecheck
```

### Cobertura de testes (14 cenarios)

- Bloqueio de paises na blocklist (KP, CU)
- Permissao de paises fora da blocklist (BR)
- Funcionamento da allowlist (CN bloqueado, BR permitido)
- Injecao de todos os headers X-Edge-Geo-*
- Truncamento de latitude/longitude
- Assinatura HMAC (com e sem secret)
- Fallback com request.cf null
- Fallback com request.cf undefined
- Fallback com request.cf parcial
- Tratamento de erro interno (500)
- Headers replicados na resposta

---

## Estrutura do Projeto

```
/
├── wrangler.toml            # Config do Worker (variaveis, build)
├── package.json             # Scripts e dependencias
├── tsconfig.json            # Configuracao TypeScript strict
├── vitest.config.ts         # Configuracao do Vitest
├── src/
│   ├── index.ts             # Middleware principal (fetch handler)
│   ├── types/
│   │   └── index.ts         # Interfaces e tipos do dominio
│   └── utils/
│       └── crypto.ts        # Funcao de assinatura HMAC
├── tests/
│   └── index.test.ts        # Suite de testes automatizados
└── README.md
```

---

## Licenca

MIT
