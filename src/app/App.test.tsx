import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("App", () => {
  it("renders the M0 application shell", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "対戦映像を観測ログへ" })).toBeInTheDocument();
    expect(screen.getByText("static browser app")).toBeInTheDocument();
    expect(screen.getByText("M0")).toBeInTheDocument();
  });
});

