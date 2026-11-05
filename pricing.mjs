// Prices are supplied exclusively by pricing.xml. This module contains no default rates.
export function capabilitiesFor(config) {
  // Legacy configurations retain their original inputs and charge behavior.
  return config.capabilities || { material:true, printTime:true, labor:"optional", maintenance:true };
}
export function parsePricing(xml) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("Document types are not supported.");
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("Invalid XML.");
  const root = doc.documentElement;
  if (root.tagName !== "printCalculator") throw new Error("Missing printCalculator root.");
  const attr = (el, name) => {
    const value = el.getAttribute(name)?.trim();
    if (!value) throw new Error(`Missing ${name}.`);
    return value;
  };
  const numeric = (el, name) => {
    const value = Number(attr(el, name));
    if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid ${name}.`);
    return value;
  };
  const allowed = (el, tags) => {
    if ([...el.children].some(child => !tags.includes(child.tagName))) throw new Error("Unknown configuration element.");
  };
  const currency = attr(root, "currency");
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Invalid currency.");
  new Intl.NumberFormat("en", { style: "currency", currency });
  const list = (printer, tag, childTag, convert) => {
    const containers = [...printer.children].filter(el => el.tagName === tag);
    if (containers.length !== 1) throw new Error(`Expected one ${tag}.`);
    allowed(containers[0], [childTag]);
    return [...containers[0].children].map(convert);
  };
  allowed(root, ["printer"]);
  const printers = [...root.children].map(el => {
    allowed(el, ["capabilities", "perPrint", "timeRates", "percentages"]);
    const nodes = [...el.children].filter(child => child.tagName === "capabilities");
    if (nodes.length > 1) throw new Error("Duplicate capabilities.");
    let capabilities = capabilitiesFor({});
    if (nodes.length) {
      const node = nodes[0];
      allowed(node, []);
      const boolean = name => {
        const value = attr(node, name);
        if (!["true", "false"].includes(value)) throw new Error(`Invalid ${name} capability.`);
        return value === "true";
      };
      const labor = attr(node, "labor");
      if (!["disabled", "optional", "required"].includes(labor)) throw new Error("Invalid labor capability.");
      capabilities = { material:boolean("material"), printTime:boolean("printTime"), labor, extendedDescription:node.hasAttribute("extendedDescription") ? boolean("extendedDescription") : false, maintenance:boolean("maintenance") };
      if (!capabilities.material && !capabilities.printTime && labor === "disabled") throw new Error("No enabled inputs.");
    }
    const config = {
      capabilities,
      description: el.getAttribute("description")?.trim() || "",
      image: el.getAttribute("image")?.trim() || "", imageAlt: el.getAttribute("imageAlt")?.trim() || "",
      id: attr(el, "id"), name: attr(el, "name"), order_minimum: numeric(el, "orderMinimum"),
      per_print: list(el, "perPrint", "fee", item => ({ name: attr(item, "name"), amount: numeric(item, "amount") })),
      time_rates: list(el, "timeRates", "rate", item => ({ name: attr(item, "name"), rate_per_hour: numeric(item, "perHour") })),
      percentages: list(el, "percentages", "percentage", item => {
        const applies_to = attr(item, "appliesTo");
        if (!["subtotal", "material", "time", "operator", "fees"].includes(applies_to)) throw new Error("Unknown percentage basis.");
        return { name: attr(item, "name"), rate: numeric(item, "rate"), applies_to };
      })
    };
    if (!capabilities.printTime && config.time_rates.length) throw new Error("Time rates require print time.");
    if (!capabilities.maintenance && (config.per_print.length || config.time_rates.length || config.percentages.length || config.order_minimum)) throw new Error("Maintenance-disabled profiles cannot define machine charges.");
    return config;
  });
  if (!printers.length || new Set(printers.map(p => p.id)).size !== printers.length) throw new Error("Missing or duplicate printers.");
  for (const printer of printers) {
    if (printer.image && (!/^assets\/[A-Za-z0-9_./-]+$/.test(printer.image) || printer.image.split("/").includes(".."))) throw new Error("Printer images must be local assets.");
  }
  const defaultPrinter = attr(root, "defaultPrinter");
  if (!printers.some(p => p.id === defaultPrinter)) throw new Error("Unknown default printer.");
  return { currency, defaultPrinter, printers };
}

export function calculatePrint(input, config) {
  const capabilities = capabilitiesFor(config);
  input = { ...input,
    materialCost:capabilities.material ? input.materialCost : 0,
    printHours:capabilities.printTime ? input.printHours : 0,
    printMinutes:capabilities.printTime ? input.printMinutes : 0,
    operatorMinutes:capabilities.labor !== "disabled" ? input.operatorMinutes : 0,
    payRate:capabilities.labor !== "disabled" ? input.payRate : 0
  };
  for (const key of ["materialCost", "printHours", "printMinutes", "operatorMinutes", "payRate"]) {
    if (!Number.isFinite(input[key]) || input[key] < 0) throw new Error("Use nonnegative, finite values.");
  }
  if (capabilities.labor === "required" && (input.operatorMinutes <= 0 || input.payRate <= 0)) throw new Error("Enter labor time and hourly rate.");
  const hours = input.printHours + input.printMinutes / 60;
  const groups = { material: input.materialCost, time: 0, operator: input.operatorMinutes / 60 * input.payRate, fees: 0 };
  const rows = capabilities.material ? [{ item: "Material", basis: "Slicer estimate", cost: groups.material }] : [];
  for (const rate of capabilities.maintenance ? config.time_rates : []) {
    const cost = hours * rate.rate_per_hour;
    groups.time += cost;
    rows.push({ item: rate.name, basis: `${input.printHours} hr ${input.printMinutes} min × ${Number(rate.rate_per_hour.toPrecision(8))}/hr`, cost });
  }
  if (groups.operator > 0) rows.push({ item: "Operator labor", basis: `${input.operatorMinutes} min × ${input.payRate}/hr`, cost: groups.operator });
  for (const fee of capabilities.maintenance ? config.per_print : []) {
    groups.fees += fee.amount;
    rows.push({ item: fee.name, basis: "Per print", cost: fee.amount });
  }
  let total = groups.material + groups.time + groups.operator + groups.fees;
  for (const percent of capabilities.maintenance ? config.percentages : []) {
    // Preserve the original sequential percentage calculation.
    const cost = (percent.applies_to === "subtotal" ? total : groups[percent.applies_to]) * percent.rate / 100;
    total += cost;
    rows.push({ item: percent.name, basis: `${percent.rate}% of ${percent.applies_to}`, cost });
  }
  if (capabilities.maintenance && total < config.order_minimum) {
    rows.push({ item: "Order minimum adjustment", basis: `Per print minimum: ${config.order_minimum}`, cost: config.order_minimum - total });
    total = config.order_minimum;
  }
  if (!Number.isFinite(total)) throw new Error("Estimate is too large.");
  return { total, rows, groups };
}

// Invoice presentation only. Reconcile rounded categories to the unchanged print total.
export function invoiceBreakdown(result, currency) {
  const digits = new Intl.NumberFormat("en", { style:"currency", currency }).resolvedOptions().maximumFractionDigits;
  const round = value => Number(value.toFixed(digits));
  const total = round(result.total);
  const material = round(result.groups.material);
  const labor = round(result.groups.operator);
  return { total, material, labor, maintenance:round(total - material - labor), hasLabor:result.groups.operator > 0 };
}
