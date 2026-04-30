import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(__dirname, "public");
const port = Number(process.env.PORT || 3000);
const model = process.env.OPENAI_MODEL || "gpt-5.4-mini";
let bankingCrmChain;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

const crmRecords = [
  {
    id: "C-10492",
    name: "Aarav Mehta",
    segment: "Premier Banking",
    relationshipManager: "Dana Park",
    householdAum: "$1.84M",
    products: ["Checking", "Mortgage", "Brokerage", "HELOC"],
    risk: "Medium",
    kycStatus: "Refresh due in 22 days",
    amlSignals: ["Large incoming wire from known employer", "No adverse media"],
    sentiment: "Neutral",
    nextReview: "2026-05-18",
    notes: ["Asked about refinancing mortgage if rates improve.", "Recent branch visit about HELOC draw documentation."],
    cases: [{ id: "S-7821", status: "Open", topic: "HELOC document upload", priority: "Normal" }]
  },
  {
    id: "C-11803",
    name: "Marisol Chen",
    segment: "Small Business",
    relationshipManager: "Luis Benton",
    householdAum: "$420K",
    products: ["Business Checking", "Merchant Services", "SBA Loan"],
    risk: "Low",
    kycStatus: "Current",
    amlSignals: ["Merchant deposits consistent with seasonality"],
    sentiment: "Positive",
    nextReview: "2026-06-04",
    notes: ["Cafe expansion planned for Q3.", "Interested in payroll integration and card rewards."],
    cases: [{ id: "S-8010", status: "Waiting on client", topic: "Payroll vendor form", priority: "Low" }]
  },
  {
    id: "C-12377",
    name: "Northstar Dental LLC",
    segment: "Commercial Banking",
    relationshipManager: "Priya Shah",
    householdAum: "$3.2M",
    products: ["Operating Account", "Treasury Management", "Equipment Loan"],
    risk: "Elevated",
    kycStatus: "Enhanced due diligence in progress",
    amlSignals: ["New cross-border supplier payments", "Beneficial ownership update pending"],
    sentiment: "Concerned",
    nextReview: "2026-05-07",
    notes: ["CFO requested faster wires for dental equipment supplier.", "EDD checklist assigned to compliance operations."],
    cases: [{ id: "S-7998", status: "Escalated", topic: "Beneficial ownership verification", priority: "High" }]
  }
];

const systemPrompt = `You are an AI assistant inside an internal banking CRM. Help relationship managers and service agents understand customer context, summarize interactions, draft follow-ups, and identify operational next steps.

Rules:
- Use only the CRM context supplied in the request. If information is missing, say what is missing.
- Do not provide investment, tax, legal, credit approval, or regulatory determinations.
- Do not invent account balances, credit decisions, suspicious activity conclusions, or KYC outcomes.
- Flag compliance-sensitive items as "needs human/compliance review" when appropriate.
- Keep responses concise, actionable, and suitable for an internal banking employee.
- Never expose full account numbers, secrets, or unnecessary personal data.`;

function sendJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function findCustomer(query = "", customerId = "") {
  const normalizedQuery = query.toLowerCase();
  return crmRecords.find((record) => record.id === customerId)
    || crmRecords.find((record) => normalizedQuery.includes(record.name.toLowerCase()))
    || crmRecords.find((record) => normalizedQuery.includes(record.segment.toLowerCase()))
    || crmRecords[0];
}

function mockAssistant(message, customer) {
  const lower = message.toLowerCase();
  const complianceNote = customer.risk === "Elevated"
    ? "Because this profile has elevated risk and active EDD, route ownership and supplier-payment questions to compliance review before committing to action."
    : "No exceptional compliance blocker is visible in the supplied CRM context.";

  if (lower.includes("summar")) {
    return `${customer.name} is a ${customer.segment} client managed by ${customer.relationshipManager}. Products: ${customer.products.join(", ")}. KYC status: ${customer.kycStatus}. Current service focus: ${customer.cases.map((c) => `${c.topic} (${c.status})`).join("; ")}. ${complianceNote}`;
  }

  if (lower.includes("next") || lower.includes("action") || lower.includes("follow")) {
    return `Recommended next steps for ${customer.name}: 1. Resolve or update ${customer.cases[0].id}: ${customer.cases[0].topic}. 2. Prepare for the ${customer.nextReview} relationship review. 3. Reference recent note: "${customer.notes[0]}". 4. ${complianceNote}`;
  }

  if (lower.includes("risk") || lower.includes("kyc") || lower.includes("aml")) {
    return `${customer.name} risk view: CRM risk is ${customer.risk}; KYC status is "${customer.kycStatus}". AML signals on file: ${customer.amlSignals.join("; ")}. This is not a suspicious activity determination; any concern needs human/compliance review.`;
  }

  return `For ${customer.name}, I found ${customer.segment} CRM context, ${customer.products.length} products, ${customer.cases.length} active service case, and sentiment marked ${customer.sentiment}. Ask for a summary, risk/KYC view, or next action plan to narrow the response.`;
}

async function getBankingCrmChain() {
  if (!bankingCrmChain) {
    let modules;
    try {
      modules = await Promise.all([
        import("@langchain/core/prompts"),
        import("@langchain/core/output_parsers"),
        import("@langchain/core/runnables"),
        import("@langchain/openai")
      ]);
    } catch {
      throw new Error("LangChain packages are not installed. Run `npm install` before enabling OPENAI_API_KEY.");
    }

    const [{ ChatPromptTemplate }, { StringOutputParser }, { RunnableSequence }, { ChatOpenAI }] = modules;
    const bankingPrompt = ChatPromptTemplate.fromMessages([
      ["system", systemPrompt],
      [
        "human",
        "CRM context:\n{crmContext}\n\nConversation so far:\n{history}\n\nEmployee request:\n{message}"
      ]
    ]);

    bankingCrmChain = RunnableSequence.from([
      bankingPrompt,
      new ChatOpenAI({
        model,
        temperature: 0.2,
        apiKey: process.env.OPENAI_API_KEY
      }),
      new StringOutputParser()
    ]);
  }

  return bankingCrmChain;
}

async function callLangChain(message, customer, history = []) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { text: mockAssistant(message, customer), mode: "mock" };
  }

  const chain = await getBankingCrmChain();
  const text = await chain.invoke({
    crmContext: JSON.stringify(customer, null, 2),
    history: JSON.stringify(history.slice(-8), null, 2),
    message
  });

  return { text, mode: "langchain-openai", model };
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = normalize(join(publicDir, requestedPath));

  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const file = await readFile(filePath);
    res.writeHead(200, { "content-type": mimeTypes[extname(filePath)] || "application/octet-stream" });
    res.end(file);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/api/customers") {
      sendJson(res, 200, { customers: crmRecords });
      return;
    }

    if (req.method === "POST" && req.url === "/api/chat") {
      const body = await readBody(req);
      const message = String(body.message || "").trim();
      if (!message) {
        sendJson(res, 400, { error: "Message is required." });
        return;
      }

      const customer = findCustomer(message, body.customerId);
      const result = await callLangChain(message, customer, Array.isArray(body.history) ? body.history : []);
      sendJson(res, 200, { ...result, customer });
      return;
    }

    if (req.method === "GET") {
      await serveStatic(req, res);
      return;
    }

    sendJson(res, 405, { error: "Method not allowed." });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Unexpected server error." });
  }
});

server.listen(port, () => {
  console.log(`Banking CRM AI chatbot running at http://localhost:${port}`);
  console.log(process.env.OPENAI_API_KEY ? `LangChain OpenAI mode enabled with ${model}` : "Mock AI mode enabled. Set OPENAI_API_KEY for live AI.");
});
