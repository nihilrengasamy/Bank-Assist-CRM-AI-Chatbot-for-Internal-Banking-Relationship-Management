# Banking CRM AI Chatbot

An internal CRM chatbot for banking teams, built with a Python backend, a lightweight web frontend, and optional AI integration through LangChain and OpenAI.

The assistant helps relationship managers and service agents summarize customer profiles, review KYC/AML-sensitive CRM signals, identify operational next steps, and draft follow-up notes while keeping credit, investment, AML, legal, and regulatory decisions in human-owned workflows.

## Features

- Banking-domain CRM assistant for relationship managers and service agents
- Customer profile selector with segment, RM, risk, KYC, review date, and open case details
- Chat interface for summaries, risk views, next actions, and follow-up drafting
- Python backend with `/api/customers` and `/api/chat`
- LangChain AI path using `ChatPromptTemplate`, `ChatOpenAI`, and `StrOutputParser`
- Mock AI mode when no `OPENAI_API_KEY` is configured
- Compliance-oriented prompt guardrails for banking workflows
- Static frontend served directly by the Python backend

## Tech Stack

- Python 3.10+
- LangChain
- OpenAI via `langchain-openai`
- HTML, CSS, and JavaScript
- Built-in Python `http.server` for local development

## Project Structure

```text
.
|-- app.py                 # Python backend and API server
|-- requirements.txt       # Python AI dependencies
|-- frontend/
|   |-- index.html         # Frontend page
|   |-- styles.css         # UI styling
|   `-- app.js             # Chat and customer UI logic
|-- server.js              # Earlier Node.js version
|-- public/                # Earlier Node.js frontend
|-- package.json           # Earlier Node.js dependencies
`-- README.md
```

The primary version of this project is the Python implementation in `app.py` and `frontend/`.

## Quick Start

Run the app in mock AI mode:

```powershell
python app.py
```

Open:

```text
http://localhost:3000
```

Mock mode does not require an API key and is useful for UI demos, local testing, and explaining the workflow.

## Enable Live AI

Install Python dependencies:

```powershell
pip install -r requirements.txt
```

Set your OpenAI API key:

```powershell
$env:OPENAI_API_KEY="your_api_key_here"
$env:OPENAI_MODEL="gpt-5.4-mini"
python app.py
```

If `OPENAI_MODEL` is not set, the app defaults to:

```text
gpt-5.4-mini
```

## How It Works

The frontend sends the employee's question, selected customer ID, and recent chat history to the Python backend.

```text
Frontend chat request
  -> /api/chat
  -> CRM customer lookup
  -> Banking compliance system prompt
  -> LangChain ChatPromptTemplate
  -> ChatOpenAI
  -> StrOutputParser
  -> Chat response
```

When `OPENAI_API_KEY` is missing, the backend uses deterministic mock responses so the app remains fully runnable.

## API Endpoints

### Get Customers

```http
GET /api/customers
```

Returns sample CRM customer records.

### Chat

```http
POST /api/chat
Content-Type: application/json
```

Example request:

```json
{
  "message": "Summarize Northstar Dental risk and next actions",
  "customerId": "C-12377",
  "history": []
}
```

Example response:

```json
{
  "text": "Northstar Dental LLC is a Commercial Banking client...",
  "mode": "mock",
  "customer": {
    "id": "C-12377",
    "name": "Northstar Dental LLC"
  }
}
```

## Banking Guardrails

The assistant is designed for internal operational support only. It should not be used to make final decisions about:

- Credit approvals
- Investment advice
- Tax or legal advice
- AML or suspicious activity determinations
- Regulatory conclusions
- KYC completion status without human review

For production use, keep all regulated decisions in reviewed workflows owned by qualified banking, compliance, legal, or risk teams.

## Production Hardening

Before connecting this to real banking systems:

- Add authentication and role-based access control
- Replace `CRM_RECORDS` in `app.py` with CRM, case-management, KYC, and core banking integrations
- Add audit logging for prompts, responses, user IDs, timestamps, and selected customer records
- Redact or minimize sensitive customer data before sending context to the model
- Add rate limits and request validation
- Add monitoring for model failures and fallback behavior
- Add approved backend tools for deterministic CRM actions, such as creating a case note or assigning a follow-up task
- Review all prompts, outputs, and data flows with compliance and security teams

## Local Development

Run syntax checks:

```powershell
python -m py_compile app.py
```

Start the server:

```powershell
python app.py
```

The app serves frontend files from:

```text
frontend/
```

## Environment Variables

| Variable | Required | Description |
| --- | --- | --- |
| `OPENAI_API_KEY` | No | Enables live LangChain/OpenAI responses. Without it, mock mode is used. |
| `OPENAI_MODEL` | No | OpenAI model name. Defaults to `gpt-5.4-mini`. |
| `PORT` | No | Local server port. Defaults to `3000`. |

## Notes

This repository also contains an earlier Node.js version in `server.js`, `public/`, and `package.json`. The recommended version for this project is the Python backend in `app.py`.

## License

Add your preferred license before publishing this repository.
