import json
import mimetypes
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse


BASE_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = BASE_DIR / "frontend"
PORT = int(os.getenv("PORT", "3000"))
MODEL = os.getenv("OPENAI_MODEL", "gpt-5.4-mini")
banking_crm_chain = None


CRM_RECORDS = [
    {
        "id": "C-10492",
        "name": "Aarav Mehta",
        "segment": "Premier Banking",
        "relationshipManager": "Dana Park",
        "householdAum": "$1.84M",
        "products": ["Checking", "Mortgage", "Brokerage", "HELOC"],
        "risk": "Medium",
        "kycStatus": "Refresh due in 22 days",
        "amlSignals": ["Large incoming wire from known employer", "No adverse media"],
        "sentiment": "Neutral",
        "nextReview": "2026-05-18",
        "notes": [
            "Asked about refinancing mortgage if rates improve.",
            "Recent branch visit about HELOC draw documentation.",
        ],
        "cases": [
            {
                "id": "S-7821",
                "status": "Open",
                "topic": "HELOC document upload",
                "priority": "Normal",
            }
        ],
    },
    {
        "id": "C-11803",
        "name": "Marisol Chen",
        "segment": "Small Business",
        "relationshipManager": "Luis Benton",
        "householdAum": "$420K",
        "products": ["Business Checking", "Merchant Services", "SBA Loan"],
        "risk": "Low",
        "kycStatus": "Current",
        "amlSignals": ["Merchant deposits consistent with seasonality"],
        "sentiment": "Positive",
        "nextReview": "2026-06-04",
        "notes": [
            "Cafe expansion planned for Q3.",
            "Interested in payroll integration and card rewards.",
        ],
        "cases": [
            {
                "id": "S-8010",
                "status": "Waiting on client",
                "topic": "Payroll vendor form",
                "priority": "Low",
            }
        ],
    },
    {
        "id": "C-12377",
        "name": "Northstar Dental LLC",
        "segment": "Commercial Banking",
        "relationshipManager": "Priya Shah",
        "householdAum": "$3.2M",
        "products": ["Operating Account", "Treasury Management", "Equipment Loan"],
        "risk": "Elevated",
        "kycStatus": "Enhanced due diligence in progress",
        "amlSignals": [
            "New cross-border supplier payments",
            "Beneficial ownership update pending",
        ],
        "sentiment": "Concerned",
        "nextReview": "2026-05-07",
        "notes": [
            "CFO requested faster wires for dental equipment supplier.",
            "EDD checklist assigned to compliance operations.",
        ],
        "cases": [
            {
                "id": "S-7998",
                "status": "Escalated",
                "topic": "Beneficial ownership verification",
                "priority": "High",
            }
        ],
    },
]


SYSTEM_PROMPT = """You are an AI assistant inside an internal banking CRM. Help relationship managers and service agents understand customer context, summarize interactions, draft follow-ups, and identify operational next steps.

Rules:
- Use only the CRM context supplied in the request. If information is missing, say what is missing.
- Do not provide investment, tax, legal, credit approval, or regulatory determinations.
- Do not invent account balances, credit decisions, suspicious activity conclusions, or KYC outcomes.
- Flag compliance-sensitive items as "needs human/compliance review" when appropriate.
- Keep responses concise, actionable, and suitable for an internal banking employee.
- Never expose full account numbers, secrets, or unnecessary personal data."""


def send_json(handler, status_code, payload):
    body = json.dumps(payload).encode("utf-8")
    handler.send_response(status_code)
    handler.send_header("content-type", "application/json; charset=utf-8")
    handler.send_header("content-length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def read_json_body(handler):
    content_length = int(handler.headers.get("content-length", "0"))
    if content_length == 0:
        return {}

    raw_body = handler.rfile.read(content_length).decode("utf-8")
    return json.loads(raw_body or "{}")


def find_customer(query="", customer_id=""):
    normalized_query = query.lower()

    for record in CRM_RECORDS:
        if record["id"] == customer_id:
            return record

    for record in CRM_RECORDS:
        if record["name"].lower() in normalized_query:
            return record

    for record in CRM_RECORDS:
        if record["segment"].lower() in normalized_query:
            return record

    return CRM_RECORDS[0]


def mock_assistant(message, customer):
    lower_message = message.lower()
    compliance_note = (
        "Because this profile has elevated risk and active EDD, route ownership and "
        "supplier-payment questions to compliance review before committing to action."
        if customer["risk"] == "Elevated"
        else "No exceptional compliance blocker is visible in the supplied CRM context."
    )

    if "summar" in lower_message:
        cases = "; ".join(
            f"{case['topic']} ({case['status']})" for case in customer["cases"]
        )
        products = ", ".join(customer["products"])
        return (
            f"{customer['name']} is a {customer['segment']} client managed by "
            f"{customer['relationshipManager']}. Products: {products}. KYC status: "
            f"{customer['kycStatus']}. Current service focus: {cases}. {compliance_note}"
        )

    if "next" in lower_message or "action" in lower_message or "follow" in lower_message:
        case = customer["cases"][0]
        return (
            f"Recommended next steps for {customer['name']}: 1. Resolve or update "
            f"{case['id']}: {case['topic']}. 2. Prepare for the {customer['nextReview']} "
            f"relationship review. 3. Reference recent note: \"{customer['notes'][0]}\". "
            f"4. {compliance_note}"
        )

    if "risk" in lower_message or "kyc" in lower_message or "aml" in lower_message:
        aml_signals = "; ".join(customer["amlSignals"])
        return (
            f"{customer['name']} risk view: CRM risk is {customer['risk']}; KYC status is "
            f"\"{customer['kycStatus']}\". AML signals on file: {aml_signals}. This is "
            "not a suspicious activity determination; any concern needs human/compliance review."
        )

    return (
        f"For {customer['name']}, I found {customer['segment']} CRM context, "
        f"{len(customer['products'])} products, {len(customer['cases'])} active service case, "
        f"and sentiment marked {customer['sentiment']}. Ask for a summary, risk/KYC view, "
        "or next action plan to narrow the response."
    )


def get_banking_crm_chain():
    global banking_crm_chain

    if banking_crm_chain is None:
        try:
            from langchain_core.output_parsers import StrOutputParser
            from langchain_core.prompts import ChatPromptTemplate
            from langchain_openai import ChatOpenAI
        except ImportError as exc:
            raise RuntimeError(
                "LangChain packages are not installed. Run `pip install -r requirements.txt` "
                "before enabling OPENAI_API_KEY."
            ) from exc

        prompt = ChatPromptTemplate.from_messages(
            [
                ("system", SYSTEM_PROMPT),
                (
                    "human",
                    "CRM context:\n{crm_context}\n\n"
                    "Conversation so far:\n{history}\n\n"
                    "Employee request:\n{message}",
                ),
            ]
        )

        llm = ChatOpenAI(model=MODEL, temperature=0.2)
        banking_crm_chain = prompt | llm | StrOutputParser()

    return banking_crm_chain


def call_ai(message, customer, history=None):
    if not os.getenv("OPENAI_API_KEY"):
        return {"text": mock_assistant(message, customer), "mode": "mock"}

    chain = get_banking_crm_chain()
    response_text = chain.invoke(
        {
            "crm_context": json.dumps(customer, indent=2),
            "history": json.dumps((history or [])[-8:], indent=2),
            "message": message,
        }
    )

    return {"text": response_text, "mode": "langchain-openai", "model": MODEL}


class CrmChatbotHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed_path = urlparse(self.path)

        if parsed_path.path == "/api/customers":
            send_json(self, 200, {"customers": CRM_RECORDS})
            return

        self.serve_frontend_file(parsed_path.path)

    def do_POST(self):
        parsed_path = urlparse(self.path)

        if parsed_path.path != "/api/chat":
            send_json(self, 404, {"error": "Not found."})
            return

        try:
            body = read_json_body(self)
            message = str(body.get("message", "")).strip()

            if not message:
                send_json(self, 400, {"error": "Message is required."})
                return

            customer = find_customer(message, body.get("customerId", ""))
            history = body.get("history") if isinstance(body.get("history"), list) else []
            result = call_ai(message, customer, history)
            send_json(self, 200, {**result, "customer": customer})
        except json.JSONDecodeError:
            send_json(self, 400, {"error": "Invalid JSON body."})
        except Exception as exc:
            send_json(self, 500, {"error": str(exc)})

    def serve_frontend_file(self, request_path):
        relative_path = "index.html" if request_path == "/" else unquote(request_path.lstrip("/"))
        file_path = (FRONTEND_DIR / relative_path).resolve()

        if not str(file_path).startswith(str(FRONTEND_DIR.resolve())):
            self.send_error(403, "Forbidden")
            return

        if not file_path.is_file():
            self.send_error(404, "Not found")
            return

        content_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
        body = file_path.read_bytes()
        self.send_response(200)
        self.send_header("content-type", content_type)
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        print("%s - %s" % (self.address_string(), format % args))


def main():
    server = ThreadingHTTPServer(("localhost", PORT), CrmChatbotHandler)
    mode = f"LangChain OpenAI mode with {MODEL}" if os.getenv("OPENAI_API_KEY") else "Mock AI mode"
    print(f"Python Banking CRM AI chatbot running at http://localhost:{PORT}")
    print(mode)
    server.serve_forever()


if __name__ == "__main__":
    main()
