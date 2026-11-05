import { parsePricing, calculatePrint, invoiceBreakdown } from "../pricing.mjs";
const results = document.querySelector("#results");
let failures = 0;
async function test(name, fn) {
  const li = document.createElement("li");
  try { await fn(); li.textContent = `PASS — ${name}`; li.className = "pass"; }
  catch(error) { failures++; li.textContent = `FAIL — ${name}: ${error.message}`; li.className = "fail"; }
  results.append(li);
}
function assert(value, message="Assertion failed") { if (!value) throw new Error(message); }
function close(a,b) { assert(Math.abs(a-b)<1e-10, `${a} != ${b}`); }
function rejects(xml) { let threw=false; try { parsePricing(xml); } catch { threw=true; } assert(threw,"Invalid configuration accepted"); }
const xml = await (await fetch("../pricing.xml",{cache:"no-store"})).text();
const pricing = parsePricing(xml);
const input = {materialCost:2.5,printHours:2,printMinutes:30,operatorMinutes:0,payRate:0};
await test("External XML loads four machine profiles and Labor only; X2D is the default",()=> {
  assert(pricing.defaultPrinter==="x2d");
  assert(pricing.printers.map(p=>p.name).join(",")==="X2D,H2D,H2C,Form 4L,Labor only");
});
await test("Original X2D rates and 2.5-hour estimate",()=>close(calculatePrint(input,pricing.printers[0]).total,3.4466316377161217));
await test("Original H2D estimate",()=>close(calculatePrint({...input,materialCost:5,printHours:1,printMinutes:0},pricing.printers[1]).total,6.317690901571547));
await test("Original H2C estimate",()=>close(calculatePrint(input,pricing.printers[2]).total,4.451312314037673));
await test("Original Formlabs estimate",()=>close(calculatePrint(input,pricing.printers[3]).total,9.133971566848154));
await test("Optional operator labor adds time × rate",()=>close(calculatePrint({...input,operatorMinutes:30,payRate:20},pricing.printers[0]).total,13.446631637716122));
await test("Percentages preserve sequential subtotal and category bases",()=> {
  const config={per_print:[{name:"Fee",amount:2}],time_rates:[{name:"Time",rate_per_hour:1}],percentages:[{name:"A",rate:10,applies_to:"subtotal"},{name:"B",rate:10,applies_to:"subtotal"},{name:"C",rate:20,applies_to:"material"}],order_minimum:0};
  close(calculatePrint({...input,materialCost:10,printHours:2,printMinutes:0},config).total,18.94);
});
await test("Per-print minimum behavior is preserved",()=>close(calculatePrint(input,{...pricing.printers[0],order_minimum:10}).total,10));
await test("Malformed XML is rejected",()=>rejects("<printCalculator>"));
await test("Missing rate value is rejected",()=>rejects(xml.replace('amount="0.29"','')));
await test("Negative rates are rejected",()=>rejects(xml.replace('amount="0.29"','amount="-1"')));
await test("Non-numeric rates are rejected",()=>rejects(xml.replace('amount="0.29"','amount="oops"')));
await test("Duplicate printer IDs are rejected",()=>rejects(xml.replace('id="h2d"','id="x2d"')));
await test("Unknown percentage bases are rejected",()=>rejects(xml.replace('<percentages />','<percentages><percentage name="Test" rate="5" appliesTo="oops" /></percentages>')));
await test("Missing sections cannot silently produce zero rates",()=>rejects(xml.replace(/<timeRates>[\s\S]*?<\/timeRates>/,'')));
await test("Printer icons accept local assets, reject remote references",()=> {
  assert(parsePricing(xml.replace(/image="[^"]*"/,'image="assets/my-printer.jpg"')).printers[0].image==="assets/my-printer.jpg");
  rejects(xml.replace(/image="[^"]*"/,'image="https://example.com/photo.jpg"'));
});
const html = await (await fetch("../index.html")).text();
const base = new URL("../",location.href).href;
const fixture=document.querySelector("#fixture");
const wait = async predicate => { for(let n=0;n<200;n++){ if(predicate()) return; await new Promise(r=>setTimeout(r,25)); } throw new Error("Timed out"); };
async function mount(mock="", target=fixture) {
  const loaded=new Promise(resolve=>target.onload=resolve);
  target.srcdoc=html.replace('<head>',`<head><base href="${base}"><script>${mock}<\/script>`);
  await loaded;
  return target.contentDocument;
}
function fill(doc,id,value){ const el=doc.getElementById(id); el.value=value; el.dispatchEvent(new Event("input",{bubbles:true})); }
function add(doc,name,material,hours,minutes=0,printer="x2d") {
  for(const [id,value] of Object.entries({printName:name,materialCost:material,printHours:hours,printMinutes:minutes,printer})) fill(doc,id,String(value));
  doc.querySelector("#saveButton").click();
}
let doc=await mount();
await wait(()=>!doc.querySelector("#inputFields").disabled);
await test("Each printer selects and loads its own icon",async()=> {
  for (const printer of pricing.printers) {
    fill(doc,"printer",printer.id);
    await wait(()=>doc.querySelector("#printerImage").complete && doc.querySelector("#printerImage").naturalWidth>0 && !doc.querySelector("#printerImage").hidden);
    assert(doc.querySelector("#printerImage").getAttribute("src").endsWith(`/${printer.image}`));
    assert(doc.querySelector("#printerModel").textContent===printer.name);
  }
});
await test("Machine options have approved XML descriptions and accessible model labels",()=> {
  const descriptions=[
    "Low-cost, efficient printing for everyday parts. Smaller build area.",
    "Larger build area for bigger parts or batches of smaller parts.",
    "Efficient multicolor printing with automatic hotend changes.",
    "Fast resin printing with fine detail. Requires washing and curing.",
    "Design work and other labor services."
  ];
  assert(doc.querySelector("#printerLabel").textContent==="Machine");
  [...doc.querySelectorAll('#printerOptions [role="option"]')].forEach((option,index)=> {
    assert(pricing.printers[index].description===descriptions[index]);
    assert(doc.getElementById(option.getAttribute("aria-describedby")).textContent===descriptions[index]);
    assert(doc.getElementById(option.getAttribute("aria-labelledby")).textContent===pricing.printers[index].name);
  });
  assert(!/\bprinter\b/i.test(doc.body.textContent));
});
await test("Image selector supports arrows, Enter, Escape, Home, End and typeahead",()=> {
  const picker=doc.querySelector("#printerPicker");
  const key=value=>picker.dispatchEvent(new KeyboardEvent("keydown",{key:value,bubbles:true,cancelable:true}));
  picker.focus(); key("Home"); key("ArrowDown"); key("Enter");
  assert(doc.querySelector("#printer").value==="h2d");
  assert(picker.getAttribute("aria-expanded")==="false");
  key("End"); key("Escape"); assert(doc.querySelector("#printer").value==="h2d");
  key("h"); key("2"); key("c"); key("Enter"); assert(doc.querySelector("#printer").value==="h2c");
  key("Home"); key("Tab"); assert(picker.getAttribute("aria-expanded")==="false");
  picker.click(); doc.querySelector('[role="option"][data-index="0"]').click();
  assert(doc.querySelector("#printer").value==="x2d");
  assert(doc.activeElement===picker);
  assert(doc.querySelectorAll('#printerOptions [role="option"] img').length===5);
  assert(doc.querySelectorAll('#printerOptions [aria-selected="true"]').length===1);
});
await test("Add several prints; sum displayed print amounts",()=> {
  add(doc,"Phone stand",2.5,2,30); add(doc,"Tool holder",5,1,0,"h2d");
  assert(doc.querySelectorAll(".bill-item").length===2);
  assert(doc.querySelector("#billTotal").textContent==="$9.77");
});
await test("Edit one print without changing the other",()=> {
  doc.querySelector('[data-action="edit"]').click(); fill(doc,"materialCost","3.50"); doc.querySelector("#saveButton").click();
  assert(doc.querySelector("#billTotal").textContent==="$10.77");
  assert(doc.querySelectorAll(".item-heading strong")[1].textContent==="$6.32");
});
await test("Cancel edit leaves saved estimate unchanged",()=> {
  doc.querySelector('[data-action="edit"]').click(); fill(doc,"materialCost","100"); doc.querySelector("#cancelButton").click();
  assert(doc.querySelector("#billTotal").textContent==="$10.77");
});
await test("Unsaved input disables invoice action",()=> {
  fill(doc,"printName","Unsaved"); assert(doc.querySelector("#printButton").disabled);
  doc.querySelector("#cancelButton").click();
  assert(!doc.querySelector("#printButton").disabled);
  doc.querySelector('[data-action="remove"]').click();
  assert(doc.querySelector("#billTotal").textContent==="$6.32");
});
await test("Removing the last print leaves an empty bill",()=> {
  doc.querySelector('[data-action="remove"]').click();
  assert(doc.querySelector("#billTotal").textContent==="$0.00");
  assert(doc.querySelector("#printButton").disabled);
});
await test("Invalid input cannot be added",()=> {
  add(doc,"Invalid",-1,1); assert(doc.querySelectorAll(".bill-item").length===0);
  add(doc,"Invalid",1,1,60); assert(doc.querySelectorAll(".bill-item").length===0);
});
await test("Print names render as text, not HTML",()=> {
  add(doc,'<img src=x onerror=alert(1)>',1,1);
  assert(!doc.querySelector(".item-heading img"));
  assert(doc.querySelector(".item-heading h3").textContent==='<img src=x onerror=alert(1)>');
});
await test("Missing XML visibly blocks estimates; retry recovers",async()=> {
  doc=await mount('const originalFetch=window.fetch; let fail=true; window.fetch=(...args)=>{ if(fail){fail=false;return Promise.resolve(new Response("",{status:404}));}return originalFetch(...args)};');
  await wait(()=>!doc.querySelector("#configError").hidden);
  assert(doc.querySelector("#inputFields").disabled); assert(doc.querySelector("#billTotal").textContent==="—");
  doc.querySelector("#retryButton").click(); await wait(()=>!doc.querySelector("#inputFields").disabled);
});
await test("Malformed XML visibly blocks estimates with no fallback",async()=> {
  doc=await mount('window.fetch=()=>Promise.resolve(new Response("<broken>"));');
  await wait(()=>!doc.querySelector("#configError").hidden);
  assert(doc.querySelector("#inputFields").disabled); assert(doc.querySelector("#billTotal").textContent==="—");
});
await test("Missing printer icon falls back to model text",async()=> {
  doc=await mount(`window.fetch=()=>Promise.resolve(new Response(${JSON.stringify(xml.replace(/image="[^"]*"/,'image="assets/missing-test-photo.jpg"'))}));`);
  await wait(()=>!doc.querySelector("#inputFields").disabled);
  await new Promise(r=>setTimeout(r,100));
  assert(doc.querySelector("#printerImage").hidden); assert(doc.querySelector("#printerModel").textContent==="X2D");
});
await test("Labor-only formula ignores stale material/time and uses entered rate",()=> {
  const result=calculatePrint({...input,materialCost:999,printHours:99,operatorMinutes:75,payRate:40},pricing.printers[4]);
  close(result.total,50); assert(result.rows.length===1); close(result.groups.fees,0); close(result.groups.time,0);
});
await test("Capability validation rejects invalid flags and contradictory charges",()=> {
  rejects(xml.replace('material="true"','material="maybe"'));
  rejects(xml.replace('maintenance="true"','maintenance="false"'));
});
await test("Legacy XML retains physical machine calculations",()=> {
  const legacy=parsePricing(xml.replace(/<capabilities[^>]*\/>/g,''));
  close(calculatePrint(input,legacy.printers[0]).total,3.4466316377161217);
});
doc=await mount();
await wait(()=>!doc.querySelector("#inputFields").disabled);
await test("Labor selection hides and disables irrelevant fields; rate/time required without defaults",()=> {
  fill(doc,"printer","labor");
  assert(doc.querySelector("#materialFields").hidden && doc.querySelector("#printTimeFields").hidden);
  for(const id of ["materialCost","printHours","printMinutes"]) assert(doc.getElementById(id).disabled);
  for(const id of ["operatorMinutes","payRate"]) { const el=doc.getElementById(id); assert(el.required && !el.disabled && el.value===""); }
  fill(doc,"printName","Design service"); doc.querySelector("#saveButton").click();
  assert(doc.querySelectorAll(".bill-item").length===0);
  fill(doc,"operatorMinutes","60"); fill(doc,"payRate","0"); doc.querySelector("#saveButton").click();
  assert(doc.querySelectorAll(".bill-item").length===0);
});
await test("Labor service saves for entered minutes and hourly rate",()=> {
  fill(doc,"payRate","30"); doc.querySelector("#saveButton").click();
  assert(doc.querySelector("#billTotal").textContent==="$30.00");
  const item=doc.querySelector(".bill-item");
  assert(item.querySelector(".item-meta").textContent==="Labor only");
  assert(item.querySelector(".invoice-costs").textContent.replace(/\s+/g,' ').trim()==="Labor fees$30.00");
});
await test("Switching back restores material and print-time requirements",()=> {
  assert(doc.querySelector("#printer").value==="x2d");
  for(const id of ["materialCost","printHours","printMinutes"]) { const el=doc.getElementById(id); assert(!el.disabled && el.required); }
  assert(!doc.querySelector("#materialFields").hidden && !doc.querySelector("#printTimeFields").hidden);
  assert(doc.querySelector("#operatorMinutes").min==="0" && !doc.querySelector("#laborSummary").hidden);
});
await test("Mixed labor and machine bill totals and editing preserve both jobs",()=> {
  add(doc,"Printed part",2.5,2,30);
  assert(doc.querySelector("#billTotal").textContent==="$33.45");
  doc.querySelector('[data-action="edit"]').click();
  assert(doc.querySelector("#printer").value==="labor" && doc.querySelector("#payRate").value==="30");
  fill(doc,"operatorMinutes","90"); doc.querySelector("#saveButton").click();
  assert(doc.querySelector("#billTotal").textContent==="$48.45");
  doc.querySelector('[data-action="remove"]').click();
  assert(doc.querySelector("#billTotal").textContent==="$3.45");
});
await test("Capabilities also work for an arbitrary service ID",async()=> {
  const renamed=xml.replace('id="labor"','id="design-service"').replace('name="Labor only"','name="Design service"');
  doc=await mount(`window.fetch=()=>Promise.resolve(new Response(${JSON.stringify(renamed)}));`);
  await wait(()=>!doc.querySelector("#inputFields").disabled);
  fill(doc,"printer","design-service");
  assert(doc.querySelector("#materialFields").hidden && doc.querySelector("#operatorMinutes").required);
  fill(doc,"printName","CAD"); fill(doc,"operatorMinutes","75"); fill(doc,"payRate","40"); doc.querySelector("#saveButton").click();
  assert(doc.querySelector("#billTotal").textContent==="$50.00");
});

const invoice=document.querySelector("#invoice");
const invoiceDoc=await mount("",invoice);
await wait(()=>!invoiceDoc.querySelector("#inputFields").disabled);
add(invoiceDoc,"Phone stand",2.5,2,30);
fill(invoiceDoc,"operatorMinutes","30"); fill(invoiceDoc,"payRate","20");
add(invoiceDoc,"Tool holder",5,1,0,"h2d");
await test("Invoice categories reconcile with and without labor",()=> {
  const items=[...invoiceDoc.querySelectorAll(".invoice-costs")];
  assert(items[0].textContent.includes("Material") && items[0].textContent.includes("Maintenance fees"));
  assert(!items[0].textContent.includes("Labor fees"));
  assert([...items[0].querySelectorAll("dd")].map(e=>e.textContent).join(",")==="$2.50,$0.95");
  assert([...items[1].querySelectorAll("dd")].map(e=>e.textContent).join(",")==="$5.00,$1.32,$10.00");
  assert(invoiceDoc.querySelector("#billTotal").textContent==="$19.77");
});
await test("Rounding of fractional labor reconciles exactly to the print total",()=> {
  const result=calculatePrint({...input,operatorMinutes:1,payRate:1},pricing.printers[0]);
  const summary=invoiceBreakdown(result,"USD");
  close(summary.material+summary.maintenance+summary.labor,summary.total);
  close(summary.labor,0.02);
});
await test("Printing retains on-screen disclosure state",()=> {
  const detail=invoiceDoc.querySelector(".item-details"); detail.open=true;
  invoice.contentWindow.dispatchEvent(new Event("beforeprint"));
  invoice.contentWindow.dispatchEvent(new Event("afterprint"));
  assert(detail.open);
  assert(invoiceDoc.querySelector("#invoiceDate").textContent.length>0);
});
fill(invoiceDoc,"printer","labor"); fill(invoiceDoc,"printName","Design service");
fill(invoiceDoc,"operatorMinutes","75"); fill(invoiceDoc,"payRate","40"); invoiceDoc.querySelector("#saveButton").click();
await test("Optional extended description saves, edits, escapes text and survives print styling",()=> {
  const service=invoiceDoc.querySelectorAll(".bill-item")[2];
  service.querySelector('[data-action="edit"]').click();
  const field=invoiceDoc.querySelector("#jobDescription");
  assert(!field.disabled && !field.required && !invoiceDoc.querySelector("#descriptionFields").hidden);
  fill(invoiceDoc,"jobDescription","Design revisions\n<img src=x> & measurements");
  invoiceDoc.querySelector("#saveButton").click();
  let saved=invoiceDoc.querySelectorAll(".bill-item")[2];
  assert(saved.querySelector(".job-description").textContent==="Design revisions\n<img src=x> & measurements");
  assert(!saved.querySelector(".job-description img"));
  saved.querySelector('[data-action="edit"]').click();
  assert(field.value==="Design revisions\n<img src=x> & measurements");
  fill(invoiceDoc,"jobDescription","Design revisions\nUpdated dimensions and drawing review.");
  invoiceDoc.querySelector("#saveButton").click();
  assert(invoiceDoc.querySelector("#descriptionFields").hidden && field.disabled);
  assert(invoiceDoc.querySelector("#billTotal").textContent==="$69.77");
});
await test("Mixed invoice omits material, maintenance and duration for labor only",()=> {
  const service=invoiceDoc.querySelectorAll(".bill-item")[2];
  assert(service.querySelector(".item-meta").textContent==="Labor only");
  assert([...service.querySelectorAll(".invoice-costs dt")].map(e=>e.textContent).join(',')==="Labor fees");
  assert(service.querySelector(".invoice-costs dd").textContent==="$50.00");
  assert(invoiceDoc.querySelector("#billTotal").textContent==="$69.77");
});
invoice.contentWindow.dispatchEvent(new Event("beforeprint"));
await test("Payee is visible on the bill and in print styles",()=> {
  const payee=invoiceDoc.querySelector("#payee");
  assert(payee.textContent==="Payable to Eastern Shore Foundation INC");
  assert(!payee.closest(".screen-only"));
});
await test("Bill to is optional, safely renders multiline text and survives job editing",()=> {
  assert(invoiceDoc.querySelector("#billToPrintContainer").hidden);
  assert(!invoiceDoc.querySelector("#billTo").required);
  fill(invoiceDoc,"billTo","Alex Smith\nExample Studio <accounts>");
  assert(invoiceDoc.querySelector("#billToPrint").textContent==="Alex Smith\nExample Studio <accounts>");
  assert(!invoiceDoc.querySelector("#billToPrint accounts"));
  assert(!invoiceDoc.querySelector("#printButton").disabled);
  invoiceDoc.querySelector('[data-action="edit"]').click();
  invoiceDoc.querySelector("#cancelButton").click();
  assert(invoiceDoc.querySelector("#billTo").value==="Alex Smith\nExample Studio <accounts>");
  fill(invoiceDoc,"billTo","   ");
  assert(invoiceDoc.querySelector("#billToPrintContainer").hidden);
  fill(invoiceDoc,"billTo","Alex Smith\nExample Studio");
  invoice.contentWindow.dispatchEvent(new Event("beforeprint"));
  assert(invoiceDoc.querySelector("#billTotal").textContent==="$69.77");
});
const css=await (await fetch("../styles.css")).text();
const style=invoiceDoc.createElement("style");style.textContent=css.replace("@media print", "@media screen");invoiceDoc.head.append(style);
await test("Print styles hide internal charges and show only invoice categories",()=> {
  const view=invoice.contentWindow;
  assert([...invoiceDoc.querySelectorAll(".item-details")].every(el=>view.getComputedStyle(el).display==="none"));
  assert([...invoiceDoc.querySelectorAll(".invoice-costs")].every(el=>view.getComputedStyle(el).display!=="none"));
  assert(view.getComputedStyle(invoiceDoc.querySelector("#payee")).display!=="none");
  assert(!invoiceDoc.querySelector("#billToPrintContainer").hidden);
  assert(view.getComputedStyle(invoiceDoc.querySelector("#billToPrint").parentElement).display!=="none");
  assert(view.getComputedStyle(invoiceDoc.querySelector("#billTo").parentElement).display==="none");
  assert(view.getComputedStyle(invoiceDoc.querySelector(".job-description")).display!=="none");
  assert(invoiceDoc.querySelector(".item-meta").textContent.includes("2 hr 30 min"));
});
document.querySelector("#status").textContent=`${results.children.length-failures}/${results.children.length} checks passed${failures ? " — failures need attention" : ""}.`;
