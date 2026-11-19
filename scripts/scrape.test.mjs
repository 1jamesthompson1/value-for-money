import test from "node:test";
import assert from "node:assert/strict";
import { parseOpencode } from "./scrape.mjs";

test("parseOpencode accepts tables with HTML attributes", () => {
  const modelRows = Array.from(
    { length: 5 },
    (_, index) =>
      `<tr class="row"><td class="name">Model ${index + 1}</td><td>$1</td><td>$2</td><td>$0.10</td><td>$0.20</td><td><strong>$${index + 10}</strong></td></tr>`
  ).join("");
  const requestRows = Array.from(
    { length: 5 },
    (_, index) =>
      `<tr><td>Model ${index + 1}</td><td>-</td><td>-</td><td><strong>${100 * (index + 1)}</strong></td></tr>`
  ).join("");

  const html = `
    <table class="pricing"><thead><tr><th scope="col">Model</th><th>Input</th><th>Output</th><th>Cached</th><th>Write</th><th scope="col">Monthly limit</th></tr></thead><tbody>${modelRows}</tbody></table>
    <table class="pricing"><thead><tr><th scope="col">Model</th><th>Input</th><th>Output</th><th>Cached</th><th>Write</th><th scope="col">Monthly limit</th></tr></thead><tbody>${modelRows}</tbody></table>
    <table class="requests"><thead><tr><th>Model</th><th>-</th><th>-</th><th>Requests per month</th></tr></thead><tbody>${requestRows}</tbody></table>
    <table class="requests"><thead><tr><th>Model</th><th>-</th><th>-</th><th>Requests per month</th></tr></thead><tbody>${requestRows}</tbody></table>
  `;

  const plans = parseOpencode(html);
  assert.equal(plans.go.models["model 1"].monthlyLimit, 10);
  assert.equal(plans.go.models["model 1"].monthlyRequests, 100);
  assert.equal(plans["go-plus"].models["model 1"].monthlyLimit, 10);
});
