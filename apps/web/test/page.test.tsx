import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import Home from "../src/app/page";
afterEach(cleanup);
it("renders the root shell with a clear product heading and development message", () => {
  render(<Home />);
  expect(screen.getByRole("main")).toBeDefined();
  expect(
    screen.getByRole("heading", { level: 1, name: "Church Platform" }),
  ).toBeDefined();
  expect(screen.getByText("In development")).toBeDefined();
});
