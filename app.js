import { parsePricing, calculatePrint, invoiceBreakdown, capabilitiesFor } from "./pricing.mjs";
const $ = id => document.getElementById(id);
const form = $("calculatorForm");
const numericFields = ["materialCost", "printHours", "printMinutes", "operatorMinutes", "payRate"];
let pricing = null;
let bill = [];
let editingId = null;
let nextId = 1;
let dirty = false;
let activePrinterIndex = 0;
let typeahead = "";
let typeaheadTime = 0;
let fieldsProfileId = null;
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" }[char]));
const money = value => new Intl.NumberFormat(undefined, { style:"currency", currency:pricing.currency }).format(value);
// Round each displayed print to currency precision so the bill equals its visible line items.
function rounded(value) {
  const digits = new Intl.NumberFormat("en", { style:"currency", currency:pricing.currency }).resolvedOptions().maximumFractionDigits;
  return Number(value.toFixed(digits));
}
function readInput() {
  return { name:$("printName").value.trim(), description:$("jobDescription").disabled ? "" : $("jobDescription").value.trim(), printerId:$("printer").value,
    ...Object.fromEntries(numericFields.map(key => [key, $(key).disabled ? 0 : $(key).value === "" ? NaN : Number($(key).value)])) };
}
function configFor(input) { return pricing.printers.find(p => p.id === input.printerId); }
function updatePrinterImage() {
  const config = configFor(readInput());
  document.querySelectorAll("#printerOptions [role=option]").forEach((option, index) => {
    option.setAttribute("aria-selected", String(pricing.printers[index].id === config.id));
  });
  const image = $("printerImage");
  $("printerModel").textContent = config.name;
  const path = config.image ? new URL(config.image, import.meta.url).href : "";
  if (image.dataset.path === path) return;
  image.dataset.path = path;
  image.hidden = true;
  image.alt = "";
  image.onload = () => { image.hidden = false; };
  image.onerror = () => { image.hidden = true; };
  if (path) image.src = path;
  else image.removeAttribute("src");
}
function highlightPrinter(index) {
  activePrinterIndex = (index + pricing.printers.length) % pricing.printers.length;
  const options = [...$("printerOptions").children];
  options.forEach((option, i) => option.classList.toggle("active", i === activePrinterIndex));
  $("printerPicker").setAttribute("aria-activedescendant", options[activePrinterIndex].id);
  options[activePrinterIndex].scrollIntoView({block:"nearest"});
}
function openPrinters() {
  if (!pricing) return;
  $("printerOptions").hidden = false;
  $("printerPicker").setAttribute("aria-expanded", "true");
  highlightPrinter(pricing.printers.findIndex(p => p.id === $("printer").value));
}
function closePrinters() {
  $("printerOptions").hidden = true;
  $("printerPicker").setAttribute("aria-expanded", "false");
  $("printerPicker").removeAttribute("aria-activedescendant");
  typeahead = "";
}
function choosePrinter(index) {
  $("printer").value = pricing.printers[index].id;
  closePrinters();
  $("printer").dispatchEvent(new Event("input", {bubbles:true}));
  $("printerPicker").focus();
}
$("printerPicker").addEventListener("click", () => {
  if ($("printerOptions").hidden) openPrinters(); else closePrinters();
});
$("printerPicker").addEventListener("keydown", event => {
  if (!pricing) return;
  const open = !$("printerOptions").hidden;
  if (event.key === "Tab") { closePrinters(); return; }
  if (event.key === "Escape") { if(open) event.preventDefault(); closePrinters(); return; }
  if (["ArrowDown", "ArrowUp", "Home", "End", "Enter", " "].includes(event.key)) {
    event.preventDefault();
    if (!open) { openPrinters(); if(event.key === "Home") highlightPrinter(0); if(event.key === "End") highlightPrinter(pricing.printers.length-1); return; }
    if (event.key === "Enter" || event.key === " ") choosePrinter(activePrinterIndex);
    else if (event.key === "Home") highlightPrinter(0);
    else if (event.key === "End") highlightPrinter(pricing.printers.length-1);
    else highlightPrinter(activePrinterIndex + (event.key === "ArrowDown" ? 1 : -1));
  } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
    if (!open) openPrinters();
    const now = Date.now();
    typeahead = (now-typeaheadTime > 800 ? "" : typeahead) + event.key.toLowerCase();
    typeaheadTime = now;
    const index = pricing.printers.findIndex(p => p.name.toLowerCase().startsWith(typeahead));
    if (index >= 0) highlightPrinter(index);
  }
});
// Keep focus on the combobox while choosing with a mouse; touch scrolling remains native.
$("printerOptions").addEventListener("mousedown", event => event.preventDefault());
$("printerOptions").addEventListener("click", event => {
  const option = event.target.closest("[role=option]");
  if (option) choosePrinter(Number(option.dataset.index));
});
$("printerControl").addEventListener("focusout", event => {
  if (!$("printerControl").contains(event.relatedTarget)) closePrinters();
});
document.addEventListener("pointerdown", event => {
  if (!$("printerControl").contains(event.target)) closePrinters();
});
function buildPrinterOptions() {
  $("printerOptions").replaceChildren(...pricing.printers.map((config,index) => {
    const option=document.createElement("div");
    option.id=`printer-option-${index}`;
    option.setAttribute("role","option");
    option.setAttribute("aria-selected","false");
    option.dataset.index=index;
    if(config.image) {
      const image=document.createElement("img");
      image.src=new URL(config.image,import.meta.url).href;
      image.alt=""; image.width=64; image.height=64;
      image.addEventListener("error",()=>{image.hidden=true;});
      option.append(image);
    }
    const text=document.createElement("span"); text.className="machine-choice-text";
    const name=document.createElement("strong"); name.id=`machine-name-${index}`; name.textContent=config.name;
    text.append(name); option.setAttribute("aria-labelledby",name.id);
    if(config.description) {
      const description=document.createElement("small");
      description.id=`machine-description-${index}`; description.textContent=config.description;
      text.append(description); option.setAttribute("aria-describedby",description.id);
    }
    option.append(text);
    return option;
  }));
}
function applyCapabilities(config) {
  const capabilities = capabilitiesFor(config);
  const changed = fieldsProfileId !== config.id;
  fieldsProfileId = config.id;
  for (const [container, enabled, fields] of [
    ["materialFields", capabilities.material, ["materialCost"]],
    ["printTimeFields", capabilities.printTime, ["printHours", "printMinutes"]],
    ["laborFields", capabilities.labor !== "disabled", ["operatorMinutes", "payRate"]]
  ]) {
    $(container).hidden = !enabled;
    fields.forEach(key => { $(key).disabled = !enabled; $(key).required = enabled; });
  }
  $("descriptionFields").hidden = !capabilities.extendedDescription;
  $("jobDescription").disabled = !capabilities.extendedDescription;
  const requiredLabor = capabilities.labor === "required";
  $("laborSummary").hidden = requiredLabor;
  $("optionalLaborHint").hidden = requiredLabor;
  $("operatorMinutes").min = requiredLabor ? "1" : "0";
  $("payRate").min = requiredLabor ? "0.01" : "0";
  if (changed) {
    $("laborFields").open = requiredLabor;
    for (const key of ["operatorMinutes", "payRate"]) {
      if (requiredLabor && Number($(key).value) <= 0) $(key).value = "";
      if (!requiredLabor && $(key).value === "") $(key).value = "0";
    }
  }
  $("entryHelp").hidden = !capabilities.printTime;
  $("printerHelp").hidden = !capabilities.printTime;
}
function updateDraft() {
  $("formError").textContent = "";
  if (!pricing) return;
  applyCapabilities(configFor(readInput()));
  updatePrinterImage();
  try {
    const input = readInput();
    if (numericFields.some(key => !$(key).disabled && !$(key).validity.valid)) throw new Error("Check the material cost and time fields.");
    $("draftTotal").textContent = money(calculatePrint(input, configFor(input)).total);
  } catch { $("draftTotal").textContent = "—"; }
  $("cancelButton").hidden = !dirty;
  $("cancelButton").textContent = editingId === null ? "Clear entry" : "Cancel edit";
  $("unsavedNote").hidden = !dirty;
  $("printButton").disabled = !bill.length || dirty;
}
function resetEditor() {
  closePrinters();
  form.reset();
  fieldsProfileId = null;
  $("printer").value = pricing.defaultPrinter;
  editingId = null;
  dirty = false;
  $("editorTitle").textContent = "Add a job";
  $("saveButton").textContent = "Add to bill";
  $("cancelButton").hidden = true;
  updateDraft();
}
function renderBill() {
  $("emptyBill").hidden = bill.length > 0;
  $("printCount").textContent = `${bill.length} job${bill.length === 1 ? "" : "s"}`;
  $("billItems").innerHTML = bill.map(entry => {
    const config = configFor(entry);
    const result = calculatePrint(entry, config);
    const capabilities = capabilitiesFor(config);
    const invoice = invoiceBreakdown(result, pricing.currency);
    const groups = [];
    if (capabilities.material) groups.push(["Material",result.groups.material]);
    if (capabilities.maintenance) groups.push(["Time-based upkeep & electricity",result.groups.time],["Per-print upkeep",result.groups.fees]);
    if (result.groups.operator > 0) groups.push(["Operator labor",result.groups.operator]);
    return `<article class="bill-item" data-id="${entry.id}">
      <div class="item-heading"><h3>${escapeHtml(entry.name)}</h3><strong>${money(result.total)}</strong></div>
      <p class="item-meta">${escapeHtml(config.name)}${capabilities.printTime ? ` · ${entry.printHours} hr ${entry.printMinutes} min` : ""}</p>
      ${entry.description ? `<p class="job-description">${escapeHtml(entry.description)}</p>` : ""}
      <dl class="cost-groups invoice-costs print-only">
        ${capabilities.material ? `<div><dt>Material</dt><dd>${money(invoice.material)}</dd></div>` : ""}
        ${capabilities.maintenance ? `<div><dt>Maintenance fees</dt><dd>${money(invoice.maintenance)}</dd></div>` : ""}
        ${invoice.hasLabor ? `<div><dt>Labor fees</dt><dd>${money(invoice.labor)}</dd></div>` : ""}
      </dl>
      <details class="item-details screen-only"><summary>View cost breakdown</summary>
        <dl class="cost-groups">${groups.map(([label,value]) => `<div><dt>${label}</dt><dd>${money(value)}</dd></div>`).join("")}</dl>
        <table><caption class="sr-only">Charges for ${escapeHtml(entry.name)}</caption><thead><tr><th scope="col">Charge</th><th scope="col">Basis (${escapeHtml(pricing.currency)})</th><th scope="col">Cost</th></tr></thead><tbody>${result.rows.map(row => `<tr><td>${escapeHtml(row.item)}</td><td>${escapeHtml(row.basis)}</td><td>${money(row.cost)}</td></tr>`).join("")}</tbody></table>
        <p class="rounding">Charges use full-precision rates. Displayed breakdown amounts are rounded and may differ by a cent when added.</p>
      </details>
      <div class="item-actions screen-only"><button class="secondary" type="button" data-action="edit" aria-label="Edit ${escapeHtml(entry.name)}">Edit</button><button class="secondary" type="button" data-action="remove" aria-label="Remove ${escapeHtml(entry.name)}">Remove</button></div>
    </article>`;
  }).join("");
  const total = bill.reduce((sum, entry) => sum + rounded(calculatePrint(entry,configFor(entry)).total),0);
  $("billTotal").textContent = money(total);
  updateDraft();
}
form.addEventListener("invalid", event => {
  const details = event.target.closest("details");
  if (details) details.open = true;
}, true);
form.addEventListener("input", () => { dirty = true; updateDraft(); });
form.addEventListener("submit", event => {
  event.preventDefault();
  if (!pricing || !form.reportValidity()) return;
  const input = readInput();
  if (!input.name) { $("formError").textContent = "Give this job a name."; $("printName").focus(); return; }
  try { calculatePrint(input, configFor(input)); } catch { $("formError").textContent = "Check your entries. This estimate is too large to calculate."; return; }
  if (editingId !== null) bill = bill.map(entry => entry.id === editingId ? { ...input, id:editingId } : entry);
  else bill.push({ ...input, id:nextId++ });
  $("announcement").textContent = `${input.name} ${editingId === null ? "added to" : "updated on"} the bill.`;
  resetEditor(); renderBill(); $("printName").focus();
});
$("cancelButton").addEventListener("click", () => { resetEditor(); $("printName").focus(); });
$("billItems").addEventListener("click", event => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const id = Number(button.closest("article").dataset.id);
  const entry = bill.find(item => item.id === id);
  if (button.dataset.action === "edit") {
    if (dirty && !window.confirm("Discard the unsaved form changes and edit this job?")) return;
    editingId = id;
    $("jobDescription").value = entry.description || "";
    $("printName").value = entry.name; $("printer").value = entry.printerId;
    numericFields.forEach(key => { $(key).value = entry[key]; });
    $("editorTitle").textContent = "Edit job";
    $("saveButton").textContent = "Save changes";
    $("cancelButton").hidden = false;
    dirty = true; updateDraft(); $("printName").focus();
    form.scrollIntoView({ block:"start", behavior:"smooth" });
  } else {
    bill = bill.filter(item => item.id !== id);
    if (editingId === id) resetEditor();
    renderBill();
    $("announcement").textContent = `${entry.name} removed from the bill.`;
    const remaining = $("billItems").querySelector("button");
    (remaining || $("printName")).focus();
  }
});
function updateBillTo() {
  const recipient = $("billTo").value.trim();
  $("billToPrint").textContent = recipient;
  $("billToPrintContainer").hidden = !recipient;
}
$("billTo").addEventListener("input", updateBillTo);
function preparePrint() {
  updateBillTo();
  $("invoiceDate").textContent = new Date().toLocaleString();
}
window.addEventListener("beforeprint", preparePrint);
$("printButton").addEventListener("click", () => { if (bill.length && !dirty) window.print(); });
async function loadPricing() {
  pricing = null;
  $("inputFields").disabled = true;
  $("printButton").disabled = true;
  $("retryButton").disabled = true;
  $("configStatus").hidden = false;
  $("configError").hidden = true;
  try {
    const response = await fetch(new URL("./pricing.xml", import.meta.url), { cache:"no-store" });
    if (!response.ok) throw new Error("Pricing request failed.");
    pricing = parsePricing(await response.text());
    $("printer").replaceChildren(...pricing.printers.map(config => new Option(config.name, config.id)));
    buildPrinterOptions();
    document.querySelectorAll(".currencyLabel").forEach(el => { el.textContent = pricing.currency; });
    $("inputFields").disabled = false;
    resetEditor(); renderBill();
  } catch {
    pricing = null;
    $("configError").hidden = false;
    $("draftTotal").textContent = "—";
    $("billTotal").textContent = "—";
  } finally {
    $("configStatus").hidden = true;
    $("retryButton").disabled = false;
  }
}
$("retryButton").addEventListener("click", loadPricing);
loadPricing();
