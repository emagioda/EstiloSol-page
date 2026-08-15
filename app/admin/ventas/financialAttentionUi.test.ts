import { createElement } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import FinancialAttentionFlag from "./FinancialAttentionFlag";

describe("AUD3-H06 Admin ventas financial attention", () => {
  it("AUD3-H06-MERGE-06 shows the financial warning and its exact conflict code", () => {
    render(createElement(FinancialAttentionFlag, {
      code: "FINANCIAL_EVIDENCE_CONFLICT",
    }));

    expect(screen.getByText("⚠ Requiere atención financiera")).toBeVisible();
    expect(screen.getByText("FINANCIAL_EVIDENCE_CONFLICT")).toBeVisible();
  });

  it("AUD3-H06-MERGE-07 renders no financial warning without a conflict", () => {
    const { container } = render(createElement(FinancialAttentionFlag));

    expect(screen.queryByText("⚠ Requiere atención financiera")).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });
});
