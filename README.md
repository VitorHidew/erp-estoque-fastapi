# ERP de Estoque com FastAPI

MVP fictício para controle de estoque, pedidos e finanças com FastAPI, SQLite e frontend web.

> Este repositório usa exclusivamente dados de demonstração fictícios.

## Tecnologias

- Python
- FastAPI
- SQLModel e SQLite
- HTML, CSS e JavaScript com módulos ES
- Pytest e HTTPX

## Funcionalidades

- cadastro de produtos, participantes e locais de estoque;
- entradas, saídas e contagens de inventário;
- pedidos com múltiplos itens e aprovação em lote;
- lançamentos financeiros, fluxo de caixa e conciliação;
- relatórios e exportações CSV;
- proteção opcional das rotas da API com `X-API-Key`;
- carga de dados fictícios para demonstração.

## Instalação

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

## Configuração

Copie `.env.example` para `.env` apenas como referência local. O aplicativo lê as variáveis do ambiente do processo; não carrega o arquivo `.env` automaticamente.

- `ERP_API_KEY`: chave opcional exigida nas rotas `/api/`.
- `DATABASE_URL`: conexão opcional; o padrão usa um arquivo SQLite local.

Nunca versione o arquivo `.env` nem bancos gerados localmente.

## Execução

```powershell
uvicorn app.main:app --reload
```

A interface fica disponível em `http://127.0.0.1:8000/` e a documentação da API em `http://127.0.0.1:8000/docs`.

## Testes

```powershell
python -m pytest tests/ -q
```

Os testes devem usar um banco SQLite temporário.

## Estrutura

```text
app/       API, modelos, segurança e persistência
scripts/   utilitários de diagnóstico
static/    interface web
tests/     testes automatizados
```

## Sobre o projeto

[PREENCHER]

## Licença

Este projeto está licenciado sob a licença MIT. Consulte `LICENSE`.
