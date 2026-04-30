const customerSelect = document.querySelector("#customerSelect");
const profileCard = document.querySelector("#profileCard");
const messages = document.querySelector("#messages");
const chatForm = document.querySelector("#chatForm");
const messageInput = document.querySelector("#messageInput");
const aiMode = document.querySelector("#aiMode");
const quickButtons = document.querySelectorAll("[data-prompt]");
let customers = [];
let history = [];
function selectedCustomer() { return customers.find((customer) => customer.id === customerSelect.value) || customers[0]; }
function riskClass(risk) { return risk === "Elevated" ? "risk-elevated" : risk === "Medium" ? "risk-medium" : ""; }
function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}
function renderProfile(customer) {
  profileCard.innerHTML = `
    <div class="metric"><span>Segment</span><strong>${escapeHtml(customer.segment)}</strong></div>
    <div class="metric"><span>RM</span><strong>${escapeHtml(customer.relationshipManager)}</strong></div>
    <div class="metric"><span>Relationship</span><strong>${escapeHtml(customer.householdAum)}</strong></div>
    <div class="metric"><span>Risk</span><strong class="${riskClass(customer.risk)}">${escapeHtml(customer.risk)}</strong></div>
    <div class="metric"><span>KYC</span><strong>${escapeHtml(customer.kycStatus)}</strong></div>
    <div class="metric"><span>Next review</span><strong>${escapeHtml(customer.nextReview)}</strong></div>
    <div class="metric"><span>Open case</span><strong>${escapeHtml(customer.cases[0].topic)}</strong></div>`;
}
function addMessage(role, text, meta = "") {
  const item = document.createElement("article");
  item.className = `message ${role}`;
  item.innerHTML = `<span class="message-meta">${escapeHtml(meta || role)}</span>${escapeHtml(text)}`;
  messages.appendChild(item);
  messages.scrollTop = messages.scrollHeight;
}
function setBusy(isBusy) {
  chatForm.querySelector("button").disabled = isBusy;
  messageInput.disabled = isBusy;
}
async function sendMessage(text) {
  const customer = selectedCustomer();
  addMessage("user", text, "Employee");
  history.push({ role: "user", content: text });
  setBusy(true);
  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: text, customerId: customer.id, history })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Chat request failed.");
    aiMode.textContent = data.mode === "langchain-openai" ? `LangChain ${data.model}` : "Mock AI";
    addMessage("assistant", data.text, `Assistant - ${data.customer.name}`);
    history.push({ role: "assistant", content: data.text });
  } catch (error) {
    addMessage("assistant", `Unable to answer right now: ${error.message}`, "System");
  } finally {
    setBusy(false);
    messageInput.focus();
  }
}
async function loadCustomers() {
  const response = await fetch("/api/customers");
  const data = await response.json();
  customers = data.customers;
  customerSelect.innerHTML = customers.map((customer) => `<option value="${escapeHtml(customer.id)}">${escapeHtml(customer.name)} - ${escapeHtml(customer.segment)}</option>`).join("");
  renderProfile(selectedCustomer());
  addMessage("assistant", "Ready. Choose a customer and ask for a summary, risk view, next action plan, or relationship-manager follow-up.", "Assistant");
}
customerSelect.addEventListener("change", () => {
  history = [];
  renderProfile(selectedCustomer());
  messages.innerHTML = "";
  addMessage("assistant", `Switched to ${selectedCustomer().name}. What should we review?`, "Assistant");
});
chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = messageInput.value.trim();
  if (!text) return;
  messageInput.value = "";
  sendMessage(text);
});
quickButtons.forEach((button) => button.addEventListener("click", () => sendMessage(button.dataset.prompt)));
loadCustomers();
