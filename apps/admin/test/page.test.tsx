import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import Home from "../src/app/page";

afterEach(cleanup);

it("renders the platform administration shell", () => {
  render(<Home />);
  expect(screen.getByRole("main")).toBeDefined();
  expect(
    screen.getByRole("heading", {
      level: 1,
      name: "Platform Administration",
    }),
  ).toBeDefined();
  expect(screen.getByText("In development")).toBeDefined();
});
