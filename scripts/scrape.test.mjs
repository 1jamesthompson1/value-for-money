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

test("parseOpencode accepts combined Go and Go Plus allowances table", () => {
  const modelRows = Array.from(
    { length: 5 },
    (_, index) =>
      `<tr data-model="model-${index + 1}">
        <th scope="row"><span class="console-go-models-model-name">Model ${index + 1}</span></th>
        <td aria-hidden="true">chart</td>
        <td><span class="sr-only">Go: ${100 * (index + 1)}; Go Plus: ${400 * (index + 1)}</span></td>
        <td><span class="sr-only">Go: $${index + 10}; Go Plus: $${(index + 10) * 4}</span></td>
      </tr>`
  ).join("");

  const html = `
    <table aria-label="Go and Go Plus allowances">
      <thead><tr><th>Model</th><th>Est. requests / 5 hr</th><th>Monthly limit</th></tr></thead>
      <tbody>${modelRows}</tbody>
    </table>
  `;

  const plans = parseOpencode(html);
  assert.equal(plans.go.models["model 1"].monthlyLimit, 10);
  assert.equal(plans.go.models["model 1"].monthlyRequests, 100);
  assert.equal(plans["go-plus"].models["model 1"].monthlyLimit, 40);
  assert.equal(plans["go-plus"].models["model 1"].monthlyRequests, 400);
});
